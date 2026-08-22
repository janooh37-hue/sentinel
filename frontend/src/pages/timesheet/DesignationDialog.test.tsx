/**
 * The catalog half of roster editing: adding a designation and renaming one
 * (design §"Designation catalog").
 *
 * Wrapper is `QueryClientProvider` alone, as `DesignationCatalog.test.tsx`
 * does: the dialog navigates nowhere and reads no capability of its own — it is
 * only ever rendered inside roster edit mode, which is already gated.
 *
 * The api mock stubs `ApiError` with a `code`, because the reason a rename is
 * refused arrives as the structured envelope and has to be readable INSIDE the
 * dialog: a toast behind a modal is a message the operator cannot reach, which
 * is why both catalog hooks are asked for their quiet variant here.
 *
 * Real i18n (`src/test/setup.ts` initialises `en` synchronously), because half
 * the contract is that every input has a label an operator can actually read —
 * asserting `t` keys would prove nothing about that.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  api: {
    listDesignations: vi.fn(),
    createTimesheetDesignation: vi.fn(),
    updateTimesheetDesignation: vi.fn(),
  },
  apiErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  ApiError: class ApiError extends Error {
    readonly code: string
    constructor(_status: number, code: string, message: string) {
      super(message)
      this.code = code
    }
  },
}))

import { toast } from 'sonner'
import { ApiError, api, type TimesheetDesignationRead } from '@/lib/api'

import { DesignationDialog } from './DesignationDialog'

const GUARD: TimesheetDesignationRead = {
  id: 115,
  name_en: 'Security Guard',
  name_ar: 'حارس امن',
  rank_order: 15,
  sheet: 'main',
  active: true,
  system_key: 'security_guard',
}

const create = vi.mocked(api.createTimesheetDesignation)
const update = vi.mocked(api.updateTimesheetDesignation)

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>)
}

/** The create dialog, opened from its own trigger. */
async function openCreate(): Promise<HTMLElement> {
  wrap(
    <DesignationDialog sheet="main">
      <button type="button">Add designation</button>
    </DesignationDialog>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Add designation' }))
  return screen.getByRole('dialog')
}

/** The rename dialog for one catalog row, opened from its own trigger. */
async function openRename(): Promise<HTMLElement> {
  wrap(
    <DesignationDialog sheet="main" designation={GUARD}>
      <button type="button">Rename Security Guard</button>
    </DesignationDialog>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Rename Security Guard' }))
  return screen.getByRole('dialog')
}

beforeEach(() => {
  vi.clearAllMocks()
  create.mockResolvedValue({ ...GUARD, id: 130, name_en: 'Gate Sentry', rank_order: 17 })
  update.mockResolvedValue({ ...GUARD, name_en: 'Site Security Guard' })
})

describe('adding a designation', () => {
  it('labels both names and the workbook it will print on', async () => {
    const dialog = await openCreate()

    // Every field is reachable BY ITS LABEL: the two printed names are two
    // different languages, and which workbook a designation prints on is the
    // one decision a rename can never undo.
    expect(within(dialog).getByLabelText('English name')).toHaveValue('')
    expect(within(dialog).getByLabelText('Arabic name')).toHaveValue('')
    expect(within(dialog).getByLabelText('Workbook sheet')).toHaveValue('main')
    // The Arabic field declares its own language, so it is typed and read
    // right-to-left whatever the interface language is.
    expect(within(dialog).getByLabelText('Arabic name')).toHaveAttribute('lang', 'ar')
  })

  it('sends both names and the chosen sheet, then closes', async () => {
    const dialog = await openCreate()
    const save = within(dialog).getByRole('button', { name: 'Save' })

    // Nothing to save until both printed names exist: a designation with one
    // name prints a blank cell on the other workbook.
    expect(save).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText('English name'), 'Gate Sentry')
    expect(save).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText('Arabic name'), 'حارس بوابة')
    await userEvent.selectOptions(within(dialog).getByLabelText('Workbook sheet'), 'drivers')
    await userEvent.click(save)

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name_en: 'Gate Sentry',
        name_ar: 'حارس بوابة',
        sheet: 'drivers',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('renaming a designation', () => {
  it('offers both names filled in and no sheet to change', async () => {
    const dialog = await openRename()

    expect(within(dialog).getByLabelText('English name')).toHaveValue('Security Guard')
    expect(within(dialog).getByLabelText('Arabic name')).toHaveValue('حارس امن')
    // The sheet is chosen once, at creation: moving a designation between
    // workbooks would re-file every man on it (design §"Designation catalog").
    expect(within(dialog).queryByLabelText('Workbook sheet')).not.toBeInTheDocument()
  })

  it('sends only the two names', async () => {
    const dialog = await openRename()
    const english = within(dialog).getByLabelText('English name')

    await userEvent.clear(english)
    await userEvent.type(english, 'Site Security Guard')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(115, {
        name_en: 'Site Security Guard',
        name_ar: 'حارس امن',
      }),
    )
  })

  it("shows the server's own reason inside the dialog, once", async () => {
    update.mockRejectedValue(
      new ApiError(409, 'DESIGNATION_NAME_TAKEN', 'Another designation already prints that name.'),
    )
    const dialog = await openRename()
    const english = within(dialog).getByLabelText('English name')

    await userEvent.clear(english)
    await userEvent.type(english, 'Driver')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Another designation already prints that name.')
    // Inside the dialog and nowhere else: a toast behind a modal is a sentence
    // the operator cannot read, which is what the hooks' quiet mode is for.
    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // A second refusal replaces the sentence rather than stacking a second one.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(within(dialog).getAllByRole('alert')).toHaveLength(1)
  })
})

describe('the dialog shell', () => {
  it('returns focus to the control that opened it', async () => {
    wrap(
      <DesignationDialog sheet="main" designation={GUARD}>
        <button type="button">Rename Security Guard</button>
      </DesignationDialog>,
    )
    // Held before the modal opens: a modal `aria-hidden`s the rest of the
    // document, so the trigger is unreachable BY ROLE while it is open — which
    // is correct, and is why the reference is taken first.
    const trigger = screen.getByRole('button', { name: 'Rename Security Guard' })
    await userEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.activeElement).toBe(trigger)
  })

  it('exposes no English-only close control', async () => {
    const dialog = await openCreate()

    // The primitive's built-in corner button carries a hardcoded
    // `aria-label="Close"`, so an Arabic operator would hear one English word
    // in an otherwise Arabic modal. This dialog supplies its own, translated.
    expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })
})
