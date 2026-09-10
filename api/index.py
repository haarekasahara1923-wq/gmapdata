import os
import sys

# Ensure parent directory is on sys.path so app, database, exporter, scraper can be imported
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import app

# Vercel WSGI entry point
# This exports the Flask application as `app`
if __name__ == "__main__":
    app.run()
