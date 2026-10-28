import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

import { api, type LedgerDraftRead } from '@/lib/api'
import { LedgerComposerPage } from './LedgerComposerPage'

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
  }
  const create = vi.spyOn(api, 'createLedgerDraft').mockResolvedValue(draft)
  vi.spyOn(api, 'getLedgerDraft').mockResolvedValue(draft)
  vi.spyOn(api, 'listBookClassifications').mockResolvedValue({ items: [] })
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
