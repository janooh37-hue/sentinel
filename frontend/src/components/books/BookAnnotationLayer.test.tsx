/**
 * Arm-to-mark: the overlay must not swallow touches while the manager is
 * reading. Disarmed it is pointer-events:none so native pinch-zoom and scroll
 * reach the paper underneath; armed it becomes interactive.
 */
import { act, render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

import { BookAnnotationLayer, MarksStepper } from './BookAnnotationLayer'
import type { BookAnnotation, PageBox } from './annotation-utils'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

const { toastFn, toastError, toastSuccess, toastDismiss } = vi.hoisted(() => ({
  toastFn: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastDismiss: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: Object.assign(toastFn, { error: toastError, success: toastSuccess, dismiss: toastDismiss }),
}))

const PAGES: PageBox[] = [{ page: 1, left: 0, top: 0, width: 400, height: 560 }]

function renderLayer(props: Partial<React.ComponentProps<typeof BookAnnotationLayer>> = {}) {
  return render(
    <BookAnnotationLayer
      pages={PAGES}
      annotations={[]}
      mode="mark"
      currentUserId={1}
      onCreate={vi.fn()}
      onDelete={vi.fn()}
      {...props}
    />,
  )
}

describe('BookAnnotationLayer arming', () => {
  it('is pointer-events:none and shows no toolbar when disarmed', () => {
    renderLayer()
    const root = screen.getByTestId('anno-root')
    expect(root.className).toContain('pointer-events-none')
    expect(screen.queryByRole('button', { name: 'books.annotations.pin' })).not.toBeInTheDocument()
  })

  it('becomes interactive and shows the toolbar when armed', () => {
    renderLayer({ armed: true })
    const root = screen.getByTestId('anno-root')
    expect(root.className).toContain('pointer-events-auto')
    expect(screen.getByRole('button', { name: 'books.annotations.pin' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('stays inert in view mode even if armed is passed', () => {
    renderLayer({ mode: 'view', armed: true })
    expect(screen.getByTestId('anno-root').className).toContain('pointer-events-none')
  })
})

describe('BookAnnotationLayer touch-action and one-mark-per-arm', () => {
  it('keeps touch-action free with the Pin tool so pinch-zoom survives', () => {
    renderLayer({ armed: true })
    expect(screen.getByTestId('anno-root').style.touchAction).not.toBe('none')
  })

  it('takes touch-action only once Highlight is selected', async () => {
    const user = userEvent.setup()
    renderLayer({ armed: true })
    await user.click(screen.getByRole('button', { name: 'books.annotations.highlight' }))
    expect(screen.getByTestId('anno-root').style.touchAction).toBe('none')
  })

  it('disarms after saving a mark', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    const onDisarm = vi.fn()
    renderLayer({ armed: true, onCreate, onDisarm })

    fireEvent.pointerDown(screen.getByTestId('anno-root'), { clientX: 40, clientY: 40 })
    fireEvent.pointerUp(screen.getByTestId('anno-root'), { clientX: 40, clientY: 40 })
    await user.type(screen.getByRole('textbox'), 'wrong date')
    await user.click(screen.getByText('books.annotations.save'))

    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onDisarm).toHaveBeenCalledTimes(1)
  })

  it('disarms after cancelling a mark', async () => {
    const user = userEvent.setup()
    const onDisarm = vi.fn()
    renderLayer({ armed: true, onDisarm })

    fireEvent.pointerDown(screen.getByTestId('anno-root'), { clientX: 40, clientY: 40 })
    fireEvent.pointerUp(screen.getByTestId('anno-root'), { clientX: 40, clientY: 40 })
    await user.click(screen.getByText('books.annotations.cancel'))

    expect(onDisarm).toHaveBeenCalledTimes(1)
  })

  it('drops an open draft when the overlay is disarmed', () => {
    const { rerender } = renderLayer({ armed: true })
    fireEvent.pointerDown(screen.getByTestId('anno-root'), { clientX: 40, clientY: 40 })
    fireEvent.pointerUp(screen.getByTestId('anno-root'), { clientX: 40, clientY: 40 })
    expect(screen.getByTestId('anno-composer')).toBeInTheDocument()
    rerender(
      <BookAnnotationLayer
        pages={PAGES}
        annotations={[]}
        mode="mark"
        armed={false}
        currentUserId={1}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('anno-composer')).not.toBeInTheDocument()
  })
})

describe('BookAnnotationLayer composer vs keyboard', () => {
  function openComposer(): void {
    renderLayer({ armed: true })
    fireEvent.pointerDown(screen.getByTestId('anno-root'), { clientX: 40, clientY: 40 })
    fireEvent.pointerUp(screen.getByTestId('anno-root'), { clientX: 40, clientY: 40 })
  }

  it('sits above the keyboard on a phone', () => {
    window.matchMedia = ((q: string) => ({
      matches: q.includes('max-width'),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia
    const vv = Object.assign(new EventTarget(), { height: 508, offsetTop: 0 })
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
    window.innerHeight = 844

    openComposer()
    // 844 - 508 = 336px of keyboard; the sheet must clear it.
    expect(screen.getByTestId('anno-composer').style.bottom).toBe('336px')
    Reflect.deleteProperty(window, 'visualViewport')
  })

  it('blurs the textarea before clearing the draft so the keyboard comes down', async () => {
    const user = userEvent.setup()
    openComposer()
    const box = screen.getByRole('textbox')
    box.focus()
    expect(document.activeElement).toBe(box)
    await user.click(screen.getByText('books.annotations.cancel'))
    expect(document.activeElement).not.toBe(box)
  })

  it('keeps the draft text when the keyboard is dismissed by hand', () => {
    openComposer()
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'wrong date' } })
    fireEvent.blur(box) // user swiped the keyboard away
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('wrong date')
  })
})

describe('BookAnnotationLayer pin placement and composer', () => {
  it('places a pin on pointerup, not on pointerdown', () => {
    renderLayer({ armed: true })
    const root = screen.getByTestId('anno-root')
    fireEvent.pointerDown(root, { clientX: 40, clientY: 40 })
    expect(screen.queryByTestId('anno-composer')).not.toBeInTheDocument()
    fireEvent.pointerUp(root, { clientX: 42, clientY: 41 })
    expect(screen.getByTestId('anno-composer')).toBeInTheDocument()
  })

  it('ignores a touch that travels 8px or more (a scroll or pinch, not a pin)', () => {
    renderLayer({ armed: true })
    const root = screen.getByTestId('anno-root')
    fireEvent.pointerDown(root, { clientX: 40, clientY: 40 })
    fireEvent.pointerMove(root, { clientX: 40, clientY: 60 })
    fireEvent.pointerUp(root, { clientX: 40, clientY: 60 })
    expect(screen.queryByTestId('anno-composer')).not.toBeInTheDocument()
  })

  it('Esc closes the composer locally and disarms', () => {
    const onDisarm = vi.fn()
    renderLayer({ armed: true, onDisarm })
    const root = screen.getByTestId('anno-root')
    fireEvent.pointerDown(root, { clientX: 40, clientY: 40 })
    fireEvent.pointerUp(root, { clientX: 40, clientY: 40 })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(screen.queryByTestId('anno-composer')).not.toBeInTheDocument()
    expect(onDisarm).toHaveBeenCalledTimes(1)
  })

  it('Save says why it is blocked until a note is written', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    renderLayer({ armed: true, onCreate })
    const root = screen.getByTestId('anno-root')
    fireEvent.pointerDown(root, { clientX: 40, clientY: 40 })
    fireEvent.pointerUp(root, { clientX: 40, clientY: 40 })
    const composer = screen.getByTestId('anno-composer')
    const save = within(composer).getByRole('button', { name: /books\.annotations\.save/ })
    expect(save).toHaveAttribute('aria-disabled', 'true')
    expect(save).toHaveAccessibleDescription('books.reason.noteEmpty')
    await user.click(save)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('hands the tools to the host when it controls them (no floating toolbar)', () => {
    renderLayer({ armed: true, tool: 'highlight', onToolChange: vi.fn() })
    expect(screen.queryByRole('button', { name: 'books.annotations.pin' })).not.toBeInTheDocument()
    // the controlled tool still drives the gesture handling
    expect(screen.getByTestId('anno-root').style.touchAction).toBe('none')
  })
})

const MARKS: BookAnnotation[] = [1, 2].map((n) => ({
  id: n,
  version_id: 5,
  page: 1,
  kind: 'pin' as const,
  geometry: { x: 0.2 * n, y: 0.3 },
  comment: `fix ${n}`,
  author_user_id: 9,
  author_name: 'Reviewer',
  created_at: '2026-08-01T09:00:00Z',
}))

describe('BookAnnotationLayer marks', () => {
  it('hides delete for optimistic marks (id <= 0)', async () => {
    const user = userEvent.setup()
    renderLayer({
      armed: true,
      currentUserId: 9,
      annotations: [{ ...MARKS[0], id: -1 }],
    })
    await user.click(screen.getByRole('button', { name: 'books.annotations.markN' }))
    expect(screen.queryByRole('button', { name: 'books.annotations.delete' })).not.toBeInTheDocument()
  })

  it('delete hides the mark at once and commits only after the undo window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const onDelete = vi.fn()
      renderLayer({ armed: true, currentUserId: 9, annotations: [MARKS[0]], onDelete })
      fireEvent.click(screen.getByRole('button', { name: 'books.annotations.markN' }))
      fireEvent.click(screen.getByRole('button', { name: 'books.annotations.delete' }))
      expect(screen.queryByRole('button', { name: 'books.annotations.markN' })).not.toBeInTheDocument()
      expect(onDelete).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(6100)
      expect(onDelete).toHaveBeenCalledWith(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('BookAnnotationLayer delete + Undo toast', () => {
  type UndoToast = [string, { action: { onClick: () => void } }]
  const undoAction = (): (() => void) => {
    const call = toastFn.mock.calls[0] as UndoToast
    return call[1].action.onClick
  }
  const deleteFirstMark = (props: Partial<React.ComponentProps<typeof BookAnnotationLayer>>) => {
    const utils = renderLayer({ armed: true, currentUserId: 9, annotations: [MARKS[0]], ...props })
    fireEvent.click(screen.getByRole('button', { name: 'books.annotations.markN' }))
    fireEvent.click(screen.getByRole('button', { name: 'books.annotations.delete' }))
    return utils
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    toastFn.mockReset().mockReturnValue('toast-1')
    toastError.mockReset()
    toastSuccess.mockReset()
    toastDismiss.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('Undo inside the window restores the mark, sends nothing and shows no error', async () => {
    const onDelete = vi.fn()
    deleteFirstMark({ onDelete })
    act(() => undoAction()())
    expect(screen.getByRole('button', { name: 'books.annotations.markN' })).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(onDelete).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
    expect(toastDismiss).not.toHaveBeenCalled()
  })

  it('unmounting commits the delete once and dismisses the Undo toast', () => {
    const onDelete = vi.fn()
    const { unmount } = deleteFirstMark({ onDelete })
    expect(toastFn).toHaveBeenCalledTimes(1)
    expect(onDelete).not.toHaveBeenCalled()
    unmount()
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith(1)
    expect(toastDismiss).toHaveBeenCalledWith('toast-1')
  })

  it('an Undo that lands after the commit says too late, never "restored"', async () => {
    const onDelete = vi.fn()
    deleteFirstMark({ onDelete })
    await vi.advanceTimersByTimeAsync(6100)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(toastDismiss).toHaveBeenCalledWith('toast-1')
    act(() => undoAction()())
    expect(toastError).toHaveBeenCalledWith('books.annotations.undoTooLate')
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('keeps the mark hidden until onDelete (server delete + refetch) settles', async () => {
    let settle!: () => void
    const onDelete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve
        }),
    )
    deleteFirstMark({ onDelete })
    await vi.advanceTimersByTimeAsync(6100)
    expect(onDelete).toHaveBeenCalledWith(1)
    expect(screen.queryByRole('button', { name: 'books.annotations.markN' })).not.toBeInTheDocument()
    await act(async () => {
      settle()
      await vi.advanceTimersByTimeAsync(0)
    })
    // The parent's refetch would have dropped the mark by now; this static
    // prop still has it, so it shows again once the delete has settled.
    expect(screen.getByRole('button', { name: 'books.annotations.markN' })).toBeInTheDocument()
  })
})

describe('MarksStepper', () => {
  it('reads "{count} marks from {name}" and steps through the marks', async () => {
    const user = userEvent.setup()
    const onOpenIdChange = vi.fn()
    render(<MarksStepper annotations={MARKS} openId={null} onOpenIdChange={onOpenIdChange} />)
    expect(screen.getByRole('status')).toHaveTextContent('books.paper.marksFrom')
    await user.click(screen.getByRole('button', { name: 'common.next' }))
    expect(onOpenIdChange).toHaveBeenLastCalledWith(1)
    await user.click(screen.getByRole('button', { name: 'common.previous' }))
    expect(onOpenIdChange).toHaveBeenLastCalledWith(2)
  })

  it('wraps from the last mark to the first', async () => {
    const user = userEvent.setup()
    const onOpenIdChange = vi.fn()
    render(<MarksStepper annotations={MARKS} openId={2} onOpenIdChange={onOpenIdChange} />)
    await user.click(screen.getByRole('button', { name: 'common.next' }))
    expect(onOpenIdChange).toHaveBeenLastCalledWith(1)
  })
})
