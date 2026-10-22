/**
 * Runs the real Sileo host and the real `toast` adapter together (nothing is
 * mocked), because the behaviour worth pinning is where the two meet: ids,
 * stacking, update-in-place, action/dismiss, announcements and theme.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toast, TOAST_DEFAULT_DURATION_MS, TOAST_TITLE_MAX_CHARS } from '@/lib/toast'

import { AppToaster } from './AppToaster'

const toastEls = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-sileo-toast]:not([data-exiting="true"])'))

const titleOf = (el: HTMLElement): string | null =>
  el.querySelector('[data-sileo-header-inner][data-layer="current"] [data-sileo-title]')!.textContent

beforeEach(() => {
  document.documentElement.dataset.theme = 'light'
  render(<AppToaster />)
})

afterEach(() => {
  act(() => toast.dismiss())
  vi.useRealTimers()
  delete document.documentElement.dataset.theme
})

describe('AppToaster + toast adapter', () => {
  it('stacks toasts raised without an id instead of letting one replace the other', () => {
    act(() => {
      toast.success('Saved')
      toast.success('Saved again')
    })
    expect(toastEls().map(titleOf)).toEqual(['Saved', 'Saved again'])
  })

  it('updates a toast in place when the same id is raised again, keeping its slot', () => {
    act(() => {
      toast.loading('Reading scan…', { id: 'scan' })
      toast.success('Other')
    })
    expect(toastEls()).toHaveLength(2)

    act(() => {
      toast.success('Filed', { id: 'scan' })
    })
    const els = toastEls()
    expect(els).toHaveLength(2)
    expect(els[0].dataset.state).toBe('success')
    expect(titleOf(els[0])).toBe('Filed')
  })

  it('gives numeric and string ids the same identity', () => {
    act(() => {
      toast.info('First', { id: 7 })
      toast.info('Second', { id: '7' })
    })
    expect(toastEls().map(titleOf)).toEqual(['Second'])
  })

  it('maps every call shape to a Sileo state', () => {
    act(() => {
      toast('Plain')
      toast('With undo', { action: { label: 'Undo', onClick: () => {} } })
      toast.success('s')
      toast.error('e')
      toast.warning('w')
      toast.info('i')
      toast.loading('l')
    })
    expect(toastEls().map((el) => el.dataset.state)).toEqual([
      'info',
      'action',
      'success',
      'error',
      'warning',
      'info',
      'loading',
    ])
  })

  it('keeps a message that fits the pill as the title and the description in the body', () => {
    const message = 'x'.repeat(TOAST_TITLE_MAX_CHARS)
    act(() => {
      toast.success(message, { description: 'Reference PMT-0001' })
    })
    const el = toastEls()[0]
    expect(titleOf(el)).toBe(message)
    expect(el.querySelector('[data-sileo-description]')).toHaveTextContent('Reference PMT-0001')
  })

  it('moves a message too long for the pill into the body under a state title', () => {
    const message = 'Could not generate the document because the template is missing a field.'
    expect(message.length).toBeGreaterThan(TOAST_TITLE_MAX_CHARS)
    act(() => {
      toast.error(message, { description: 'Template: leave-notice' })
    })
    const el = toastEls()[0]
    expect(titleOf(el)).toBe('Error')
    const body = el.querySelector('[data-sileo-description]')!
    expect(body.textContent).toBe(`${message}\nTemplate: leave-notice`)
  })

  it('runs the action, then closes the toast (Sileo does not close it for us)', async () => {
    const onClick = vi.fn()
    act(() => {
      toast('Moved to Trash', { action: { label: 'Undo', onClick } })
    })
    fireEvent.click(screen.getByText('Undo'))

    expect(onClick).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.querySelector('[data-sileo-toast]')).toBeNull())
  })

  it('closes the toast even when the action throws', async () => {
    const onClick = vi.fn(() => {
      throw new Error('boom')
    })
    act(() => {
      toast('Moved to Trash', { action: { label: 'Undo', onClick } })
    })
    // React reports the handler error to the window; swallow only that.
    const swallow = (e: ErrorEvent): void => e.preventDefault()
    window.addEventListener('error', swallow)
    try {
      fireEvent.click(screen.getByText('Undo'))
    } finally {
      window.removeEventListener('error', swallow)
    }
    await waitFor(() => expect(document.querySelector('[data-sileo-toast]')).toBeNull())
  })

  it('dismisses by id, and with no id dismisses everything', async () => {
    let first = ''
    act(() => {
      first = toast.success('One')
      toast.success('Two')
    })
    act(() => toast.dismiss(first))
    await waitFor(() => expect(toastEls().map(titleOf)).toEqual(['Two']))

    act(() => toast.dismiss())
    await waitFor(() => expect(document.querySelector('[data-sileo-toast]')).toBeNull())
  })

  it('auto-closes after the default duration, and honours Infinity as "stay"', () => {
    vi.useFakeTimers()
    act(() => {
      toast.success('Brief')
      toast.warning('Sticky', { duration: Infinity })
      toast.loading('Working')
    })
    act(() => {
      vi.advanceTimersByTime(TOAST_DEFAULT_DURATION_MS + 1000)
    })
    expect(toastEls().map(titleOf)).toEqual(['Sticky', 'Working'])
  })

  it('closes at exactly 4000 ms by default, not earlier or later', () => {
    vi.useFakeTimers()
    act(() => {
      toast.success('Default')
    })
    act(() => {
      vi.advanceTimersByTime(3900)
    })
    expect(toastEls().map(titleOf)).toEqual(['Default'])
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(toastEls()).toHaveLength(0)
  })

  it('honours an explicit duration override and keeps loading persistent', () => {
    vi.useFakeTimers()
    act(() => {
      toast.success('Long', { duration: 9000 })
      toast.error('Short', { duration: 1000 })
      toast.loading('Working')
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(toastEls().map(titleOf)).toEqual(['Long', 'Working'])
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(toastEls().map(titleOf)).toEqual(['Long', 'Working'])
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(toastEls().map(titleOf)).toEqual(['Working'])
  })

  it('keeps auto-closing later toasts after one is dismissed under the pointer', async () => {
    // Sileo clears its hovered flag only on a mouseleave, which a toast closing
    // under the pointer never sends: without the host's release every later toast
    // would stay up forever.
    act(() => {
      toast.success('Hovered')
    })
    const hovered = toastEls()[0]
    fireEvent.mouseOver(hovered)
    fireEvent.click(hovered)
    await waitFor(() => expect(document.querySelector('[data-sileo-toast]')).toBeNull())

    vi.useFakeTimers()
    // The host releases the stale flag from a MutationObserver (a microtask).
    await act(async () => {
      toast.success('Next')
    })
    act(() => {
      vi.advanceTimersByTime(TOAST_DEFAULT_DURATION_MS + 1000)
    })
    expect(toastEls()).toHaveLength(0)
  })

  describe('re-raising a fixed id while the previous toast is closing', () => {
    // Sileo removes every item with a dismissed id 600 ms later; a toast raised
    // with that id inside the window used to be deleted by the stale timer.
    const ID = 'timesheet-cell-locked'
    const closers: Array<[string, () => void]> = [
      [
        'click',
        () => {
          fireEvent.click(toastEls()[0])
        },
      ],
      [
        'Escape',
        () => {
          const el = toastEls()[0]
          el.focus()
          fireEvent.keyDown(el, { key: 'Escape' })
        },
      ],
      [
        'default timeout',
        () => {
          vi.advanceTimersByTime(TOAST_DEFAULT_DURATION_MS + 50)
        },
      ],
      ['toast.dismiss(id)', () => toast.dismiss(ID)],
    ]

    it.each(closers)('keeps the second toast after the first closes by %s', async (_name, close) => {
      vi.useFakeTimers()
      await act(async () => {
        toast.warning('First', { id: ID })
      })
      await act(async () => {
        close()
      })
      await act(async () => {
        vi.advanceTimersByTime(300)
      })
      await act(async () => {
        toast.warning('Second', { id: ID })
      })
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      expect(toastEls().map(titleOf)).toEqual(['Second'])
    })

    it('still updates in place while the toast is live, and never duplicates it', async () => {
      vi.useFakeTimers()
      await act(async () => {
        toast.warning('First', { id: ID })
      })
      await act(async () => {
        vi.advanceTimersByTime(1000)
        toast.warning('Updated', { id: ID })
      })
      expect(toastEls().map(titleOf)).toEqual(['Updated'])
    })

    it('dismisses by the id the caller was given, and dismiss-all clears fixed ids too', async () => {
      vi.useFakeTimers()
      let returned = ''
      await act(async () => {
        returned = toast.info('Fixed', { id: ID })
      })
      expect(returned).toBe(ID)
      await act(async () => {
        toast.dismiss(returned)
        vi.advanceTimersByTime(700)
      })
      expect(toastEls()).toHaveLength(0)

      await act(async () => {
        toast.info('Again', { id: ID })
      })
      await act(async () => {
        toast.dismiss()
        toast.info('After clear', { id: ID })
        vi.advanceTimersByTime(700)
      })
      expect(toastEls().map(titleOf)).toEqual(['After clear'])
    })
  })

  describe('an id returned by a toast call', () => {
    it('turns the loading toast it came from into the success, in place', async () => {
      vi.useFakeTimers()
      let id = ''
      await act(async () => {
        id = toast.loading('Uploading')
      })
      expect(toastEls().map(titleOf)).toEqual(['Uploading'])
      await act(async () => {
        toast.success('Uploaded', { id })
        vi.advanceTimersByTime(1000)
      })
      expect(toastEls().map(titleOf)).toEqual(['Uploaded'])
      expect(toastEls()[0].dataset.state).toBe('success')
    })

    it('turns the loading toast into an error, and lets the new toast time out', async () => {
      vi.useFakeTimers()
      let id = ''
      await act(async () => {
        id = toast.loading('Uploading')
      })
      await act(async () => {
        toast.error('Upload failed', { id })
        vi.advanceTimersByTime(1000)
      })
      expect(toastEls().map(titleOf)).toEqual(['Upload failed'])
      await act(async () => {
        vi.advanceTimersByTime(TOAST_DEFAULT_DURATION_MS + 1000)
      })
      expect(toastEls()).toHaveLength(0)
    })

    it('updates an ordinary toast in place and dismisses by that id', async () => {
      vi.useFakeTimers()
      let id = ''
      await act(async () => {
        id = toast('Deleted', { duration: 20_000 })
        toast.info('Other')
      })
      await act(async () => {
        toast.info('Deleted again', { id, duration: 20_000 })
        vi.advanceTimersByTime(1000)
      })
      expect(toastEls().map(titleOf)).toEqual(['Deleted again', 'Other'])
      await act(async () => {
        toast.dismiss(id)
        vi.advanceTimersByTime(700)
      })
      expect(toastEls().map(titleOf)).toEqual(['Other'])
    })

    it('is raised again as a fresh toast after it closed', async () => {
      vi.useFakeTimers()
      let id = ''
      await act(async () => {
        id = toast.success('One')
      })
      await act(async () => {
        vi.advanceTimersByTime(TOAST_DEFAULT_DURATION_MS + 50)
      })
      await act(async () => {
        vi.advanceTimersByTime(300)
        toast.success('Two', { id })
      })
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      expect(toastEls().map(titleOf)).toEqual(['Two'])
    })

    it('never hands out an id a caller already holds', async () => {
      await act(async () => {
        toast.info('Held', { id: 'toast-1', duration: Infinity })
        toast.info('Anonymous', { duration: Infinity })
      })
      expect(toastEls().map(titleOf)).toEqual(['Held', 'Anonymous'])
    })
  })

  it('click on the toast dismisses it, except a loading one', async () => {
    act(() => {
      toast.loading('Working')
      toast.success('Done')
    })
    const [loading, done] = toastEls()

    fireEvent.click(loading)
    fireEvent.click(done)

    await waitFor(() => expect(toastEls().map(titleOf)).toEqual(['Working']))
  })

  it('Escape on a focused toast dismisses it', async () => {
    act(() => {
      toast.success('Done')
    })
    const el = toastEls()[0]
    el.focus()
    fireEvent.keyDown(el, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('[data-sileo-toast]')).toBeNull())
  })

  it('lets Sileo find the id of a toast: pins the filter-id contract the click/Escape paths read', () => {
    act(() => {
      toast.success('Done', { id: 'record-delete-3' })
    })
    // Caller id plus the adapter's generation suffix.
    expect(toastEls()[0].querySelector('filter')?.id).toMatch(/^sileo-gooey-record-delete-3#\d+$/)
  })

  it('walks a promise from loading to success and to error under one id', async () => {
    let resolve!: (value: number) => void
    const pending = new Promise<number>((r) => {
      resolve = r
    })
    act(() => {
      void toast.promise(pending, {
        loading: 'Generating…',
        success: (n) => `Generated ${n} pages`,
        error: 'Failed',
      })
    })
    expect(toastEls()).toHaveLength(1)
    expect(toastEls()[0].dataset.state).toBe('loading')

    await act(async () => resolve(3))
    await waitFor(() => expect(toastEls()[0].dataset.state).toBe('success'))
    expect(toastEls()).toHaveLength(1)
    expect(titleOf(toastEls()[0])).toBe('Generated 3 pages')

    await act(async () => {
      await toast.promise(Promise.reject(new Error('nope')), { loading: 'Again…', success: 'ok', error: (e) => String(e) }).catch(() => {})
    })
    await waitFor(() => expect(toastEls().map((el) => el.dataset.state)).toEqual(['success', 'error']))
  })

  it('announces through always-mounted live regions: errors assertively, the rest politely', () => {
    const polite = document.querySelector('[data-toast-announcer="polite"]') as HTMLElement
    const assertive = document.querySelector('[data-toast-announcer="assertive"]') as HTMLElement
    expect(polite).toHaveAttribute('role', 'status')
    expect(assertive).toHaveAttribute('role', 'alert')

    act(() => {
      toast.success('Saved', { description: 'Employee 12' })
      toast.error('Could not save')
    })
    expect(polite).toHaveTextContent('Done: Saved. Employee 12')
    expect(assertive).toHaveTextContent('Error: Could not save')
    expect(polite).not.toHaveTextContent('Could not save')
  })

  it('silences the Sileo viewport so a notice is not read twice', () => {
    act(() => {
      toast.success('Saved')
    })
    return waitFor(() => {
      expect(document.querySelector('[data-sileo-viewport]')).toHaveAttribute('aria-live', 'off')
      expect(document.querySelector('[data-sileo-canvas]')).toHaveAttribute('aria-hidden', 'true')
      expect(document.querySelector('[data-sileo-badge]')).toHaveAttribute('aria-hidden', 'true')
    })
  })

  it('follows the app theme: a dark page flips the live toast to a light pill without a reload', async () => {
    act(() => {
      toast.success('Saved')
    })
    expect(document.querySelector('[data-sileo-viewport]')).toHaveAttribute('data-theme', 'light')

    act(() => {
      document.documentElement.dataset.theme = 'dark'
    })
    await waitFor(() => expect(document.querySelector('[data-sileo-viewport]')).toHaveAttribute('data-theme', 'dark'))
    // Fill is derived from the theme at render time, so the live toast flips too.
    expect(document.querySelector('[data-sileo-pill]')).toHaveAttribute('fill', '#f2f2f2')
  })
})
