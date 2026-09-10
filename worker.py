"""
worker.py - Background Scraper Worker
======================================
Run this separately on any machine (local PC, Railway, Render, VPS, GitHub Actions)
to extract leads from Google Maps into your Neon Postgres database.

Vercel handles the web dashboard, Neon Postgres stores all data.
This worker is only needed for the actual Playwright browser scraping.

Usage:
    python worker.py --niche "Dentists" --location "Delhi" --max 50

Or set environment variables and run continuously:
    python worker.py

Requirements:
    1. Copy .env.example to .env and fill DATABASE_URL, CLOUDINARY_* values.
    2. python -m playwright install chromium
    3. python worker.py --niche "Gyms" --location "Mumbai"
"""

import os
import sys
import argparse
import uuid
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# Ensure we can import from parent directory
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

import database
import exporter
from scraper import GoogleMapsScraper


def on_event(event: dict):
    evt = event.get("event", "")
    niche = ""
    if hasattr(on_event, "_scraper"):
        niche = on_event._scraper.niche

    timestamp = datetime.now().strftime("%H:%M:%S")

    if evt == "started":
        print(f"\n[{timestamp}] 🚀 Extraction Started")
        print(f"  Niche: {niche}")
        print(f"  Query: {event.get('current_item', '')}")
        print("-" * 60)

    elif evt == "new_lead":
        lead = event.get("data") or {}
        new_c = event.get("new_count", 0)
        print(f"[{timestamp}] ✅ #{new_c:03} EXTRACTED: {lead.get('name', '')}")
        if lead.get("phone"):
            print(f"         📞 {lead['phone']}", end="")
            if lead.get("whatsapp"):
                print(f"  💬 WA: +{lead['whatsapp']}", end="")
            print()
        if lead.get("email"):
            print(f"         ✉️  {lead['email']}")
        if lead.get("rating"):
            print(f"         ⭐ {lead['rating']} ({lead.get('reviews_count', 0)} reviews)")

    elif evt == "lead_skipped":
        skip_c = event.get("skipped_count", 0)
        name = (event.get("data") or {}).get("name", "")
        print(f"[{timestamp}] ⚠️  SKIPPED #{skip_c} (Already Extracted): {name}")

    elif evt == "extracting_lead":
        name = (event.get("data") or {}).get("name", "")
        print(f"[{timestamp}] 🔍 Checking: {name}")

    elif evt == "completed":
        new_c = event.get("new_count", 0)
        skip_c = event.get("skipped_count", 0)
        print("\n" + "=" * 60)
        print(f"[{timestamp}] ✅ EXTRACTION COMPLETED")
        print(f"  New leads extracted: {new_c}")
        print(f"  Duplicate records skipped: {skip_c}")
        print("=" * 60)

    elif evt == "stopped":
        print(f"\n[{timestamp}] ⛔ Extraction stopped by user.")

    elif evt == "error":
        err = (event.get("data") or {}).get("error", "Unknown error")
        print(f"\n[{timestamp}] ❌ ERROR: {err}")


def main():
    parser = argparse.ArgumentParser(description="Google Maps Lead Extractor Worker")
    parser.add_argument("--niche", type=str, help="Business niche/keyword (e.g. 'Dentists')")
    parser.add_argument("--location", type=str, default="", help="City/Location (e.g. 'Delhi')")
    parser.add_argument("--max", type=int, default=50, help="Max results to extract (default: 50)")
    args = parser.parse_args()

    niche = args.niche or os.getenv("EXTRACT_NICHE", "").strip()
    location = args.location or os.getenv("EXTRACT_LOCATION", "").strip()
    max_results = args.max or int(os.getenv("EXTRACT_MAX", "50"))

    if not niche:
        print("❌ Error: Please provide a --niche argument.")
        print("   Example: python worker.py --niche 'Dentists' --location 'Delhi' --max 50")
        sys.exit(1)

    print("=" * 60)
    print("  Google Maps Data Extractor Worker")
    db_type = "Neon Postgres" if database.IS_POSTGRES else "Local SQLite"
    print(f"  Database: {db_type}")
    print(f"  Niche: {niche}")
    print(f"  Location: {location or '(all locations)'}")
    print(f"  Max Results: {max_results}")
    print("=" * 60)

    # Initialize DB schema
    try:
        database.init_db()
        print("[DB] ✅ Database schema ready.")
    except Exception as e:
        print(f"[DB] ❌ Database init error: {e}")
        sys.exit(1)

    session_id = f"worker_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"

    scraper = GoogleMapsScraper(
        session_id=session_id,
        niche=niche,
        location=location,
        max_results=max_results,
        on_update=on_event
    )

    on_event._scraper = scraper

    try:
        scraper.run()
    except KeyboardInterrupt:
        print("\n\n[Worker] Interrupted by user. Saving progress...")
        scraper.stop()

    # After extraction, auto-generate and upload PDF to Cloudinary
    if scraper.new_count > 0:
        print("\n[Worker] Generating PDF report...")
        leads = database.get_leads(session_id=session_id)
        title = f"Google Maps Leads - {niche} in {location}" if location else f"Google Maps Leads - {niche}"
        pdf_stream, cloudinary_url = exporter.export_and_upload_pdf(leads, session_id=session_id, title=title)
        if cloudinary_url:
            print(f"[Cloudinary] ☁️  PDF uploaded: {cloudinary_url}")
        else:
            with open(f"leads_{session_id}.pdf", "wb") as f:
                f.write(pdf_stream.read())
            print(f"[PDF] 💾 Saved locally: leads_{session_id}.pdf")

    print("\n[Worker] Done! Your leads are saved to the database.")
    print(f"[Worker] Open your dashboard to view and download: http://localhost:5000")


if __name__ == "__main__":
    main()
