# Google Maps Data Extractor Pro - SaaS Edition 🚀

A **production-ready SaaS Web App** for extracting Google Maps business leads.  
Deploy to **Vercel** in one click, backed by **Neon Postgres** for serverless database and **Cloudinary** for PDF cloud storage.

---

## ✨ Features

| Feature | Details |
|---|---|
| 🗓️ **Date-wise Dashboard** | Opens to a history of all past extractions with niche, date, new/skipped count, status |
| 👁️ **Drill-Down View** | Click any past extraction to see the full tabular leads data |
| 🧠 **Smart Deduplication** | Same niche, different day → only NEW businesses are saved, duplicates auto-skipped |
| 📞 **Phone + WhatsApp** | Phone numbers with 1-click WhatsApp direct chat links |
| ✉️ **Email Discovery** | Auto-detected from business websites (mailto & regex scan) |
| ⭐ **Rating & Reviews** | Star rating + total review count |
| 📥 **CSV / Excel / PDF** | Export any extraction session. PDF is uploaded to **Cloudinary CDN** if configured |
| 🌐 **Vercel Ready** | `vercel.json` + `api/index.py` serverless entry included |
| 🐘 **Neon Postgres** | Full dual-mode: Neon Postgres in prod, SQLite for local dev |
| ☁️ **Cloudinary PDF** | PDFs auto-uploaded to cloud on extraction completion. Permanent share links |

---

## 🚀 Quick Local Start

Double-click **`run.bat`** — or in PowerShell:
```bash
cd C:\Users\baba\Desktop\GmapData
python app.py
```
Then open: **http://localhost:5000**

---

## 🌐 Vercel Deployment (Production SaaS)

### Step 1: Push to GitHub
```bash
git remote add origin https://github.com/YOUR_USERNAME/gmap-extractor.git
git push -u origin master
```

### Step 2: Create Neon Postgres Database
1. Go to → **https://neon.tech** and sign up (free)
2. Create a new project → copy the **Connection String** (looks like `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`)

### Step 3: Create Cloudinary Account (for PDF CDN)
1. Go to → **https://cloudinary.com** and sign up (free)
2. From your dashboard copy: **Cloud Name**, **API Key**, **API Secret**

### Step 4: Deploy to Vercel
1. Go to → **https://vercel.com** → New Project → Import from GitHub
2. Select your `gmap-extractor` repo
3. Go to **Settings → Environment Variables** and add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your Neon Postgres connection string |
| `CLOUDINARY_CLOUD_NAME` | Your Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Your Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Your Cloudinary API secret |
| `SECRET_KEY` | Any random secret string |

4. Click **Deploy** ✅

> 📌 **Note about Scraping on Vercel**: The dashboard, database queries, session history, drill-down views, and exports all work natively on Vercel. For the Playwright-based scraper (which requires Chromium), run it locally using `python worker.py` — it writes directly to your Neon Postgres DB and uploads PDFs to Cloudinary.

---

## 🖥️ Running the Scraper (Worker)

For extracting leads (run locally or on any server/VPS):

```bash
# Scrape 50 dentists in Delhi
python worker.py --niche "Dentists" --location "Delhi" --max 50

# Scrape 100 gyms in Mumbai
python worker.py --niche "Gym" --location "Mumbai" --max 100

# Scrape all hospitals in Noida
python worker.py --niche "Hospital" --location "Sector 62 Noida" --max 200
```

Results go directly into your **Neon Postgres DB** and are instantly visible in your **Vercel dashboard** — no restart needed.

---

## 📁 Project Structure

```
GmapData/
├── app.py                  # Flask server - REST API, session history, exports
├── scraper.py              # Playwright Google Maps scraper engine
├── database.py             # Dual-mode: Neon Postgres + SQLite fallback
├── exporter.py             # CSV, Excel (.xlsx), PDF (with Cloudinary upload)
├── cloudinary_service.py   # Cloudinary PDF CDN integration
├── worker.py               # Standalone CLI scraper - writes to Neon DB
├── requirements.txt        # All Python dependencies
├── vercel.json             # Vercel routing + serverless config
├── api/index.py            # Vercel serverless entry point
├── .env.example            # Environment variable template
├── .gitignore              # Git ignore rules
├── run.bat                 # Windows 1-click local runner
├── test_suite.py           # Automated tests (deduplication + exporters)
├── templates/index.html    # SaaS Dashboard UI (Tailwind CSS + Lucide icons)
└── static/
    ├── css/style.css
    └── js/app.js           # Dashboard controller, SSE live updates
```

---

## 🧪 Local .env Setup

Copy `.env.example` to `.env` and fill in your credentials:
```bash
copy .env.example .env
```

Then edit `.env`:
```
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
SECRET_KEY=some-random-secret-key
```

---

## 🔒 Deduplication Logic

When you run the same niche again (e.g. "Dentists in Delhi" twice):

1. Each business is checked against the database using:
   - Google Maps **Place ID**
   - Normalized **Phone Number** (10-digit → `91XXXXXXXXXX`)
   - Business **Name + Address prefix** match
2. If any match found → **SKIPPED** (count shown in dashboard)
3. If no match → **SAVED** as new lead (shown in green)

This ensures zero duplicate leads per niche — forever.
