import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { countFittingRows, useFitCount } from './useFitCount'

it.each([
  [130, 36, 5, 0, 3],
  [144, 36, 5, 0, 4],
  [143.9, 36, 5, 0, 3],
  [130, 44, 5, 0, 2],
  [130, 52, 5, 0, 2],
  [130, 60, 5, 0, 2],
  [130, 36, 2, 0, 2],
  [130, 36, 5, 4, 3],
  [0, 36, 5, 0, 0],
  [35, 36, 5, 0, 0],
])('fits only whole rows for viewport=%s row=%s', (height, rowHeight, candidates, gap, expected) => {
  expect(countFittingRows(height, rowHeight, candidates, gap)).toBe(expected)
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('updates shown rows and remainder after viewport and Aa-scale changes, including recovery from zero rows', () => {
  let height = 130
  let rowHeight = 36
  let resized = () => {}
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback }
    observe() {}
    disconnect() {}
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: 200, height: this.tagName === 'LI' ? rowHeight : height,
      top: 0, left: 0, right: 200, bottom: height, x: 0, y: 0, toJSON() {} }
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height)
  function Preview() {
    const { listRef, visibleCount } = useFitCount(4)
    return <><ul ref={listRef}>{Array.from({ length: visibleCount }, (_, i) => <li key={i}>Row {i}</li>)}</ul><a href="/records">+{5 - visibleCount} more</a></>
  }
  render(<Preview />)
  expect(screen.getAllByRole('listitem')).toHaveLength(3)
  expect(screen.getByRole('link')).toHaveTextContent('+2 more')
  act(() => { rowHeight = 60; resized() })
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByRole('link')).toHaveTextContent('+3 more')
  act(() => { height = 30; resized() })
  expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  expect(screen.getByRole('link')).toHaveTextContent('+5 more')
  act(() => { height = 150; resized() })
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  act(() => { rowHeight = 36; resized() })
  expect(screen.getAllByRole('listitem')).toHaveLength(4)
  expect(screen.getByRole('link')).toHaveTextContent('+1 more')
})
