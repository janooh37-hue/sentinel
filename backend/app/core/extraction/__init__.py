"""OCR extraction engine: OCR → classify → typed extractors → structured result.

Pure-Python; nothing here imports FastAPI or SQLAlchemy. ``ocr`` is the only
module that touches Tesseract/Pillow; its PyMuPDF work runs in the confined
worker process (``app.core.pdf_worker``), never in the calling thread.
"""
