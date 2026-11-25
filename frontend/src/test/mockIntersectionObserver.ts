/**
 * An IntersectionObserver the test drives, for the pdf.js page stack: nothing
 * is "near the viewport" until `await setNearPages(...)` says which page boxes are.
 * `installMockIntersectionObserver()` in `beforeEach`, `vi.unstubAllGlobals()` in `afterEach`.
 */
import { act, waitFor } from '@testing-library/react'
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
export async function setNearPages(near: number[]): Promise<void> {
  // PdfPages creates the observer in a passive effect of the commit that rendered the page
  // boxes. That commit runs outside act (the pdf.js page promises settle on their own), so
  // React flushes its effects on a later scheduler task, which an empty act() does not run.
  // Wait for the observer instead of assuming it exists.
  const observer = await waitFor(() => {
    const found = MockIntersectionObserver.instances.find((o) => o.options?.rootMargin !== undefined)
    if (!found) throw new Error('near observer not created yet')
    return found
  })
  act(() => observer.fire(near))
}
