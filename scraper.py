import re
import time
import urllib.parse
import threading
import requests
from bs4 import BeautifulSoup
from typing import Dict, Optional, Callable
from playwright.sync_api import sync_playwright

import database

EMAIL_REGEX = re.compile(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+')
INVALID_EMAIL_EXTS = ('.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.css', '.js', '.ico')

def extract_email_from_website(website_url: str, timeout: int = 4) -> Optional[str]:
    """Attempts to quickly fetch contact email from the business website."""
    if not website_url or not website_url.startswith("http"):
        return None
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        resp = requests.get(website_url, headers=headers, timeout=timeout, allow_redirects=True)
        if resp.status_code == 200:
            text = resp.text
            # 1. Search for mailto links
            soup = BeautifulSoup(text, 'html.parser')
            for a in soup.find_all('a', href=True):
                href = a['href']
                if href.startswith('mailto:'):
                    email = href.replace('mailto:', '').split('?')[0].strip()
                    if '@' in email and len(email) < 50:
                        return email.lower()

            # 2. Search regex in full page text
            matches = EMAIL_REGEX.findall(text)
            for email in matches:
                clean_email = email.lower()
                if not any(clean_email.endswith(ext) for ext in INVALID_EMAIL_EXTS):
                    if len(clean_email) < 50:
                        return clean_email
    except Exception:
        pass
    return None

class GoogleMapsScraper:
    def __init__(self, session_id: str, niche: str, location: str, max_results: int = 50,
                 headless: bool = False,
                 on_update: Optional[Callable[[Dict], None]] = None):
        self.session_id = session_id
        self.niche = niche.strip()
        self.location = location.strip()
        self.query = f"{self.niche} in {self.location}" if self.location else self.niche
        self.clean_niche = database.normalize_text(self.niche)
        self.max_results = max_results
        self.headless = headless
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
            self.on_update(payload)

    def run(self):
        self.status = "running"
        database.create_session(
            self.session_id, self.niche, self.location, self.query, self.max_results
        )
        self.current_item = f"🌐 Launching browser for '{self.query}'..."
        self._notify("started", {"message": self.current_item})

        encoded_query = urllib.parse.quote_plus(self.query)
        maps_url = f"https://www.google.com/maps/search/{encoded_query}?hl=en"

        try:
            with sync_playwright() as p:
                self.current_item = "🌐 Opening Google Maps..."
                self._notify("status_update", {"message": self.current_item})

                browser = p.chromium.launch(
                    headless=self.headless,
                    args=[
                        "--disable-blink-features=AutomationControlled",
                        "--no-sandbox",
                        "--disable-dev-shm-usage"
                    ]
                )
                context = browser.new_context(
                    viewport={"width": 1280, "height": 900},
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                )
                page = context.new_page()

                self.current_item = f"🔍 Searching Google Maps: '{self.query}'..."
                self._notify("status_update", {"message": self.current_item})

                page.goto(maps_url, wait_until="domcontentloaded", timeout=45000)

                # Consent handling
                time.sleep(2)
                for consent_sel in ['button[aria-label*="Accept all"]', 'button:has-text("Accept all")', 'button:has-text("I agree")']:
                    try:
                        if page.locator(consent_sel).first.is_visible(timeout=1500):
                            page.locator(consent_sel).first.click()
                            time.sleep(1)
                            break
                    except Exception:
                        pass

                # Check if search redirected directly to a single place
                single_place_title = None
                try:
                    h1 = page.locator("h1").first
                    if h1.is_visible(timeout=2500) and "/place/" in page.url:
                        single_place_title = h1.inner_text().strip()
                except Exception:
                    pass

                if single_place_title:
                    lead = self._parse_place_details(page, single_place_title, page.url, "")
                    if lead:
                        is_new, lead_id = database.save_lead(lead)
                        if is_new:
                            lead["id"] = lead_id
                            self.new_count += 1
                            self.latest_leads.append(lead)
                            self._notify("new_lead", lead)
                        else:
                            self.skipped_count += 1
                            self._notify("lead_skipped", {"name": lead.get("name"), "reason": "Already extracted"})
                    
                    self.status = "completed"
                    database.update_session(self.session_id, self.new_count, self.skipped_count, "completed")
                    self._notify("completed")
                    browser.close()
                    return

                # Wait for feed
                feed_selector = 'div[role="feed"]'
                try:
                    page.wait_for_selector(feed_selector, timeout=12000)
                except Exception:
                    pass

                processed_cards = set()
                consecutive_no_new = 0

                # Create dedicated worker page for place details
                detail_page = context.new_page()

                while self.new_count < self.max_results and not self.stop_event.is_set():
                    cards = page.locator('a.hfpxzc').all()
                    found_any_unprocessed = False

                    for card in cards:
                        if self.stop_event.is_set() or self.new_count >= self.max_results:
                            break

                        href = card.get_attribute("href") or ""
                        place_id_match = re.search(r'!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)', href)
                        place_id = place_id_match.group(1) if place_id_match else href.split("?")[0]
                        card_name = card.get_attribute("aria-label") or ""

                        card_key = place_id or card_name
                        if not card_key or card_key in processed_cards:
                            continue

                        processed_cards.add(card_key)
                        found_any_unprocessed = True

                        # Quick deduplication check before navigating to detail
                        if database.lead_exists_for_niche(self.clean_niche, place_id=place_id, name=card_name):
                            self.skipped_count += 1
                            self.current_item = f"Skipped (Already Extracted): {card_name}"
                            self._notify("lead_skipped", {
                                "name": card_name,
                                "reason": "Already in database for this niche"
                            })
                            continue

                        # Extract details using dedicated detail page
                        self.current_item = f"Extracting: {card_name}"
                        self._notify("extracting_lead", {"name": card_name})

                        try:
                            detail_page.goto(href, wait_until="domcontentloaded", timeout=25000)
                            time.sleep(1.5)
                            lead = self._parse_place_details(detail_page, card_name, href, place_id)
                        except Exception:
                            lead = None

                        if lead:
                            # Final deduplication check
                            is_new, lead_id = database.save_lead(lead)
                            if is_new:
                                lead["id"] = lead_id
                                self.new_count += 1
                                self.latest_leads.append(lead)
                                self._notify("new_lead", lead)
                            else:
                                self.skipped_count += 1
                                self._notify("lead_skipped", {
                                    "name": lead.get("name"),
                                    "reason": "Duplicate phone or address detected"
                                })

                        database.update_session(self.session_id, self.new_count, self.skipped_count, "running")

                    # Check exit condition
                    if self.stop_event.is_set() or self.new_count >= self.max_results:
                        break

                    # Check end of list indicator
                    try:
                        end_elem = page.locator('text="You\'ve reached the end of the list."').first
                        if end_elem.is_visible(timeout=500):
                            break
                    except Exception:
                        pass

                    # Scroll feed down
                    try:
                        feed = page.locator(feed_selector).first
                        feed.evaluate("el => el.scrollBy(0, 1200)")
                        time.sleep(1.8)
                    except Exception:
                        page.mouse.wheel(0, 900)
                        time.sleep(1.8)

                    if not found_any_unprocessed:
                        consecutive_no_new += 1
                        if consecutive_no_new >= 4:
                            break
                    else:
                        consecutive_no_new = 0

                try:
                    detail_page.close()
                except Exception:
                    pass
                browser.close()

            final_status = "stopped" if self.stop_event.is_set() else "completed"
            self.status = final_status
            database.update_session(self.session_id, self.new_count, self.skipped_count, final_status)
            self._notify(final_status)

        except Exception as e:
            self.status = "error"
            database.update_session(self.session_id, self.new_count, self.skipped_count, "error")
            self._notify("error", {"error": str(e)})

    def _parse_place_details(self, page, card_name: str, href: str, place_id: str) -> Optional[Dict]:
        try:
            # 1. Name
            name = card_name
            try:
                name_el = page.locator("h1").first
                if name_el.is_visible(timeout=1500):
                    name = name_el.inner_text().strip()
            except Exception:
                pass

            if not name:
                return None

            # 2. Rating & Reviews
            rating = 0.0
            reviews_count = 0
            try:
                rating_el = page.locator('div.F7nice span[aria-hidden="true"]').first
                if rating_el.is_visible(timeout=800):
                    r_text = rating_el.inner_text().strip()
                    rating = float(r_text.replace(",", "."))
            except Exception:
                pass

            try:
                reviews_el = page.locator('div.F7nice span:nth-child(2) > span').first
                if reviews_el.is_visible(timeout=800):
                    rev_text = reviews_el.inner_text().strip()
                    rev_digits = re.sub(r'\D', '', rev_text)
                    if rev_digits:
                        reviews_count = int(rev_digits)
            except Exception:
                pass

            # 3. Address
            address = ""
            try:
                addr_btn = page.locator('button[data-item-id="address"]').first
                if addr_btn.is_visible(timeout=1000):
                    aria = addr_btn.get_attribute("aria-label") or ""
                    if aria:
                        address = aria.replace("Address:", "").strip()
                    else:
                        address = addr_btn.inner_text().strip()
            except Exception:
                pass

            # 4. Phone
            phone = ""
            try:
                phone_btn = page.locator('button[data-item-id^="phone:"]').first
                if phone_btn.is_visible(timeout=1000):
                    aria = phone_btn.get_attribute("aria-label") or ""
                    if aria:
                        phone = aria.replace("Phone:", "").strip()
                    else:
                        phone = phone_btn.inner_text().strip()
            except Exception:
                pass

            # WhatsApp formatting
            whatsapp = database.format_whatsapp(phone)

            # 5. Website
            website = ""
            try:
                web_link = page.locator('a[data-item-id="authority"]').first
                if web_link.is_visible(timeout=1000):
                    website = web_link.get_attribute("href") or ""
            except Exception:
                pass

            # 6. Email discovery
            email = ""
            if website and website.startswith("http"):
                email = extract_email_from_website(website, timeout=3) or ""

            return {
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
                "place_id": place_id,
                "map_url": href if href.startswith("http") else f"https://www.google.com{href}",
                "session_id": self.session_id
            }
        except Exception:
            return None
