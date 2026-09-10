import os
import uuid
import queue
import json
import threading
from datetime import datetime
from flask import Flask, render_template, request, jsonify, Response, send_file, redirect
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

import database
import exporter
import cloudinary_service
from scraper import GoogleMapsScraper

app = Flask(__name__, template_folder="templates", static_folder="static")
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key-12345')
CORS(app)

# Active scraper tracker
active_scraper = None
active_session_id = None
live_events_subscribers = []
subscribers_lock = threading.Lock()

def broadcast_event(event_data: dict):
    with subscribers_lock:
        dead_queues = []
        for q in live_events_subscribers:
            try:
                q.put_nowait(event_data)
            except Exception:
                dead_queues.append(q)
        for dq in dead_queues:
            if dq in live_events_subscribers:
                live_events_subscribers.remove(dq)

def on_scraper_update(data: dict):
    broadcast_event(data)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/system/status', methods=['GET'])
def system_status():
    stats = database.get_db_stats()
    return jsonify({
        "database": stats.get("database_type", "SQLite"),
        "cloudinary": cloudinary_service.is_cloudinary_configured(),
        "stats": stats
    })

@app.route('/api/stats', methods=['GET'])
def get_stats():
    stats = database.get_db_stats()
    return jsonify(stats)

@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    """Returns date-wise extraction history for the SaaS dashboard."""
    limit = int(request.args.get('limit', 100))
    sessions = database.get_all_sessions(limit=limit)
    return jsonify({"sessions": sessions, "count": len(sessions)})

@app.route('/api/sessions/<session_id>', methods=['GET'])
def get_session_details(session_id):
    session = database.get_session_by_id(session_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404
    leads = database.get_leads(session_id=session_id)
    return jsonify({
        "session": session,
        "leads": leads,
        "count": len(leads)
    })

@app.route('/api/niches', methods=['GET'])
def get_niches():
    niches = database.get_all_niches()
    return jsonify({"niches": niches})

@app.route('/api/leads', methods=['GET'])
def get_leads():
    niche = request.args.get('niche')
    session_id = request.args.get('session_id')
    search = request.args.get('search')
    limit = int(request.args.get('limit', 2000))
    leads = database.get_leads(niche=niche, session_id=session_id, search=search, limit=limit)
    return jsonify({"leads": leads, "count": len(leads)})

@app.route('/api/extract/start', methods=['POST'])
def start_extraction():
    global active_scraper, active_session_id

    if active_scraper and active_scraper.status in ('running', 'initializing'):
        return jsonify({"error": "An extraction is already in progress. Please wait or click Stop."}), 400

    data = request.get_json() or {}
    niche = (data.get('niche') or "").strip()
    location = (data.get('location') or "").strip()
    max_results = int(data.get('max_results') or 50)
    # If explicitly passed use it; otherwise False for local (visible browser) and True if SCRAPER_HEADLESS=true
    env_headless = os.getenv("SCRAPER_HEADLESS", "false").lower() in ("1", "true")
    headless = data.get('headless', env_headless)

    if not niche:
        return jsonify({"error": "Please specify a niche or business category."}), 400

    active_session_id = f"sess_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    active_scraper = GoogleMapsScraper(
        session_id=active_session_id,
        niche=niche,
        location=location,
        max_results=max_results,
        headless=headless,
        on_update=on_scraper_update
    )

    t = threading.Thread(target=active_scraper.run, daemon=True)
    t.start()

    return jsonify({
        "success": True,
        "session_id": active_session_id,
        "niche": niche,
        "location": location,
        "max_results": max_results,
        "status": "started"
    })

@app.route('/api/extract/status', methods=['GET'])
def get_extraction_status():
    global active_scraper, active_session_id
    if not active_scraper:
        return jsonify({
            "status": "idle",
            "session_id": None,
            "new_count": 0,
            "skipped_count": 0,
            "current_item": ""
        })

    return jsonify({
        "status": active_scraper.status,
        "session_id": active_scraper.session_id,
        "niche": active_scraper.niche,
        "location": active_scraper.location,
        "query": active_scraper.query,
        "new_count": active_scraper.new_count,
        "skipped_count": active_scraper.skipped_count,
        "current_item": active_scraper.current_item,
        "leads": active_scraper.latest_leads
    })

@app.route('/api/extract/stop', methods=['POST'])
def stop_extraction():
    global active_scraper
    if active_scraper and active_scraper.status in ('running', 'initializing'):
        active_scraper.stop()
        return jsonify({"success": True, "message": "Extraction stopping..."})
    return jsonify({"success": False, "message": "No active extraction to stop."})

@app.route('/api/extract/stream')
def extract_stream():
    def event_stream():
        client_queue = queue.Queue(maxsize=100)
        with subscribers_lock:
            live_events_subscribers.append(client_queue)

        try:
            yield f"data: {json.dumps({'event': 'connected'})}\n\n"
            while True:
                try:
                    data = client_queue.get(timeout=25)
                    yield f"data: {json.dumps(data)}\n\n"
                except queue.Empty:
                    yield f": keep-alive\n\n"
        except GeneratorExit:
            with subscribers_lock:
                if client_queue in live_events_subscribers:
                    live_events_subscribers.remove(client_queue)

    return Response(event_stream(), mimetype="text/event-stream")

@app.route('/api/leads/delete', methods=['POST'])
def delete_leads():
    data = request.get_json() or {}
    clean_niche = data.get('clean_niche')
    database.clear_leads(clean_niche=clean_niche)
    return jsonify({"success": True, "message": "Records deleted successfully."})

@app.route('/api/export/csv', methods=['GET'])
def download_csv():
    niche = request.args.get('niche')
    session_id = request.args.get('session_id')
    leads = database.get_leads(niche=niche, session_id=session_id, limit=5000)
    
    file_stream = exporter.export_to_csv(leads)
    filename = f"leads_{niche or session_id or 'export'}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return send_file(
        file_stream,
        mimetype="text/csv",
        as_attachment=True,
        download_name=filename
    )

@app.route('/api/export/excel', methods=['GET'])
def download_excel():
    niche = request.args.get('niche')
    session_id = request.args.get('session_id')
    leads = database.get_leads(niche=niche, session_id=session_id, limit=5000)
    
    title = f"Leads - {niche}" if niche else "All Extracted Leads"
    file_stream = exporter.export_to_excel(leads, title=title)
    filename = f"leads_{niche or session_id or 'export'}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return send_file(
        file_stream,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=filename
    )

@app.route('/api/export/pdf', methods=['GET'])
def download_pdf():
    niche = request.args.get('niche')
    session_id = request.args.get('session_id')
    leads = database.get_leads(niche=niche, session_id=session_id, limit=500)
    
    title = f"Google Maps Leads - {niche}" if niche else "Google Maps Extracted Leads"
    
    # Check if session already has a Cloudinary PDF link
    if session_id:
        sess = database.get_session_by_id(session_id)
        if sess and sess.get("pdf_cloudinary_url"):
            # Redirect directly to Cloudinary CDN
            return redirect(sess["pdf_cloudinary_url"])

    # Generate and upload to Cloudinary (or local stream)
    file_stream, cloudinary_url = exporter.export_and_upload_pdf(leads, session_id=session_id, title=title)
    
    # If client asked for json url
    if request.args.get('format') == 'json' and cloudinary_url:
        return jsonify({"success": True, "pdf_url": cloudinary_url})

    if cloudinary_url and request.args.get('redirect') == 'true':
        return redirect(cloudinary_url)

    filename = f"leads_{niche or session_id or 'export'}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    return send_file(
        file_stream,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename
    )

if __name__ == '__main__':
    database.init_db()
    port = int(os.getenv('PORT', 5000))
    print(f"Google Maps Data Extractor SaaS is running at http://localhost:{port}")
    app.run(host='0.0.0.0', port=port, debug=False)
