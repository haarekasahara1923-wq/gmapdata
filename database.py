import os
import re
import sqlite3
from datetime import datetime
from typing import List, Dict, Optional, Tuple, Any
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
IS_POSTGRES = bool(DATABASE_URL and (DATABASE_URL.startswith("postgres://") or DATABASE_URL.startswith("postgresql://")))

# Fix Heroku/Neon legacy postgres:// prefix if needed
if IS_POSTGRES and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

DB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
SQLITE_PATH = os.path.join(DB_DIR, "gmap_extractor.db")

def get_connection():
    if IS_POSTGRES:
        import psycopg2
        import psycopg2.extras
        conn = psycopg2.connect(DATABASE_URL)
        return conn
    else:
        os.makedirs(DB_DIR, exist_ok=True)
        conn = sqlite3.connect(SQLITE_PATH)
        conn.row_factory = sqlite3.Row
        return conn

def execute_query(query: str, params: Tuple = (), fetch_one: bool = False, fetch_all: bool = False, commit: bool = False) -> Any:
    conn = get_connection()
    try:
        if IS_POSTGRES:
            import psycopg2.extras
            cursor = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
            # Convert SQLite ? to Postgres %s
            pg_query = query.replace("?", "%s")
            cursor.execute(pg_query, params)
        else:
            cursor = conn.cursor()
            cursor.execute(query, params)

        if commit:
            conn.commit()

        result = None
        if fetch_one:
            row = cursor.fetchone()
            result = dict(row) if row else None
        elif fetch_all:
            rows = cursor.fetchall()
            result = [dict(r) for r in rows]
        elif commit and not IS_POSTGRES:
            result = cursor.lastrowid
            
        cursor.close()
        return result
    finally:
        conn.close()

def init_db():
    conn = get_connection()
    try:
        cursor = conn.cursor()
        
        # Primary key type difference
        pk_type = "SERIAL PRIMARY KEY" if IS_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
        
        cursor.execute(f"""
        CREATE TABLE IF NOT EXISTS sessions (
            session_id VARCHAR(100) PRIMARY KEY,
            niche VARCHAR(255) NOT NULL,
            location VARCHAR(255),
            query TEXT NOT NULL,
            max_requested INTEGER DEFAULT 50,
            new_count INTEGER DEFAULT 0,
            skipped_count INTEGER DEFAULT 0,
            status VARCHAR(50) DEFAULT 'running',
            pdf_cloudinary_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP
        );
        """)

        cursor.execute(f"""
        CREATE TABLE IF NOT EXISTS leads (
            id {pk_type},
            niche VARCHAR(255) NOT NULL,
            clean_niche VARCHAR(255) NOT NULL,
            query TEXT NOT NULL,
            name VARCHAR(255) NOT NULL,
            phone VARCHAR(100),
            clean_phone VARCHAR(50),
            whatsapp VARCHAR(50),
            email VARCHAR(255),
            website TEXT,
            address TEXT,
            rating REAL DEFAULT 0.0,
            reviews_count INTEGER DEFAULT 0,
            place_id TEXT,
            map_url TEXT,
            session_id VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # Indexes for fast lookup
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_leads_clean_niche ON leads(clean_niche);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_leads_clean_phone ON leads(clean_phone);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_leads_place_id ON leads(place_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_leads_session_id ON leads(session_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);")

        conn.commit()
        cursor.close()
    finally:
        conn.close()

def normalize_text(text: Optional[str]) -> str:
    if not text:
        return ""
    return re.sub(r'\s+', ' ', text.strip().lower())

def normalize_phone(phone: Optional[str]) -> str:
    if not phone:
        return ""
    digits = re.sub(r'\D', '', phone)
    if len(digits) == 10:
        return "91" + digits
    if len(digits) > 10 and digits.startswith("0"):
        return "91" + digits[1:]
    return digits

def format_whatsapp(phone: Optional[str]) -> Optional[str]:
    norm = normalize_phone(phone)
    if len(norm) >= 10:
        return norm
    return None

def lead_exists_for_niche(clean_niche: str, place_id: Optional[str] = None, 
                          name: Optional[str] = None, address: Optional[str] = None, 
                          phone: Optional[str] = None) -> bool:
    """
    Checks if this lead was previously extracted for the same niche in Neon Postgres / SQLite.
    """
    # 1. Match by place_id
    if place_id:
        row = execute_query("SELECT id FROM leads WHERE clean_niche = ? AND place_id = ? LIMIT 1", (clean_niche, place_id), fetch_one=True)
        if row:
            return True

    # 2. Match by clean_phone
    clean_p = normalize_phone(phone)
    if clean_p and len(clean_p) >= 10:
        row = execute_query("SELECT id FROM leads WHERE clean_niche = ? AND clean_phone = ? LIMIT 1", (clean_niche, clean_p), fetch_one=True)
        if row:
            return True

    # 3. Match by name and address
    if name:
        clean_name = normalize_text(name)
        if address:
            clean_addr = normalize_text(address)[:50]
            row = execute_query("SELECT id FROM leads WHERE clean_niche = ? AND LOWER(name) = ? AND LOWER(address) LIKE ? LIMIT 1",
                                (clean_niche, clean_name, f"{clean_addr}%"), fetch_one=True)
        else:
            row = execute_query("SELECT id FROM leads WHERE clean_niche = ? AND LOWER(name) = ? LIMIT 1",
                                (clean_niche, clean_name), fetch_one=True)
        if row:
            return True

    return False

def save_lead(lead_data: Dict) -> Tuple[bool, int]:
    """
    Saves lead if not duplicate for this niche.
    Returns (is_new, lead_id)
    """
    niche = lead_data.get("niche", "").strip()
    clean_niche = normalize_text(niche)
    place_id = lead_data.get("place_id")
    name = lead_data.get("name", "").strip()
    address = lead_data.get("address", "").strip()
    phone = lead_data.get("phone", "").strip()
    clean_phone = normalize_phone(phone)
    whatsapp = lead_data.get("whatsapp") or format_whatsapp(phone)

    # Check deduplication
    if lead_exists_for_niche(clean_niche, place_id, name, address, phone):
        return False, 0

    conn = get_connection()
    try:
        cursor = conn.cursor()
        query = """
        INSERT INTO leads (
            niche, clean_niche, query, name, phone, clean_phone, whatsapp, 
            email, website, address, rating, reviews_count, place_id, map_url, session_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        params = (
            niche, clean_niche, lead_data.get("query", ""), name, phone, clean_phone, whatsapp,
            lead_data.get("email", ""), lead_data.get("website", ""), address,
            float(lead_data.get("rating", 0.0) or 0.0), int(lead_data.get("reviews_count", 0) or 0),
            place_id, lead_data.get("map_url", ""), lead_data.get("session_id", "")
        )

        lead_id = 0
        if IS_POSTGRES:
            pg_query = query.replace("?", "%s") + " RETURNING id"
            cursor.execute(pg_query, params)
            lead_id = cursor.fetchone()[0]
        else:
            cursor.execute(query, params)
            lead_id = cursor.lastrowid

        conn.commit()
        cursor.close()
        return True, lead_id
    finally:
        conn.close()

def create_session(session_id: str, niche: str, location: str, query: str, max_requested: int):
    conn = get_connection()
    try:
        cursor = conn.cursor()
        if IS_POSTGRES:
            cursor.execute("""
            INSERT INTO sessions (session_id, niche, location, query, max_requested, status)
            VALUES (%s, %s, %s, %s, %s, 'running')
            ON CONFLICT (session_id) DO UPDATE SET status = 'running'
            """, (session_id, niche, location, query, max_requested))
        else:
            cursor.execute("""
            INSERT OR REPLACE INTO sessions (session_id, niche, location, query, max_requested, status)
            VALUES (?, ?, ?, ?, ?, 'running')
            """, (session_id, niche, location, query, max_requested))
        conn.commit()
        cursor.close()
    finally:
        conn.close()

def update_session(session_id: str, new_count: int, skipped_count: int, status: str = 'running', pdf_url: Optional[str] = None):
    conn = get_connection()
    try:
        cursor = conn.cursor()
        completed_at = datetime.now() if status in ('completed', 'stopped', 'error') else None
        
        if IS_POSTGRES:
            cursor.execute("""
            UPDATE sessions 
            SET new_count = %s, skipped_count = %s, status = %s, 
                completed_at = COALESCE(%s, completed_at),
                pdf_cloudinary_url = COALESCE(%s, pdf_cloudinary_url)
            WHERE session_id = %s
            """, (new_count, skipped_count, status, completed_at, pdf_url, session_id))
        else:
            cursor.execute("""
            UPDATE sessions 
            SET new_count = ?, skipped_count = ?, status = ?, 
                completed_at = COALESCE(?, completed_at),
                pdf_cloudinary_url = COALESCE(?, pdf_cloudinary_url)
            WHERE session_id = ?
            """, (new_count, skipped_count, status, completed_at.isoformat() if completed_at else None, pdf_url, session_id))
        conn.commit()
        cursor.close()
    finally:
        conn.close()

def update_session_pdf_url(session_id: str, pdf_url: str):
    if IS_POSTGRES:
        execute_query("UPDATE sessions SET pdf_cloudinary_url = ? WHERE session_id = ?", (pdf_url, session_id), commit=True)
    else:
        execute_query("UPDATE sessions SET pdf_cloudinary_url = ? WHERE session_id = ?", (pdf_url, session_id), commit=True)

def get_all_sessions(limit: int = 100) -> List[Dict]:
    """
    Returns all extraction sessions chronologically (date-wise) for the dashboard history view.
    """
    return execute_query("SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?", (limit,), fetch_all=True)

def get_session_by_id(session_id: str) -> Optional[Dict]:
    return execute_query("SELECT * FROM sessions WHERE session_id = ?", (session_id,), fetch_one=True)

def get_leads(niche: Optional[str] = None, session_id: Optional[str] = None, search: Optional[str] = None, limit: int = 2000) -> List[Dict]:
    query = "SELECT * FROM leads WHERE 1=1"
    params = []

    if session_id:
        query += " AND session_id = ?"
        params.append(session_id)
    elif niche:
        clean_n = normalize_text(niche)
        query += " AND clean_niche = ?"
        params.append(clean_n)

    if search:
        s = f"%{search.lower()}%"
        query += " AND (LOWER(name) LIKE ? OR LOWER(phone) LIKE ? OR LOWER(email) LIKE ? OR LOWER(address) LIKE ?)"
        params.extend([s, s, s, s])

    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)

    return execute_query(query, tuple(params), fetch_all=True)

def get_all_niches() -> List[Dict]:
    query = """
    SELECT niche, clean_niche, COUNT(*) as lead_count, MAX(created_at) as last_scraped
    FROM leads
    GROUP BY niche, clean_niche
    ORDER BY last_scraped DESC
    """
    return execute_query(query, fetch_all=True)

def get_db_stats() -> Dict:
    total_leads_row = execute_query("SELECT COUNT(*) as count FROM leads", fetch_one=True)
    total_leads = total_leads_row.get("count", 0) if total_leads_row else 0

    total_sessions_row = execute_query("SELECT COUNT(*) as count FROM sessions", fetch_one=True)
    total_sessions = total_sessions_row.get("count", 0) if total_sessions_row else 0

    niches_row = execute_query("SELECT COUNT(DISTINCT clean_niche) as count FROM leads", fetch_one=True)
    total_niches = niches_row.get("count", 0) if niches_row else 0

    phones_row = execute_query("SELECT COUNT(*) as count FROM leads WHERE phone IS NOT NULL AND phone != ''", fetch_one=True)
    leads_with_phone = phones_row.get("count", 0) if phones_row else 0

    emails_row = execute_query("SELECT COUNT(*) as count FROM leads WHERE email IS NOT NULL AND email != ''", fetch_one=True)
    leads_with_email = emails_row.get("count", 0) if emails_row else 0

    return {
        "total_leads": total_leads,
        "total_sessions": total_sessions,
        "total_niches": total_niches,
        "leads_with_phone": leads_with_phone,
        "leads_with_email": leads_with_email,
        "database_type": "Neon Postgres" if IS_POSTGRES else "SQLite"
    }

def clear_leads(clean_niche: Optional[str] = None):
    if clean_niche:
        execute_query("DELETE FROM leads WHERE clean_niche = ?", (clean_niche,), commit=True)
    else:
        execute_query("DELETE FROM leads", commit=True)
        execute_query("DELETE FROM sessions", commit=True)

# Initialize on module load
try:
    init_db()
except Exception as e:
    print(f"[Database Init Warning]: {e}")
