@echo off
title Google Maps Data Extractor Pro - Next.js SaaS Edition
echo ========================================================
echo    Google Maps Data Extractor Pro - Next.js SaaS Edition
echo    Vercel + Neon Postgres + Gemini AI
echo ========================================================
echo.
cd /d "%~dp0"

echo [1/2] Checking dependencies...
call npm install --legacy-peer-deps

echo.
echo [2/2] Starting Next.js SaaS App...
echo    ^> Web App: http://localhost:3000
echo.
start "" "http://localhost:3000"
call npm run dev

pause
