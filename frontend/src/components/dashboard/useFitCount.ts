import { useLayoutEffect, useRef, useState } from 'react'

/** Reserve only complete rows, including any inter-row gap. */
export function countFittingRows(height: number, rowHeight: number, candidates: number, gap = 0): number {
  if (height <= 0 || rowHeight <= 0 || candidates <= 0) return 0
  return Math.min(candidates, Math.max(0, Math.floor((height + gap) / (rowHeight + gap))))
}

/** `rows` is a fetch cap; the actual viewport decides how many candidates fit. */
export function useFitCount(candidateCount: number) {
  const listRef = useRef<HTMLUListElement>(null)
  const [visibleCount, setVisibleCount] = useState(candidateCount)
  const measured = useRef({ candidates: candidateCount, rowHeight: 0 })

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    if (measured.current.candidates !== candidateCount) {
      measured.current = { candidates: candidateCount, rowHeight: 0 }
    }
    const geometry = () => {
      const box = list.getBoundingClientRect()
      const heights = Array.from(list.children, (row) => row.getBoundingClientRect().height)
      return { box, heights, signature: [box.width, box.height, ...heights].join(',') }
    }
    let signature = ''
    const measure = () => {
      const current = geometry()
      signature = current.signature
      const rowHeight = Math.max(0, ...current.heights)
      // No layout (e.g. jsdom), or new data with no mounted probe row yet.
      if (!rowHeight && !measured.current.rowHeight) {
        setVisibleCount(candidateCount)
        return
      }
      // Keep the largest measured candidate while hiding shorter rows.
      measured.current.rowHeight = Math.max(measured.current.rowHeight, rowHeight)
      const style = getComputedStyle(list)
      const height = list.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0)
      setVisibleCount(countFittingRows(height, measured.current.rowHeight, candidateCount, parseFloat(style.rowGap) || 0))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (geometry().signature === signature) return
      // Re-measure all candidates before paint after width, Aa scale or row-content changes.
      measured.current.rowHeight = 0
      setVisibleCount(candidateCount)
      measure()
    })
    observer.observe(list)
    for (let index = 0; index < list.children.length; index++) observer.observe(list.children[index]!)
    return () => observer.disconnect()
  })

  return { listRef, visibleCount: Math.min(visibleCount, candidateCount) }
}
