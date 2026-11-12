/**
 * HugeRTE settings for the Ledger Book body. Fonts, sizes and table rules are
 * the contract shared with the printed paper (`ledger_paper.py`) and the
 * server sanitizer (`ledger_html.py`): change all three together.
 */
import type { TFunction } from 'i18next'

export const LEDGER_EDITOR_MIN_HEIGHT = 600

export const LEDGER_MENUBAR = 'edit view insert format table tools'

// `quickbars` gives the floating toolbar on a text selection; `nonbreaking`
// and `insertdatetime` only add Insert menu entries. Left out on purpose:
// links, media and source view (the sanitizer drops them), the local-storage
// `autosave` (it fights the composer's server autosave) and `visualchars`
// (with it loaded, `nonbreaking` wraps every space in a classed span).
const BASE_PLUGINS = 'lists advlist table charmap searchreplace visualblocks fullscreen wordcount pagebreak nonbreaking insertdatetime quickbars directionality'

/** Toolbar name of the ready-made tables menu (see `registerLedgerTablePresets`). */
export const LEDGER_TABLE_PRESETS_BUTTON = 'ledgertables'

export function ledgerPlugins(withImages: boolean): string {
  return withImages ? `${BASE_PLUGINS} image` : BASE_PLUGINS
}

export function ledgerToolbar(withImages: boolean): string {
  return [
    'undo redo',
    'blocks styles',
    'fontfamily fontsize lineheight',
    'bold italic underline strikethrough forecolor backcolor',
    'alignright aligncenter alignleft alignjustify',
    'rtl ltr',
    'numlist bullist outdent indent',
    withImages ? `${LEDGER_TABLE_PRESETS_BUTTON} table image` : `${LEDGER_TABLE_PRESETS_BUTTON} table`,
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

/** 1.6 is the paper's own spacing. */
export const LEDGER_LINE_HEIGHT_FORMATS = '1 1.15 1.5 1.6 2'

/** Only the blocks the sanitizer keeps: it unwraps h5, h6 and pre. */
export const LEDGER_BLOCK_FORMATS = 'Paragraph=p; Heading 1=h1; Heading 2=h2; Heading 3=h3; Heading 4=h4'

/** Numeric only, so an inserted date reads the same in both languages. */
export const LEDGER_DATETIME_FORMATS = ['%d/%m/%Y', '%Y-%m-%d', '%H:%M']

/** Selection toolbar without a quick link: the paper does not allow links. */
export const LEDGER_SELECTION_TOOLBAR = 'bold italic underline | forecolor backcolor | alignright aligncenter alignleft alignjustify | removeformat'

export function ledgerStyleFormats(t: TFunction) {
  const title = (key: string) => t(`ledgerBook.editor.styles.${key}`)
  return [
    { title: title('mainTitle'), block: 'h2', styles: { 'text-align': 'center', 'font-size': '18pt', 'font-weight': 'bold' } },
    { title: title('subtitle'), block: 'h3', styles: { 'font-size': '16pt', 'font-weight': 'bold' } },
    { title: title('sectionHeading'), block: 'h4', styles: { 'font-size': '14pt', 'font-weight': 'bold', 'text-decoration': 'underline' } },
    { title: title('paragraph'), block: 'p', styles: { 'font-size': '16pt' } },
    { title: title('note'), block: 'p', styles: { 'font-size': '12pt' } },
    { title: title('justified'), block: 'p', styles: { 'font-size': '16pt', 'text-align': 'justify' } },
    { title: title('centeredLine'), block: 'p', styles: { 'font-size': '16pt', 'font-weight': 'bold', 'text-align': 'center' } },
  ]
}

// ─── Ready-made tables ───────────────────────────────────────────────────────
// Inline styles on allowed tags only: the sanitizer drops classes. Cell borders
// and padding come from the paper's own table CSS, so they are not repeated.

const TABLE_STYLE = 'width:100%;table-layout:fixed;border-collapse:collapse;margin-inline:auto'
const HEAD_CELL_STYLE = 'background-color:#d9d9d9;font-weight:bold;text-align:center'
const LABEL_CELL_STYLE = 'width:30%;background-color:#f2f2f2;font-weight:bold'
const NUMBER_WIDTH = '8%'
const PRESET_ROWS = 3

type ColumnKey = 'number' | 'statement' | 'name' | 'employeeNumber' | 'date' | 'notes'
type Column = readonly [key: ColumnKey, width?: string]

/** A ruled table whose header row is a real `<thead>`, so it repeats on every printed page. */
function headedTable(t: TFunction, columns: readonly Column[]): string {
  const head = columns.map(([key, width]) => {
    const style = width ? `width:${width};${HEAD_CELL_STYLE}` : HEAD_CELL_STYLE
    return `<th style="${style}">${t(`ledgerBook.editor.tables.columns.${key}`)}</th>`
  }).join('')
  const rows = Array.from({ length: PRESET_ROWS }, (_, row) => {
    const cells = columns.map(([key]) => (key === 'number' ? `<td style="text-align:center">${row + 1}</td>` : '<td>&nbsp;</td>')).join('')
    return `<tr>${cells}</tr>`
  }).join('')
  return `<table style="${TABLE_STYLE}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table><p>&nbsp;</p>`
}

/** Label and value pairs: a shaded first column and no header row. */
function detailsTable(): string {
  const row = `<tr><td style="${LABEL_CELL_STYLE}">&nbsp;</td><td>&nbsp;</td></tr>`
  return `<table style="${TABLE_STYLE}"><tbody>${row.repeat(PRESET_ROWS + 1)}</tbody></table><p>&nbsp;</p>`
}

export interface LedgerTablePreset { key: string, title: string, html: string }

export function ledgerTablePresets(t: TFunction): LedgerTablePreset[] {
  const number: Column = ['number', NUMBER_WIDTH]
  const preset = (key: string, html: string): LedgerTablePreset => ({ key, title: t(`ledgerBook.editor.tables.${key}`), html })
  return [
    preset('numbered', headedTable(t, [number, ['statement'], ['notes', '25%']])),
    preset('names', headedTable(t, [number, ['name'], ['employeeNumber', '22%'], ['notes', '25%']])),
    preset('dated', headedTable(t, [number, ['statement'], ['date', '20%'], ['notes', '22%']])),
    preset('details', detailsTable()),
  ]
}

interface TablePresetHost {
  insertContent: (html: string) => void
  ui: { registry: { addMenuButton: (name: string, spec: {
    icon: string
    tooltip: string
    fetch: (done: (items: { type: 'menuitem', text: string, onAction: () => void }[]) => void) => void
  }) => void } }
}

/** Adds the ready-made tables menu button; call it from HugeRTE's `setup`. */
export function registerLedgerTablePresets(editor: TablePresetHost, t: TFunction): void {
  const presets = ledgerTablePresets(t)
  editor.ui.registry.addMenuButton(LEDGER_TABLE_PRESETS_BUTTON, {
    icon: 'table-top-header',
    tooltip: t('ledgerBook.editor.tables.menu'),
    fetch: (done) => done(presets.map(({ title, html }) => ({
      type: 'menuitem' as const,
      text: title,
      onAction: () => editor.insertContent(html),
    }))),
  })
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
