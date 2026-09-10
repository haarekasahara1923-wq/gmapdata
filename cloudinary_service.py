import os
import io
from typing import Optional, Dict
from dotenv import load_dotenv

load_dotenv()

has_cloudinary = False
try:
    import cloudinary
    import cloudinary.uploader
    has_cloudinary = True
except ImportError:
    has_cloudinary = False

def is_cloudinary_configured() -> bool:
    if not has_cloudinary:
        return False
    if os.getenv("CLOUDINARY_URL"):
        return True
    return bool(
        os.getenv("CLOUDINARY_CLOUD_NAME") and
        os.getenv("CLOUDINARY_API_KEY") and
        os.getenv("CLOUDINARY_API_SECRET")
    )

def init_cloudinary():
    if not is_cloudinary_configured():
        return False
    
    if os.getenv("CLOUDINARY_URL"):
        cloudinary.config(cloudinary_url=os.getenv("CLOUDINARY_URL"))
    else:
        cloudinary.config(
            cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
            api_key=os.getenv("CLOUDINARY_API_KEY"),
            api_secret=os.getenv("CLOUDINARY_API_SECRET"),
            secure=True
        )
    return True

def upload_pdf_to_cloudinary(pdf_bytes_io: io.BytesIO, filename: str) -> Optional[str]:
    """
    Uploads a generated PDF BytesIO stream to Cloudinary and returns its permanent CDN URL.
    Returns None if Cloudinary is not configured or if upload fails.
    """
    if not init_cloudinary():
        return None

    try:
        pdf_bytes_io.seek(0)
        clean_name = filename.replace('.pdf', '')
        response = cloudinary.uploader.upload(
            pdf_bytes_io,
            resource_type="raw",
            folder="gmap_leads_pdf",
            public_id=clean_name,
            format="pdf",
            overwrite=True
        )
        return response.get("secure_url") or response.get("url")
    except Exception as e:
        print(f"[Cloudinary Upload Error]: {e}")
        return None
