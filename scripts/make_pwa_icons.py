# scripts/make_pwa_icons.py  — run: venv\Scripts\python.exe -X utf8 scripts\make_pwa_icons.py
"""One-shot PWA icon generator for GSSG Manager.

Resizes from the 512x512 RGBA master at frontend/src-tauri/icons/icon.png.
Produces:
  frontend/public/icons/icon-192.png
  frontend/public/icons/icon-512.png
  frontend/public/icons/apple-touch-icon.png  (180x180)
  frontend/public/icons/icon-192-maskable.png
  frontend/public/icons/icon-512-maskable.png

Maskable icons paste the logo centered on a background-color square with ~10%
safe-zone padding so the icon looks good when cropped to a circle/squircle.
The BG colour (#0f172a) matches the manifest's background_color / theme_color.

Re-run whenever the source icon changes; output files are committed to the repo.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src-tauri" / "icons" / "icon.png"  # 512x512 RGBA
OUT = ROOT / "frontend" / "public" / "icons"
BG = (15, 23, 42, 255)  # #0f172a — must match manifest background_color


def resize(size: int, name: str) -> None:
    img = Image.open(SRC).convert("RGBA").resize((size, size), Image.LANCZOS)
    img.save(OUT / name)


def maskable(size: int, name: str) -> None:
    """Paste logo centered with 10% safe-zone padding onto a solid BG."""
    pad = round(size * 0.10)
    inner = size - 2 * pad
    logo = Image.open(SRC).convert("RGBA").resize((inner, inner), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), BG)
    canvas.alpha_composite(logo, (pad, pad))
    canvas.save(OUT / name)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    resize(192, "icon-192.png")
    resize(512, "icon-512.png")
    resize(180, "apple-touch-icon.png")
    maskable(192, "icon-192-maskable.png")
    maskable(512, "icon-512-maskable.png")
    print("wrote", sorted(p.name for p in OUT.glob("*.png")))
