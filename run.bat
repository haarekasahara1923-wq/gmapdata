@echo off
title Google Maps Data Extractor Pro - SaaS Edition
echo ========================================================
echo    Google Maps Data Extractor Pro - SaaS Edition
echo    Vercel + Neon Postgres + Cloudinary
echo ========================================================
echo.
cd /d "%~dp0"

echo [1/3] Checking Python dependencies...
python -m pip install -r requirements.txt --quiet
python -m playwright install chromium --quiet

echo [2/3] Starting Flask server...
echo    > Web App: http://localhost:5000
echo    > Database: See .env for Neon Postgres or using local SQLite
echo.
echo [3/3] Opening browser...
start "" "http://localhost:5000"
python app.py

pause
