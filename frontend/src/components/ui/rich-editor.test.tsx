import { act, cleanup, render, waitFor } from '@testing-library/react'
import i18n from 'i18next'
import { FormProvider, useForm } from 'react-hook-form'
import { afterEach, expect, it, vi } from 'vitest'

import ar from '@/locales/ar.json'
import { RichEditor } from './rich-editor'

// Only the browser engine is substituted (jsdom has no layout); the real
// React wrapper still mounts, so init options are the ones HugeRTE receives.
function installEngine() {
  const editor = {
    initialized: true,
    on: vi.fn(),
    off: vi.fn(),
    getContent: () => '',
    setContent: vi.fn(),
    selection: { getBookmark: () => ({}), moveToBookmark: vi.fn() },
    undoManager: { transact: (fn: () => void) => fn(), clear: vi.fn(), add: vi.fn() },
    setDirty: vi.fn(),
    mode: { set: vi.fn() },
    remove: vi.fn(),
  }
  const init = vi.fn((options: { setup: (instance: typeof editor) => void }) => { options.setup(editor) })
  vi.stubGlobal('hugerte', { init })
  return { init, remove: editor.remove }
}

function Harness(): React.JSX.Element {
  const form = useForm({ defaultValues: { body: '' } })
  return <FormProvider {...form}><RichEditor name="body" /></FormProvider>
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('runs the editor UI in the app language and remounts on a language switch', async () => {
  const engine = installEngine()
  i18n.addResourceBundle('ar', 'translation', ar, true, true)
  render(<Harness />)
  await waitFor(() => expect(engine.init).toHaveBeenCalledTimes(1))
  expect(engine.init.mock.calls[0][0]).toMatchObject({ language: 'en', directionality: 'ltr' })
  try {
    await act(async () => { await i18n.changeLanguage('ar') })
    await waitFor(() => expect(engine.init).toHaveBeenCalledTimes(2))
    expect(engine.init.mock.calls[1][0]).toMatchObject({ language: 'ar', directionality: 'rtl' })
    expect(engine.remove).toHaveBeenCalledTimes(1)
  } finally {
    await i18n.changeLanguage('en')
  }
})
