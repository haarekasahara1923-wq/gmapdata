# Google Maps Data Extractor Pro 🚀

Google Maps se business leads extract karne ka advanced tool, jisme **smart niche-based deduplication**, **live real-time display**, aur **CSV / Excel / PDF** exports shamil hain.

---

## 🌟 Key Features

1. **Targeted Extraction**:
   - **Niche / Business Type**: e.g., *Dentists, Gyms, Real Estate, Hospitals, Cafes, Digital Marketing*.
   - **Location / City**: e.g., *Delhi, Mumbai, Sector 62 Noida, Connaught Place*.
   - **Max Results**: 20, 50, 100, 200 ya 500 leads tak configure karein.

2. **Tabular Data Extracted**:
   - 🏢 **Business Name**: Full company/shop name (Google Maps link ke sath).
   - ⭐ **Rating & Reviews**: Star rating aur total review count.
   - 📞 **Mobile / Phone Number**: Contact number (1-click copy button ke sath).
   - 💬 **WhatsApp Number**: Direct 1-click WhatsApp web chat link (`wa.me/<number>`).
   - ✉️ **Email ID**: Website aur listing se auto-detected contact email.
   - 🌐 **Website**: Official clickable website link.
   - 📍 **Full Address**: Complete address.

3. **Smart Niche Deduplication (Duplicate Protection)**:
   - Jab aap **wahi same niche dobara run karenge**, to pichhle extractions ke records auto-detect ho jaate hain aur unhe **skip** kar diya jata hai.
   - Sirf **fresh / new leads** hi extract hokar save hoti hain.
   - Live counters par dikhai deta hai:
     - 🟢 **Newly Extracted**
     - 🟡 **Already Extracted (Skipped)**
     - 🔵 **Total for this Niche**
     - 🟣 **All Time Database Total**

4. **Multi-Format Downloads**:
   - 📥 **CSV Export**: Standard UTF-8 BOM encoding.
   - 📊 **Excel Export (.xlsx)**: Styled header, alternating rows, auto column widths.
   - 📄 **PDF Export**: Professional landscape table report.

---

## 🚀 How to Run

### Option 1: 1-Click Launch (Windows)
Double click karein `run.bat` file par:
```bat
run.bat
```
Yeh server start kar dega aur aapke default browser me `http://localhost:5000` automatically open ho jayega.

### Option 2: Command Line Se Run Karna
1. Terminal open karein:
```powershell
cd C:\Users\baba\Desktop\GmapData
python app.py
```
2. Browser me open karein:
```
http://localhost:5000
```

---

## 📁 Project Structure

```
GmapData/
├── app.py                # Flask server, REST API & export endpoints
├── scraper.py            # Playwright Google Maps scraper engine
├── database.py           # SQLite database with duplicate detection
├── exporter.py           # CSV, Excel (.xlsx), PDF generators
├── requirements.txt      # Python dependencies
├── run.bat               # 1-click Windows runner
├── test_suite.py         # Automated verification tests
├── data/
│   └── gmap_extractor.db # Persistent leads database
├── templates/
│   └── index.html        # Modern frontend UI with Tailwind CSS & Lucide icons
└── static/
    ├── css/style.css     # Custom styles & scrollbars
    └── js/app.js         # Real-time SSE listener & table controls
```
