/**
 * An IntersectionObserver the test drives, for the pdf.js page stack: nothing
 * is "near the viewport" until `setNearPages` says which page boxes are.
 * `installMockIntersectionObserver()` in `beforeEach`, `vi.unstubAllGlobals()` in `afterEach`.
 */
import { act } from '@testing-library/react'
import { vi } from 'vitest'

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  readonly observed = new Set<Element>()
  private readonly callback: IntersectionObserverCallback
  readonly options: IntersectionObserverInit | undefined

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    MockIntersectionObserver.instances.push(this)
  }

  observe(el: Element): void {
    this.observed.add(el)
  }

  unobserve(el: Element): void {
    this.observed.delete(el)
  }

  disconnect(): void {
    this.observed.clear()
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  fire(near: number[]): void {
    const entries = [...this.observed].map((target) => ({
      target,
      isIntersecting: near.includes(Number((target as HTMLElement).dataset.pdfPage)),
      intersectionRatio: 0,
    }))
    this.callback(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver)
  }
}

export function installMockIntersectionObserver(): void {
  MockIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
}

/** The "near the viewport" observer is the one `PdfPages` builds with a rootMargin. */
export function setNearPages(near: number[]): void {
  // The observer is created in a passive effect that may still be pending; an empty act flushes it.
  act(() => undefined)
  const observer = MockIntersectionObserver.instances.find((o) => o.options?.rootMargin !== undefined)
  if (!observer) throw new Error('near observer not created yet')
  act(() => observer.fire(near))
}
