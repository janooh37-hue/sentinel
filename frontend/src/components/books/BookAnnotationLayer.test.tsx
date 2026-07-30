/**
 * Arm-to-mark: the overlay must not swallow touches while the manager is
 * reading. Disarmed it is pointer-events:none so native pinch-zoom and scroll
 * reach the paper underneath; armed it becomes interactive.
 */
import { render, screen } from '@testing-library/react'
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
