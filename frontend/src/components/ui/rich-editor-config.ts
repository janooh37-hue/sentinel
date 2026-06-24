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
// Row 1 = formatting + custom GSSG buttons. Row 2 = layout & tools.
export const FULL_TOOLBAR_ROWS: string[] = [
  'undo redo | gssg-template-save gssg-template-load gssg-table | ' +
    'fontfamily fontsize lineheight | ' +
    'bold italic underline strikethrough | ' +
    'forecolor backcolor removeformat',
  'alignleft aligncenter alignright alignjustify | ltr rtl | ' +
    'bullist numlist outdent indent | ' +
    'link image table charmap pagebreak | ' +
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

export function buildContentStyle(opts: {
  variant: 'minimal' | 'full'
  pageHeightPx?: number
  /** When true, render the editor body with a dark surface + light text so it
   * doesn't stay white in the app's dark theme. */
  dark?: boolean
}): string {
  // The editor body lives in an iframe and doesn't inherit the app's CSS vars,
  // so dark-mode colours are baked in here as literals.
  const bg = opts.dark ? '#1c2026' : '#fff'
  const fg = opts.dark ? '#e6e6e6' : 'inherit'
  const baseFont =
    "body { font-family: 'Noto Sans Arabic', Calibri, 'Segoe UI', Tahoma, sans-serif; " +
    'font-size: 12pt; line-height: 1.5; direction: rtl; padding: 0.5in; ' +
    'background: ' + bg + '; color: ' + fg + '; position: relative; min-height: 100%; } ' +
    'table { border-collapse: collapse; } ' +
    'table td, table th { border: 1px solid #888; padding: 4px 6px; } ' +
    'p { margin: 0 0 0.5em 0; }'

  if (opts.variant === 'minimal') {
    return baseFont
  }

  let css = baseFont
  if (opts.pageHeightPx && opts.pageHeightPx > 0) {
    // Dashed line at the page boundary so the user can see how much vertical
    // space remains before content overflows the form's printable region.
    css +=
      " body::after { content: 'Page boundary — حد الصفحة'; " +
      'position: absolute; left: 0; right: 0; top: ' +
      String(opts.pageHeightPx) +
      'px; ' +
      'border-top: 1.5px dashed #c0392b; color: #c0392b; ' +
      "font-size: 10pt; font-family: 'Segoe UI', Tahoma, sans-serif; " +
      'direction: ltr; text-align: center; padding-top: 2px; ' +
      'pointer-events: none; opacity: 0.85; }'
  }
  return css
}
