/**
 * HugeRTE settings for the Ledger Book body. Fonts, sizes and table rules are
 * the contract shared with the printed paper (`ledger_paper.py`) and the
 * server sanitizer (`ledger_html.py`): change all three together.
 */
import type { TFunction } from 'i18next'

export const LEDGER_EDITOR_MIN_HEIGHT = 600

export const LEDGER_MENUBAR = 'edit view insert format table tools'

const BASE_PLUGINS = 'lists advlist table charmap searchreplace visualblocks fullscreen wordcount pagebreak directionality'

export function ledgerPlugins(withImages: boolean): string {
  return withImages ? `${BASE_PLUGINS} image` : BASE_PLUGINS
}

export function ledgerToolbar(withImages: boolean): string {
  return [
    'undo redo',
    'blocks styles',
    'fontfamily fontsize',
    'bold italic underline strikethrough forecolor backcolor',
    'alignright aligncenter alignleft alignjustify',
    'rtl ltr',
    'numlist bullist outdent indent',
    withImages ? 'table image' : 'table',
    'pagebreak',
    'removeformat',
    'fullscreen',
  ].join(' | ')
}

/** Exact family names the sanitizer accepts. */
const FONTS = [
  ['sakkalMajalla', 'Sakkal Majalla'],
  ['calibri', 'Calibri'],
  ['universNextArabic', 'Univers Next Arabic'],
  ['notoNaskhArabic', 'Noto Naskh Arabic'],
] as const

export function ledgerFontFamilyFormats(t: TFunction): string {
  return FONTS.map(([key, family]) => `${t(`ledgerBook.editor.fonts.${key}`)}=${family}`).join(';')
}

export const LEDGER_FONT_SIZE_FORMATS = '10pt 11pt 12pt 14pt 16pt 18pt 20pt 24pt'

export function ledgerStyleFormats(t: TFunction) {
  const title = (key: string) => t(`ledgerBook.editor.styles.${key}`)
  return [
    { title: title('mainTitle'), block: 'h2', styles: { 'text-align': 'center', 'font-size': '18pt', 'font-weight': 'bold' } },
    { title: title('subtitle'), block: 'h3', styles: { 'font-size': '16pt', 'font-weight': 'bold' } },
    { title: title('sectionHeading'), block: 'h4', styles: { 'font-size': '14pt', 'font-weight': 'bold', 'text-decoration': 'underline' } },
    { title: title('paragraph'), block: 'p', styles: { 'font-size': '16pt' } },
    { title: title('note'), block: 'p', styles: { 'font-size': '12pt' } },
  ]
}

const CELL_BORDER = '0.2mm solid #000'

export const LEDGER_TABLE_DEFAULT_STYLES = {
  'width': '100%',
  'table-layout': 'fixed',
  'border-collapse': 'collapse',
  'margin-inline': 'auto',
}

/**
 * Page break as an element the sanitizer keeps byte-for-byte (nh3's normalised
 * style form), so HugeRTE recognises it again when a saved body is reloaded.
 */
export const LEDGER_PAGEBREAK_SEPARATOR = '<div style="break-after:page;page-break-after:always"></div>'

export const LEDGER_TABLE_DEFAULT_ATTRIBUTES = {}

const CELL_STYLES: Record<string, string> = {
  'border': CELL_BORDER,
  'padding-block': '1mm',
  'padding-inline': '2mm',
}

/** The paper's body CSS, so the editing surface looks like the print. */
export const LEDGER_CONTENT_STYLE = `
html { background: #f3f3f3; }
body {
  box-sizing: border-box;
  max-inline-size: calc(210mm - 13.2mm - 14.3mm);
  margin: 1rem auto;
  padding: 1rem;
  background: #fff;
  color: #000;
  direction: rtl;
  font-family: Calibri, "Sakkal Majalla", "GSSG Naskh", serif;
  font-size: 16pt;
  line-height: 1.6;
}
table { inline-size: 100%; table-layout: fixed; margin-inline: auto; border-collapse: collapse; }
td, th { border: ${CELL_BORDER}; padding-block: 1mm; padding-inline: 2mm; overflow-wrap: anywhere; }
img { max-inline-size: 100%; height: auto; }
`

/**
 * Word paste: drop Office classes (the sanitizer would drop them anyway, and
 * they hide which formatting is real) and give borderless cells the paper's
 * border so pasted tables stay ruled.
 */
export function ledgerPastePostprocess(_editor: unknown, args: { node: HTMLElement }): void {
  for (const element of args.node.querySelectorAll('[class]')) element.removeAttribute('class')
  for (const table of args.node.querySelectorAll('table')) {
    if (!table.style.borderCollapse) table.style.borderCollapse = 'collapse'
  }
  for (const cell of args.node.querySelectorAll<HTMLElement>('td, th')) {
    const style = cell.style
    if (style.border || style.borderTop || style.borderInlineStart || style.borderLeft) continue
    for (const [property, value] of Object.entries(CELL_STYLES)) style.setProperty(property, value)
  }
}
