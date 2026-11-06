import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

import { api, type LedgerDraftRead } from '@/lib/api'
import { LedgerComposerPage } from './LedgerComposerPage'
import { LedgerBodyEditor } from './LedgerBodyEditor'

vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))

// Keep the real React integration: replacing <Editor> would hide mount/init
// regressions. Only the browser engine is substituted (jsdom has no layout).
// Native iframe/event-receiver and toolbar rendering require real Chromium;
// this seam intentionally does not claim to exercise those browser internals.
function installEngine() {
  const listeners = new Map<string, Set<() => void>>()
  let content = ''
  const editor = {
    initialized: true,
    on: (events: string, handler: () => void) => {
      for (const event of events.split(' ')) {
        const handlers = listeners.get(event) ?? new Set<() => void>()
        handlers.add(handler)
        listeners.set(event, handlers)
      }
    },
    off: (events: string, handler: () => void) => {
      for (const event of events.split(' ')) listeners.get(event)?.delete(handler)
    },
    getContent: () => content,
    setContent: (html: string) => { content = html },
    selection: { getBookmark: () => ({}), moveToBookmark: vi.fn() },
    undoManager: { transact: (fn: () => void) => fn(), clear: vi.fn(), add: vi.fn() },
    setDirty: vi.fn(),
    mode: { set: vi.fn() },
    remove: vi.fn(),
  }
  const init = vi.fn((options: {
    target: HTMLTextAreaElement
    setup: (instance: typeof editor) => void
    init_instance_callback: (instance: typeof editor) => void
  }) => {
    content = options.target.value
    options.setup(editor)
    options.init_instance_callback(editor)
  })
  vi.stubGlobal('hugerte', { init })
  return {
    init,
    remove: editor.remove,
    type: (html: string) => {
      content = html
      for (const handler of listeners.get('change') ?? []) handler()
    },
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('initializes once after new-draft navigation and preserves the editor through autosave and Preview', async () => {
  const engine = installEngine()
  const draft: LedgerDraftRead = {
    id: 12, draft_number: '000012', tab: null, grade: 'unclassified', importance: null,
    subjects: ['Subject'], body_html: '', created_at: '2026-10-28T08:00:00Z', updated_at: '2026-10-28T08:00:00Z',
    external: false, signer_manager_id: null, addressees: [],
    paper_preset: 'normal', reference_book_ids: [], folder_ids: [],
  }
  const create = vi.spyOn(api, 'createLedgerDraft').mockResolvedValue(draft)
  vi.spyOn(api, 'getLedgerDraft').mockResolvedValue(draft)
  vi.spyOn(api, 'listBookClassifications').mockResolvedValue({ items: [] })
  vi.spyOn(api, 'listManagers').mockResolvedValue([])
  vi.spyOn(api, 'listRecipientCandidates').mockResolvedValue([])
  const update = vi.spyOn(api, 'updateLedgerDraft').mockResolvedValue(draft)
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/ledger/compose']}>
        <Routes>
          <Route path="/ledger/compose" element={<LedgerComposerPage autosaveMs={10} />} />
          <Route path="/ledger/compose/:draftId" element={<LedgerComposerPage autosaveMs={10} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await screen.findByRole('heading', { name: /DRAFT 000012/ })
  expect(create).toHaveBeenCalledTimes(1)
  expect(engine.init).toHaveBeenCalledTimes(1)
  expect(engine.init).toHaveBeenCalledWith(expect.objectContaining({
    relative_urls: false,
    remove_script_host: true,
  }))

  act(() => engine.type('<p>Typed body</p>'))
  await waitFor(() => expect(update).toHaveBeenCalledWith(12, { body_html: '<p>Typed body</p>' }))
  await screen.findByText('Saved')
  await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await userEvent.click(screen.getByRole('button', { name: 'Hide preview' }))
  await userEvent.type(screen.getByLabelText('Subject line 1'), '!')
  await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { subjects: ['Subject!'] }))
  expect(engine.init).toHaveBeenCalledTimes(1)
  expect(engine.remove).not.toHaveBeenCalled()

  view.unmount()
  expect(engine.remove).toHaveBeenCalledTimes(1)
})

type InitOptions = Record<string, unknown> & {
  paste_postprocess: (editor: unknown, args: { node: HTMLElement }) => void
  style_formats: { title: string, block: string, styles: Record<string, string> }[]
}

function renderEditor(onUploadImage?: (file: Blob, filename: string) => Promise<string>): InitOptions {
  const engine = installEngine()
  render(<LedgerBodyEditor value="" onChange={() => {}} label="Body" onUploadImage={onUploadImage} />)
  expect(engine.init).toHaveBeenCalledTimes(1)
  return engine.init.mock.calls[0][0] as unknown as InitOptions
}

it('configures the full paper editor without external links, media or source code', () => {
  const options = renderEditor()
  expect(options).toMatchObject({
    menubar: 'edit view insert format table tools',
    plugins: ['lists', 'advlist', 'table', 'charmap', 'searchreplace', 'visualblocks', 'fullscreen', 'wordcount', 'pagebreak', 'directionality'],
    toolbar: 'undo redo | blocks styles | fontfamily fontsize | bold italic underline strikethrough forecolor backcolor | alignright aligncenter alignleft alignjustify | rtl ltr | numlist bullist outdent indent | table | pagebreak | removeformat | fullscreen',
    font_size_formats: '10pt 11pt 12pt 14pt 16pt 18pt 20pt 24pt',
    table_sizing_mode: 'relative',
    pagebreak_separator: '<div style="break-after:page;page-break-after:always"></div>',
    paste_data_images: false,
  })
  const fonts = String(options.font_family_formats).split(';').map((entry) => entry.split('=')[1])
  expect(fonts).toEqual(['Sakkal Majalla', 'Calibri', 'Univers Next Arabic', 'Noto Naskh Arabic'])
  expect(Number(options.height)).toBeGreaterThanOrEqual(600)
  expect(options.table_default_styles).toMatchObject({ width: '100%', 'table-layout': 'fixed', 'border-collapse': 'collapse' })
  const css = String(options.content_style)
  for (const rule of ['direction: rtl', 'font-size: 16pt', 'line-height: 1.6', 'table-layout: fixed', '0.2mm solid #000', 'max-inline-size: calc(210mm - 13.2mm - 14.3mm)']) {
    expect(css).toContain(rule)
  }
})

it('offers paper heading presets as inline styles', () => {
  const presets = renderEditor().style_formats
  expect(presets.map((preset) => [preset.block, preset.styles['font-size']])).toEqual([
    ['h2', '18pt'], ['h3', '16pt'], ['h4', '14pt'], ['p', '16pt'], ['p', '12pt'],
  ])
  expect(presets[0].styles).toMatchObject({ 'text-align': 'center', 'font-weight': 'bold' })
  expect(presets[2].styles).toMatchObject({ 'text-decoration': 'underline' })
})

it('adds the image tool only with a server upload', () => {
  const options = renderEditor(() => Promise.resolve('/x.png'))
  expect(options.plugins).toContain('image')
  expect(String(options.toolbar)).toContain('image')
  expect(options.paste_data_images).toBe(true)
})

it('strips Word classes from pasted content and keeps table borders', () => {
  const node = document.createElement('div')
  node.innerHTML = '<p class="MsoNormal">x</p><table class="MsoTableGrid"><tr><td class="c1">a</td><td style="border: 1px dotted red">b</td></tr></table>'
  renderEditor().paste_postprocess(null, { node })
  expect(node.querySelector('[class]')).toBeNull()
  const [first, second] = node.querySelectorAll('td')
  expect(first.style.border).toBe('0.2mm solid rgb(0, 0, 0)')
  expect(second.style.border).toBe('1px dotted red')
  expect(node.querySelector('table')?.style.borderCollapse).toBe('collapse')
})
