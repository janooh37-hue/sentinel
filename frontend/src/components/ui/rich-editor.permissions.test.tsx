import { useEffect, useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { EditorTemplateRead } from '@/lib/api'
import { RichEditor } from './rich-editor'

const { access, insertContent, setContent, registered, translate } = vi.hoisted(() => ({
  access: { allowed: true }, insertContent: vi.fn(), setContent: vi.fn(),
  registered: new Map<string, { onAction: () => void; tooltip: string }>(),
  translate: (key: string) => key,
}))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => cap === 'editor_templates.manage' && access.allowed }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate, i18n: { language: 'en' } }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@hugerte/hugerte-react', () => ({
  Editor: ({ init }: { init: { toolbar: string[]; setup: (editor: unknown) => void } }) => {
    const [buttons, setButtons] = useState<Array<{ name: string; onAction: () => void; tooltip: string }>>([])
    useEffect(() => {
      const next: typeof buttons = []
      init.setup({
        getContent: () => '<p>Current draft</p>', insertContent, setContent,
        ui: { registry: { addButton: (name: string, button: { onAction: () => void; tooltip: string }) => {
          registered.set(name, button)
          if (init.toolbar.join(' ').split(' ').includes(name)) next.push({ name, ...button })
        } } },
      })
      setButtons(next)
    }, [init])
    return <div>{buttons.map((button) => <button key={button.name} onClick={button.onAction}>{button.tooltip}</button>)}</div>
  },
}))

function Harness({ client }: { client: QueryClient }) {
  const form = useForm({ defaultValues: { body: '<p>Current draft</p>' } })
  return <QueryClientProvider client={client}><FormProvider {...form}><RichEditor name="body" variant="full" /></FormProvider></QueryClientProvider>
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const view = render(<Harness client={client} />)
  return { refresh: () => view.rerender(<Harness client={client} />) }
}
beforeEach(() => {
  access.allowed = true
  registered.clear()
  vi.spyOn(api, 'listEditorTemplates').mockResolvedValue({ items: [{ id: 1, name: 'Shared wording', created_at: '2026-01-01T00:00:00', updated_at: null, deleted_at: null }], total: 1, limit: 200, offset: 0 })
  vi.spyOn(api, 'createEditorTemplate')
  vi.spyOn(api, 'getEditorTemplate')
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('RichEditor library authorization', () => {
  it('removes both library tools without disabling ordinary document tools', () => {
    access.allowed = false
    mount()
    expect(screen.queryByRole('button', { name: 'editor.template.saveTooltip' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'editor.template.loadTooltip' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'editor.table.tooltip' })).toBeVisible()
    act(() => registered.get('gssg-template-load')!.onAction())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.listEditorTemplates).not.toHaveBeenCalled()
  })

  it('closes an open save dialog and rejects retained toolbar actions after revocation', () => {
    const view = mount()
    const oldSave = registered.get('gssg-template-save')!.onAction
    fireEvent.click(screen.getByRole('button', { name: 'editor.template.saveTooltip' }))
    fireEvent.change(screen.getByPlaceholderText('editor.template.namePlaceholder'), { target: { value: 'My template' } })
    access.allowed = false
    view.refresh()
    act(oldSave)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.createEditorTemplate).not.toHaveBeenCalled()
    access.allowed = true
    view.refresh()
    expect(screen.getByRole('button', { name: 'editor.template.saveTooltip' })).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('saves the current editor content through the permitted library dialog', async () => {
    vi.mocked(api.createEditorTemplate).mockResolvedValue({
      id: 2, name: 'My template', html: '<p>Current draft</p>',
      created_at: '2026-01-01T00:00:00', updated_at: null, deleted_at: null,
    })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'editor.template.saveTooltip' }))
    fireEvent.change(screen.getByPlaceholderText('editor.template.namePlaceholder'), { target: { value: ' My template ' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    await waitFor(() => expect(api.createEditorTemplate).toHaveBeenCalledWith({ name: 'My template', html: '<p>Current draft</p>' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('does not insert a template whose fetch finishes after access is lost', async () => {
    let finish!: (value: EditorTemplateRead) => void
    const promise = new Promise<EditorTemplateRead>((resolve) => { finish = resolve })
    vi.mocked(api.getEditorTemplate).mockReturnValue(promise)
    const view = mount()
    fireEvent.click(screen.getByRole('button', { name: 'editor.template.loadTooltip' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Shared wording' }))
    await waitFor(() => expect(api.getEditorTemplate).toHaveBeenCalledWith(1))
    access.allowed = false
    view.refresh()
    await act(async () => { finish({ id: 1, name: 'Shared wording', html: '<p>Library text</p>', created_at: '2026-01-01T00:00:00', updated_at: null, deleted_at: null }) })
    expect(insertContent).not.toHaveBeenCalled()
    expect(setContent).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
