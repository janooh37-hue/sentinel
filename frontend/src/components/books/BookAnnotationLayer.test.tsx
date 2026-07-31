/**
 * Arm-to-mark: the overlay must not swallow touches while the manager is
 * reading. Disarmed it is pointer-events:none so native pinch-zoom and scroll
 * reach the paper underneath; armed it becomes interactive.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'

import { BookAnnotationLayer } from './BookAnnotationLayer'
import type { PageBox } from './annotation-utils'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

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
    expect(screen.queryByTitle('books.annotations.pin')).not.toBeInTheDocument()
  })

  it('becomes interactive and shows the toolbar when armed', () => {
    renderLayer({ armed: true })
    const root = screen.getByTestId('anno-root')
    expect(root.className).toContain('pointer-events-auto')
    expect(screen.getByTitle('books.annotations.pin')).toBeInTheDocument()
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
    await user.click(screen.getByTitle('books.annotations.highlight'))
    expect(screen.getByTestId('anno-root').style.touchAction).toBe('none')
  })

  it('disarms after saving a mark', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    const onDisarm = vi.fn()
    renderLayer({ armed: true, onCreate, onDisarm })

    fireEvent.pointerDown(screen.getByTestId('anno-root'), { clientX: 40, clientY: 40 })
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
    await user.click(screen.getByText('books.annotations.cancel'))

    expect(onDisarm).toHaveBeenCalledTimes(1)
  })

  it('drops an open draft when the overlay is disarmed', () => {
    const { rerender } = renderLayer({ armed: true })
    fireEvent.pointerDown(screen.getByTestId('anno-root'), { clientX: 40, clientY: 40 })
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
