"""OCR extraction engine: OCR → classify → typed extractors → structured result.

Pure-Python; nothing here imports FastAPI or SQLAlchemy. ``ocr`` is the only
module that touches Tesseract/Pillow/fitz.
"""
