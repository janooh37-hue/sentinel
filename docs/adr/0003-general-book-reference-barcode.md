---
status: proposed
---

# General Book reference barcode is a template font glyph, not a stamped image

The General Book paper was redesigned with an in-header Code 39 barcode set in the
embedded Libre Barcode 39 font, replacing the Aztec image the code stamped onto
every form. We decided the General Book's scannable code is now rendered by the
template (`{{ barcode }}` = `<REF>+<YYYYMMDD>`), the code path stamps no image on
it, and the other forms keep the Aztec until their papers are redesigned.

## Considered options

- Keep stamping an Aztec image and leave the template's barcode run decorative:
  two codes on one paper, and the template's design intent is lost.
- Render a Code 39 image instead of a glyph run: independent of host fonts, but
  fights the designed header layout and duplicates what the font already does.

## Consequences

- Code 39 cannot carry `:`; the `GSSG:` prefix stays Aztec-only. The General Book
  payload is validated by shape (`^[A-Z0-9/-]+\+\d{8}$`) instead of a prefix.
- Decodability depends on glyph size: 8 pt does not decode even at 300 dpi; the
  template uses 28 pt (24 pt is the measured floor at the 200 dpi scan raster).
- The Word host must have the template's fonts installed (`scripts/install-fonts.ps1`),
  and `zxing-cpp` must be installed in the runtime venv or nothing decodes.
- The paper date must be persisted at first commit; a re-render at signing may
  not move it, or the barcode would disagree with the paper.
- The redesigned paper carries no submitter G-number, so `_adapt_general_book`
  blanks `submitter_g` outright (not just skipping the page-1 → pages-2+ footer
  sync) and `retokenize_general_book` drops the token from saved templates. The
  other forms still print it.
