/**
 * Configuration constants for the RichEditor.
 *
 * Kept in a .ts (non-component) file because the react-refresh ESLint rule
 * forbids non-component exports in .tsx files. The values are ported verbatim
 * from `editor/editor.html` (the user-tuned TinyMCE setup) so the HugeRTE
 * variant matches what they're already used to in the Qt desktop editor.
 */

export const MINIMAL_PLUGINS =
  'lists link image table directionality charmap searchreplace'

export const MINIMAL_TOOLBAR =
  'bold italic underline | forecolor backcolor | ' +
  'alignleft aligncenter alignright | bullist numlist | ltr rtl | ' +
  'link table | removeformat'

export const FULL_PLUGINS = [
  'advlist', 'autolink', 'lists', 'link', 'image', 'charmap',
  'searchreplace', 'visualblocks', 'code', 'fullscreen',
  'insertdatetime', 'media', 'table', 'help', 'wordcount',
  'directionality', 'preview', 'anchor', 'pagebreak', 'nonbreaking',
].join(' ')

// Two independent rows, both always visible — nothing hides into a "..." overflow.
// Row 1 = formatting + custom GSSG buttons (+ pagebreak: the General Book's
// page control, promoted from row 2 where nobody found it).
// Row 2 = layout & tools.
export const FULL_TOOLBAR_ROWS: string[] = [
  'undo redo | gssg-template-save gssg-template-load gssg-table pagebreak | ' +
    'fontfamily fontsize lineheight | ' +
    'bold italic underline strikethrough | ' +
    'forecolor backcolor removeformat',
  'alignleft aligncenter alignright alignjustify | ltr rtl | ' +
    'bullist numlist outdent indent | ' +
    'link image table charmap | ' +
    'searchreplace fullscreen preview help',
]

export const FONT_FAMILY_FORMATS =
  'Calibri=Calibri,sans-serif;' +
  'Arial=Arial,Helvetica,sans-serif;' +
  'Segoe UI=Segoe UI,Tahoma,sans-serif;' +
  'Tahoma=Tahoma,sans-serif;' +
  'Times New Roman=Times New Roman,Times,serif;' +
  'Verdana=Verdana,sans-serif;' +
  'Amiri=Amiri,Times New Roman,serif;' +
  'Cairo=Cairo,sans-serif;' +
  'Traditional Arabic=Traditional Arabic,serif;' +
  'Simplified Arabic=Simplified Arabic,Arial,sans-serif'

export const FONT_SIZE_FORMATS =
  '8pt 9pt 10pt 11pt 12pt 14pt 16pt 18pt 20pt 24pt 28pt 32pt 36pt 48pt 72pt'

export const LINE_HEIGHT_FORMATS = '1 1.15 1.5 2 2.5 3'

export const BLOCK_FORMATS =
  'Paragraph=p; Heading 1=h1; Heading 2=h2; Heading 3=h3; ' +
  'Heading 4=h4; Preformatted=pre'

// Default GSSG table snippet inserted by the "gssg-table" custom button.
// 4-column header + 3 body rows — the layout matches v3's tableformat.txt.
// If the operator wants a different default, they can override via
// `<data_dir>/snippets/tableformat.html` (read by a future backend endpoint).
export const GSSG_DEFAULT_TABLE_HTML = `
<table dir="rtl" style="border-collapse: collapse; width: 100%; font-family: Calibri, 'Segoe UI', sans-serif; font-size: 12pt;">
  <thead>
    <tr style="background: #34495e; color: #fff;">
      <th style="border: 1px solid #888; padding: 6px 8px; text-align: center;">م</th>
      <th style="border: 1px solid #888; padding: 6px 8px; text-align: center;">البيان</th>
      <th style="border: 1px solid #888; padding: 6px 8px; text-align: center;">التاريخ</th>
      <th style="border: 1px solid #888; padding: 6px 8px; text-align: center;">ملاحظات</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="border: 1px solid #888; padding: 6px 8px; text-align: center;">1</td>
      <td style="border: 1px solid #888; padding: 6px 8px;">&nbsp;</td>
      <td style="border: 1px solid #888; padding: 6px 8px;">&nbsp;</td>
      <td style="border: 1px solid #888; padding: 6px 8px;">&nbsp;</td>
    </tr>
    <tr>
      <td style="border: 1px solid #888; padding: 6px 8px; text-align: center;">2</td>
      <td style="border: 1px solid #888; padding: 6px 8px;">&nbsp;</td>
      <td style="border: 1px solid #888; padding: 6px 8px;">&nbsp;</td>
      <td style="border: 1px solid #888; padding: 6px 8px;">&nbsp;</td>
    </tr>
    <tr>
      <td style="border: 1px solid #888; padding: 6px 8px; text-align: center;">3</td>
      <td style="border: 1px solid #888; padding: 6px 8px;">&nbsp;</td>
      <td style="border: 1px solid #888; padding: 6px 8px;">&nbsp;</td>
      <td style="border: 1px solid #888; padding: 6px 8px;">&nbsp;</td>
    </tr>
  </tbody>
</table>
<p>&nbsp;</p>
`.trim()

export interface RichEditorPageView {
  /** CSS px width of the printable page content (A4 width − template side margins). */
  pageWidthPx: number
  /** Usable body height on page 1 (letterhead + subject block already deducted). */
  page1BodyPx: number
  /** Usable body height on pages 2+. */
  pageNBodyPx: number
}

// Measured from GSSG-GS_300-003_General_Book.docx via
// backend/scripts/measure_general_book_pages.py (A4 595.3x841.9pt, margins
// L35.45/R36/T36/B36pt, px = pt * 4/3 @96dpi). Re-run the script if the
// template layout changes in Word.
export const GENERAL_BOOK_PAGE_VIEW: RichEditorPageView = {
  pageWidthPx: 698, // <- script output
  page1BodyPx: 524, // <- script output
  pageNBodyPx: 865, // <- script output
}

const GUIDE_COLOR = '#c0392b'
const GUIDE_PAGES = 12 // static guide lines cover any realistic book length

export function buildContentStyle(opts: {
  variant: 'minimal' | 'full'
  pageView?: RichEditorPageView
  /** When true, render the editor body with a dark surface + light text so it
   * doesn't stay white in the app's dark theme. (Page view keeps white paper —
   * it previews the printed page.) */
  dark?: boolean
}): string {
  // The editor body lives in an iframe and doesn't inherit the app's CSS vars,
  // so dark-mode colours are baked in here as literals.
  const paper = opts.pageView ? '#fff' : opts.dark ? '#1c2026' : '#fff'
  const fg = opts.pageView ? '#1a2433' : opts.dark ? '#e6e6e6' : 'inherit'
  const baseFont =
    "body { font-family: 'Noto Sans Arabic', Calibri, 'Segoe UI', Tahoma, sans-serif; " +
    'font-size: 12pt; line-height: 1.5; direction: rtl; padding: 0.5in; ' +
    'background: ' + paper + '; color: ' + fg + '; position: relative; min-height: 100%; } ' +
    'table { border-collapse: collapse; line-height: 1.15; } ' +
    'table td, table th { border: 1px solid #888; padding: 4px 6px; } ' +
    'table p { margin: 0; } ' +
    'p { margin: 0 0 0.5em 0; }'

  if (!opts.pageView || opts.variant === 'minimal') {
    return baseFont
  }

  const { pageWidthPx, page1BodyPx, pageNBodyPx } = opts.pageView
  // Page k (1-based) ends at page1BodyPx + (k-1) * pageNBodyPx in content
  // coordinates. Discrete gradient layers beat a repeating gradient here —
  // a repeating layer would also paint lines above the first page end.
  const ends = Array.from(
    { length: GUIDE_PAGES },
    (_, i) => page1BodyPx + i * pageNBodyPx,
  )
  const guides = ends
    .map(
      (y) =>
        `linear-gradient(to bottom, transparent ${y - 2}px, ${GUIDE_COLOR} ${y - 2}px ${y}px, transparent ${y}px)`,
    )
    .join(', ')

  const desk = opts.dark ? '#262a31' : '#9aa3ad'
  return (
    baseFont +
    ' html { background: ' + desk + '; } ' +
    'body { width: ' + String(pageWidthPx) + 'px; max-width: ' + String(pageWidthPx) + 'px; ' +
    'margin: 18px auto; box-sizing: border-box; ' +
    'box-shadow: 0 2px 6px rgba(0,0,0,.25), 0 12px 30px rgba(0,0,0,.28); ' +
    'background-image: ' + guides + '; ' +
    'background-origin: content-box; background-repeat: no-repeat; background-position: 0 0; ' +
    'min-height: ' + String(page1BodyPx + 60) + 'px; } ' +
    // Label on the first page end only (the rest are plain lines).
    // top uses calc(0.5in + page1BodyPx) because ::after positions against the
    // padding box while guides use content-box origin (after padding).
    "body::after { content: '≈ نهاية الصفحة 1 · page 1 end'; " +
    'position: absolute; left: 0; right: 0; top: calc(0.5in + ' + String(page1BodyPx) + 'px); ' +
    'color: ' + GUIDE_COLOR + '; ' +
    "font-size: 9pt; font-family: 'Segoe UI', Tahoma, sans-serif; " +
    'direction: ltr; text-align: center; padding-top: 2px; ' +
    'pointer-events: none; opacity: 0.85; } ' +
    // The inserted page break: an obvious double-ruled bar, not faint dashes.
    'img.mce-pagebreak { display: block; width: 100%; height: 12px; margin: 12px 0; ' +
    'border: 0; border-top: 3px double #1d3a5e; border-bottom: 3px double #1d3a5e; ' +
    'cursor: default; }'
  )
}
