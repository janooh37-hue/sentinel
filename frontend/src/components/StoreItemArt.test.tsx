import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StoreItemArt } from './StoreItemArt'
import { STORE_ART_COLORS, STORE_ART_KINDS } from './storeItemArt'

describe('StoreItemArt', () => {
  it.each([null, undefined, 'unrecognised'])('renders the plain carton for kind %s', (kind) => {
    const { container, rerender } = render(<StoreItemArt kind="carton" categoryId={2} />)
    const carton = container.innerHTML
    rerender(<StoreItemArt kind={kind} categoryId={2} />)
    expect(container.innerHTML).toBe(carton)
    expect(container.querySelectorAll('svg')).toHaveLength(1)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('svg')).toHaveAttribute('focusable', 'false')
    expect(container.querySelector('text')).toBeNull()
  })

  it.each(STORE_ART_KINDS)('draws %s without text or nested SVGs', (kind) => {
    const { container } = render(<StoreItemArt kind={kind} color="#2583b8" />)
    expect(container.querySelectorAll('svg')).toHaveLength(1)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelectorAll('path, rect').length).toBeGreaterThan(0)
    expect(container.querySelector('text')).toBeNull()
  })

  it('uses a deterministic category palette unless an explicit colour is set', () => {
    const { container, rerender } = render(<StoreItemArt categoryId={1} />)
    const first = container.innerHTML
    expect(container.querySelector('rect')).toHaveAttribute('fill', STORE_ART_COLORS[1])
    rerender(<StoreItemArt categoryId={2} />)
    expect(container.innerHTML).not.toBe(first)
    rerender(<StoreItemArt categoryId={1} />)
    expect(container.innerHTML).toBe(first)
    rerender(<StoreItemArt categoryId={1} color="#abcdef" size={80} className="item-art" />)
    expect(container.querySelector('rect')).toHaveAttribute('fill', '#abcdef')
    expect(container.querySelector('svg')).toHaveAttribute('width', '80')
    expect(container.querySelector('svg')).toHaveClass('item-art')
  })
})
