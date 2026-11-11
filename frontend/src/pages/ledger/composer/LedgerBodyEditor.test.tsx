import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from 'i18next'
import ar from '@/locales/ar.json'
import { createRef } from 'react'

import { api, type LedgerBookRead, type LedgerDraftRead } from '@/lib/api'
import { LedgerComposerPage } from './LedgerComposerPage'
import { LedgerContentEditorPage } from './LedgerContentEditorPage'
import { LedgerBodyEditor, type LedgerBodyEditorHandle } from './LedgerBodyEditor'

vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'employee' } }) }))

// Keep the real React integration: replacing <Editor> would hide mount/init
// regressions. Only the browser engine is substituted (jsdom has no layout).
// Native iframe/event-receiver and toolbar rendering require real Chromium;
// this seam intentionally does not claim to exercise those browser internals.
function installEngine(defer = false) {
  const documents: Document[] = []
  let initialize = () => {}
  const listeners = new Map<string, Set<() => void>>()
  let content = ''
  const editor = {
    initialized: true,
    getBody: () => documents.at(-1)!.body,
    focus: vi.fn(),
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
    initialize = () => {
      documents.push(document.implementation.createHTMLDocument())
      content = options.target.value
      options.setup(editor)
      options.init_instance_callback(editor)
    }
    if (!defer) initialize()
  })
  vi.stubGlobal('hugerte', { init })
  return {
    init,
    initialize: () => initialize(),
    documents,
    focus: editor.focus,
    mode: editor.mode.set,
    replaceContent: () => {
      editor.getBody().replaceChildren()
      for (const handler of listeners.get('SetContent') ?? []) handler()
    },
    remove: editor.remove,
    type: (html: string) => {
      content = html
      for (const handler of listeners.get('change') ?? []) handler()
    },
  }
}

beforeEach(() => { vi.spyOn(api, 'listRecipients').mockResolvedValue([]) })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each(['en', 'ar'])('describes an empty correction body inside the editing document in %s', async (language) => {
  const engine = installEngine()
  i18n.addResourceBundle('ar', 'translation', ar, true, true)
  await i18n.changeLanguage(language)
  const book: LedgerBookRead = {
    id: 40, ref_number: '1/2/7', grade: 'unclassified', importance: null, tab: 2, classification_code: '2/1',
    paper_date: '28-10-2026', approval_state: 'none', created_by_user_id: 1, voided: false,
    revisions: [{ version_id: 72, version_no: 2, trigger: 'correction', created_at: '2026-10-28T08:00:00Z', signed_at: null, superseded: false, locked: false }],
    selected_version_id: 72, printed_cc: [], addressed_to: 'HR director', subjects: ['Subject'], body_html: '', content_sha256: 'abc',
    external: false, addressees: [], signer: null, can_sign: false, can_return: false, can_change_signer: false,
    can_resubmit: false, can_create_outlook_draft: false, return_note: null, paper_preset: 'normal', references: [], folders: [],
  }
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book)
  const save = vi.spyOn(api, 'updateLedgerBookContent')
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={createMemoryRouter([
        { path: '/ledger/books/:bookId/edit', element: <LedgerContentEditorPage /> },
      ], { initialEntries: ['/ledger/books/40/edit'] })} />
    </QueryClientProvider>,
  )
  try {
    await userEvent.click(await screen.findByRole('button', { name: i18n.t('ledgerBook.composer.content.save') }))
    const message = i18n.t('errors.ledger.draftBodyRequired')
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    const body = engine.documents[0].body
    expect(body.getAttribute('aria-invalid')).toBe('true')
    const descriptionId = body.getAttribute('aria-describedby')
    expect(descriptionId).toBeTruthy()
    expect(body.ownerDocument.getElementById(descriptionId!)?.textContent).toBe(message)
    expect(document.getElementById(descriptionId!)).toBeNull()
    expect(save).not.toHaveBeenCalled()
  } finally {
    view.unmount()
    await i18n.changeLanguage('en')
  }
})

it('uses current validation when editor initialization finishes after a prop update', () => {
  const engine = installEngine(true)
  const view = render(<LedgerBodyEditor value="" onChange={() => {}} label="Body" />)
  view.rerender(<LedgerBodyEditor value="" onChange={() => {}} label="Current body" invalid errorMessage="Required now" />)
  act(() => engine.initialize())
  const body = engine.documents[0].body
  expect(body.getAttribute('aria-label')).toBe('Current body')
  expect(body.getAttribute('aria-invalid')).toBe('true')
  expect(body.ownerDocument.getElementById(body.getAttribute('aria-describedby')!)?.textContent).toBe('Required now')
})

it('excludes iframe validation descriptions from the installed HugeRTE HTML serializer', async () => {
  vi.stubGlobal('hugerte', undefined)
  const { default: hugerte } = await import('hugerte')
  const html = '<p>Letter body</p><span hidden data-mce-bogus="all" contenteditable="false">Body is required</span>'
  const parsed = hugerte.html.DomParser().parse(html)
  expect(hugerte.html.Serializer().serialize(parsed)).toBe('<p>Letter body</p>')
})

it('focuses the editing surface and keeps validation descriptions inside its document across updates and remounts', async () => {
  const engine = installEngine()
  const ref = createRef<LedgerBodyEditorHandle>()
  const view = render(<LedgerBodyEditor ref={ref} value="" onChange={() => {}} label="Body" invalid errorMessage="Body is required" describedBy="outer-error" />)
  const body = engine.documents[0].body
  expect(body.getAttribute('aria-label')).toBe('Body')
  expect(body.getAttribute('aria-invalid')).toBe('true')
  expect(body.ownerDocument.getElementById(body.getAttribute('aria-describedby')!)?.textContent).toBe('Body is required')
  act(() => ref.current!.focus())
  expect(engine.focus).toHaveBeenCalledOnce()
  act(() => engine.replaceContent())
  expect(body.ownerDocument.getElementById(body.getAttribute('aria-describedby')!)?.textContent).toBe('Body is required')
  view.rerender(<LedgerBodyEditor ref={ref} value="" onChange={() => {}} label="Updated body" />)
  expect(body.getAttribute('aria-label')).toBe('Updated body')
  expect(body.hasAttribute('aria-invalid')).toBe(false)
  expect(body.hasAttribute('aria-describedby')).toBe(false)
  try {
    await act(async () => { await i18n.changeLanguage('ar') })
    view.rerender(<LedgerBodyEditor ref={ref} value="" onChange={() => {}} label="المحتوى" invalid errorMessage="المحتوى مطلوب" />)
    const arabicBody = engine.documents[1].body
    expect(arabicBody.getAttribute('aria-label')).toBe('المحتوى')
    expect(arabicBody.ownerDocument.getElementById(arabicBody.getAttribute('aria-describedby')!)?.textContent).toBe('المحتوى مطلوب')
  } finally {
    view.unmount()
    expect(ref.current).toBeNull()
    await i18n.changeLanguage('en')
  }
})

it('focuses and describes the fallback textarea when the editor script fails', async () => {
  vi.stubGlobal('hugerte', undefined)
  const ref = createRef<LedgerBodyEditorHandle>()
  const view = render(<LedgerBodyEditor ref={ref} value="" onChange={() => {}} label="Body" invalid errorMessage="Body is required" />)
  const script = await waitFor(() => {
    const node = document.querySelector('script[src="/hugerte/hugerte.min.js"]')
    expect(node).not.toBeNull()
    return node!
  })
  act(() => script.dispatchEvent(new Event('error')))
  const textarea = await screen.findByRole('textbox', { name: 'Body' })
  act(() => ref.current!.focus())
  expect(textarea).toHaveFocus()
  expect(textarea).toHaveAttribute('aria-invalid', 'true')
  expect(textarea).toHaveAccessibleDescription('Body is required')
  view.rerender(<LedgerBodyEditor ref={ref} value="" onChange={() => {}} label="Body" disabled />)
  expect(textarea).toBeDisabled()
  view.rerender(<LedgerBodyEditor ref={ref} value="" onChange={() => {}} label="Body" />)
  expect(textarea).toBeEnabled()
})

it('runs the editor UI in the app language and remounts with Arabic labels on a switch', async () => {
  const engine = installEngine()
  i18n.addResourceBundle('ar', 'translation', ar, true, true)
  render(<LedgerBodyEditor value="" onChange={() => {}} label="Body" />)
  expect(engine.init.mock.calls[0][0]).toMatchObject({ language: 'en', directionality: 'ltr' })
  try {
    await act(async () => { await i18n.changeLanguage('ar') })
    await waitFor(() => expect(engine.init).toHaveBeenCalledTimes(2))
    const options = engine.init.mock.calls[1][0] as unknown as { style_formats: { title: string }[] }
    expect(options).toMatchObject({ language: 'ar', directionality: 'rtl' })
    expect(options.style_formats[0].title).toBe(ar.ledgerBook.editor.styles.mainTitle)
    expect(engine.remove).toHaveBeenCalledTimes(1)
  } finally {
    await i18n.changeLanguage('en')
  }
})

it('initializes once after new-draft navigation and preserves the editor through autosave and Preview', async () => {
  const engine = installEngine()
  const draft: LedgerDraftRead = {
    id: 12, draft_number: '000012', tab: null, grade: 'unclassified', importance: null,
    printed_cc: [], addressed_to: '', subjects: ['Subject'], body_html: '', created_at: '2026-10-28T08:00:00Z', updated_at: '2026-10-28T08:00:00Z',
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
      <RouterProvider router={createMemoryRouter([
        { path: '/ledger/compose', element: <LedgerComposerPage autosaveMs={10} /> },
        { path: '/ledger/compose/:draftId', element: <LedgerComposerPage autosaveMs={10} /> },
      ], { initialEntries: ['/ledger/compose'] })} />
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
    // The real React wrapper normalizes ledgerPlugins' string before engine.init.
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

it('switches the actual HugeRTE engine to readonly while disabled and restores editing', () => {
  const engine = installEngine()
  const change = vi.fn()
  const view = render(<LedgerBodyEditor value="" onChange={change} label="Body" />)
  view.rerender(<LedgerBodyEditor value="" onChange={change} label="Body" disabled />)
  expect(engine.mode).toHaveBeenLastCalledWith('readonly')
  act(() => engine.type('<p>Late change</p>'))
  expect(change).not.toHaveBeenCalled()
  view.rerender(<LedgerBodyEditor value="" onChange={change} label="Body" />)
  expect(engine.mode).toHaveBeenLastCalledWith('design')
  act(() => engine.type('<p>Allowed change</p>'))
  expect(change).toHaveBeenCalledWith('<p>Allowed change</p>')
})
