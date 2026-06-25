# OCR server setup (Tesseract)

The document-extraction features — passport MRZ, sick-leave parsing, scan-inbox
auto-triage, and ref detection on scan-backs — rely on the **Tesseract OCR
engine**. The Python wrappers (`pytesseract`, `PyMuPDF`) ship in the venv via
`requirements.txt`, but the Tesseract **binary and its language data are OS
packages** that must be installed on the host separately.

If Tesseract is missing, the OCR endpoints return a clean **503** ("OCR
unavailable") rather than crashing, and the scan-inbox drain leaves rows in
`pending_ocr` (capped to `error` after 3 attempts). PDFs that carry an embedded
text layer, and any QR/Aztec-stamped GSSG form, still work without OCR.

## What the app needs

1. The `tesseract` binary, reachable on PATH **or** at the standard install dir
   `C:\Program Files\Tesseract-OCR\tesseract.exe` (the code falls back to that
   path — see `app/core/extraction/ocr.py:_resolve_tesseract_cmd`).
2. **Both** the `eng` and `ara` language packs. The code requests
   `lang="ara+eng"`; if either pack is missing, the run fails — surfaced as a
   503 (a missing pack is translated to `OcrUnavailableError`, not a 500).

## Install on Windows

```powershell
# 1. Install the engine (UB-Mannheim build) — adds it to the system PATH.
winget install -e --id UB-Mannheim.TesseractOCR `
  --accept-package-agreements --accept-source-agreements --silent

# 2. The installer ships eng but NOT ara by default. Add the Arabic pack:
$dest = "C:\Program Files\Tesseract-OCR\tessdata\ara.traineddata"
Invoke-WebRequest -UseBasicParsing `
  -Uri "https://github.com/tesseract-ocr/tessdata/raw/main/ara.traineddata" `
  -OutFile $dest
```

> A Windows **service** inherits the PATH it had when it started, so after
> installing Tesseract you must **restart the GSSGManager service** (or reboot)
> for it to be picked up — unless it resolves via the standard-install-dir
> fallback above, which needs no PATH at all.

## Verify

```powershell
& "C:\Users\Admin\sentinel\venv\Scripts\python.exe" -c @'
import os
os.environ["PATH"] = r"C:\Program Files\Tesseract-OCR;" + os.environ["PATH"]
import sys; sys.path.insert(0, r"C:\Users\Admin\sentinel\backend")
from app.core.extraction import ocr
import pytesseract
print("available:", ocr.tesseract_available())
print("langs:", [l for l in pytesseract.get_languages() if l in ("ara", "eng")])
'@
```

Expected:

```
available: True
langs: ['ara', 'eng']
```

## Linux (reference)

```bash
sudo apt install tesseract-ocr tesseract-ocr-eng tesseract-ocr-ara
```
