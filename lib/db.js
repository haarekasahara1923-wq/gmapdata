import { neon } from '@neondatabase/serverless';

function getDbUrl() {
  let url = process.env.DATABASE_URL || '';
  if (url.startsWith('postgres://')) {
    url = url.replace('postgres://', 'postgresql://');
  }
  return url;
}

export function getSql() {
  const url = getDbUrl();
  if (!url) {
    throw new Error('DATABASE_URL is not configured in environment variables');
  }
  return neon(url);
}

export async function initDb() {
  const sql = getSql();
  await sql`
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
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
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
      rating NUMERIC(2, 1) DEFAULT 0.0,
      reviews_count INTEGER DEFAULT 0,
      place_id VARCHAR(255),
      map_url TEXT,
      session_id VARCHAR(100) REFERENCES sessions(session_id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_leads_clean_niche ON leads(clean_niche);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_leads_clean_phone ON leads(clean_phone);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_leads_session_id ON leads(session_id);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);`;
}

export function normalizePhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  if (digits.length > 10 && digits.startsWith('0')) return '91' + digits.slice(1);
  return digits;
}

export function normalizeText(text) {
  if (!text) return '';
  return String(text).trim().toLowerCase().replace(/\s+/g, ' ');
}
