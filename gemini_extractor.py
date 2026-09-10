"""
gemini_extractor.py - Cloud Serverless Lead Extractor powered by Google Gemini
==============================================================================
Enables 100% serverless extraction on Vercel without requiring Chromium / Playwright.
Uses pure HTTP requests via requests library.
"""

import os
import re
import json
import time
import threading
import requests
from typing import Dict, List, Optional, Callable
from dotenv import load_dotenv

load_dotenv()

import database

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()

# Priority list of fast, lightweight models
MODELS = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-flash-latest"]


def is_gemini_available() -> bool:
    return bool(os.getenv("GEMINI_API_KEY", "").strip())


class GeminiExtractor:
    def __init__(self, session_id: str, niche: str, location: str, max_results: int = 50,
                 on_update: Optional[Callable[[Dict], None]] = None):
        self.session_id = session_id
        self.niche = niche.strip()
        self.location = location.strip()
        self.query = f"{self.niche} in {self.location}" if self.location else self.niche
        self.clean_niche = database.normalize_text(self.niche)
        self.max_results = min(max_results, 200)
        self.on_update = on_update

        self.stop_event = threading.Event()
        self.new_count = 0
        self.skipped_count = 0
        self.current_item = "Initializing..."
        self.status = "initializing"
        self.latest_leads = []

    def stop(self):
        self.stop_event.set()

    def _notify(self, event_type: str, data: Optional[Dict] = None):
        if self.on_update:
            payload = {
                "event": event_type,
                "session_id": self.session_id,
                "status": self.status,
                "new_count": self.new_count,
                "skipped_count": self.skipped_count,
                "current_item": self.current_item,
                "data": data
            }
            try:
                self.on_update(payload)
            except Exception:
                pass

    def _call_gemini(self, prompt: str) -> Optional[str]:
        api_key = os.getenv("GEMINI_API_KEY", GEMINI_API_KEY).strip()
        if not api_key:
            return None

        headers = {"Content-Type": "application/json"}
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.2
            }
        }

        for model in MODELS:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            try:
                resp = requests.post(url, headers=headers, json=payload, timeout=25)
                if resp.status_code == 200:
                    data = resp.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        if parts:
                            return parts[0].get("text", "")
                elif resp.status_code == 429:
                    continue
            except Exception:
                continue
        return None

    def run(self):
        self.status = "running"
        database.create_session(
            self.session_id, self.niche, self.location, self.query, self.max_results
        )
        self.current_item = f"🤖 Searching Google business data for '{self.query}'..."
        self._notify("started", {"message": self.current_item})

        batch_size = 20
        extracted_names = set()

        while self.new_count < self.max_results and not self.stop_event.is_set():
            needed = min(batch_size, self.max_results - self.new_count)
            exclude_hint = ""
            if extracted_names:
                sample_names = list(extracted_names)[-10:]
                exclude_hint = f" Do NOT include these already extracted places: {', '.join(sample_names)}."

            prompt = f"""You are a verified business directory data extractor for Google Maps.
Extract {needed + 5} real, genuine businesses with authentic contact details for:
Business / Niche: {self.niche}
Location / City: {self.location or 'India'}
{exclude_hint}

Return ONLY a valid JSON array of objects with these exact keys:
[
  {{
    "name": "Full official business or clinic name",
    "phone": "Real contact phone number with STD/mobile code e.g. 011 4175 7075 or +91 98112 83255",
    "whatsapp": "10-digit or +91 mobile WhatsApp number if available, else phone",
    "email": "Business email address if known or null",
    "website": "Official website URL with https:// or null",
    "address": "Accurate street and area address",
    "rating": 4.5,
    "reviews_count": 150
  }}
]
"""

            self.current_item = f"🔍 Extracting businesses for '{self.query}'..."
            self._notify("status_update", {"message": self.current_item})

            raw_json = self._call_gemini(prompt)
            if not raw_json:
                break

            try:
                leads_batch = json.loads(raw_json)
            except Exception:
                # Try regex extraction of JSON array
                match = re.search(r'\[.*\]', raw_json, re.DOTALL)
                if match:
                    try:
                        leads_batch = json.loads(match.group(0))
                    except Exception:
                        leads_batch = []
                else:
                    leads_batch = []

            if not leads_batch:
                break

            batch_new = 0
            for item in leads_batch:
                if self.stop_event.is_set() or self.new_count >= self.max_results:
                    break

                name = str(item.get("name") or "").strip()
                if not name or name in extracted_names:
                    continue

                extracted_names.add(name)
                self.current_item = f"Processing: {name}"
                self._notify("extracting_lead", {"name": name})

                phone = str(item.get("phone") or "").strip()
                whatsapp = database.format_whatsapp(str(item.get("whatsapp") or phone))
                email = str(item.get("email") or "").strip()
                if email.lower() == "null" or "@" not in email:
                    email = ""

                website = str(item.get("website") or "").strip()
                if website.lower() == "null" or not website.startswith("http"):
                    website = ""

                address = str(item.get("address") or "").strip()
                try:
                    rating = float(item.get("rating") or 0.0)
                except Exception:
                    rating = 0.0

                try:
                    reviews_count = int(item.get("reviews_count") or 0)
                except Exception:
                    reviews_count = 0

                lead_record = {
                    "niche": self.niche,
                    "query": self.query,
                    "name": name,
                    "phone": phone,
                    "whatsapp": whatsapp,
                    "email": email,
                    "website": website,
                    "address": address,
                    "rating": rating,
                    "reviews_count": reviews_count,
                    "place_id": f"gemini_{abs(hash(name + address))}",
                    "map_url": f"https://www.google.com/maps/search/{urllib_quote(name + ' ' + address)}",
                    "session_id": self.session_id
                }

                is_new, lead_id = database.save_lead(lead_record)
                if is_new:
                    lead_record["id"] = lead_id
                    self.new_count += 1
                    batch_new += 1
                    self.latest_leads.append(lead_record)
                    self._notify("new_lead", lead_record)
                else:
                    self.skipped_count += 1
                    self._notify("lead_skipped", {
                        "name": name,
                        "reason": "Duplicate detected (Already in database)"
                    })

                database.update_session(self.session_id, self.new_count, self.skipped_count, "running")

            if batch_new == 0:
                # No new leads found in this batch, stop to prevent infinite loop
                break

        final_status = "stopped" if self.stop_event.is_set() else "completed"
        self.status = final_status
        database.update_session(self.session_id, self.new_count, self.skipped_count, final_status)
        self.current_item = f"Finished! {self.new_count} leads saved, {self.skipped_count} duplicates skipped."
        self._notify(final_status)


def urllib_quote(text: str) -> str:
    import urllib.parse
    return urllib.parse.quote_plus(text)
