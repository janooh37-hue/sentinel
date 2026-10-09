import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { useSearchParam, useUrlOverlay } from './urlState'

function Page(): React.JSX.Element {
  const overlay = useUrlOverlay()
  const [q, setQ] = useSearchParam('q')
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <div>
      <p data-testid="where">{location.pathname + location.search}</p>
      <p data-testid="q">{q}</p>
      <p data-testid="state">{JSON.stringify(location.state)}</p>
      {overlay.value === 'edit' ? <div role="dialog">Edit</div> : null}
      <button type="button" onClick={() => overlay.open('edit')}>open</button>
      <button type="button" onClick={() => overlay.close()}>close</button>
      <button type="button" onClick={() => { overlay.close(); overlay.close() }}>close twice</button>
      <button type="button" onClick={() => setQ('abc')}>search</button>
      <button type="button" onClick={() => navigate(-1)}>back</button>
    </div>
  )
}

function renderAt(entries: string[]): void {
  render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Routes>
        <Route path="/list" element={<p data-testid="where">/list</p>} />
        <Route path="/page" element={<Page />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('useUrlOverlay', () => {
  it('open keeps the entry state (record nav context) alongside the overlay marker', async () => {
    const nav = { from: '/books', queue: [1, 2], scrollY: 5 }
    render(
      <MemoryRouter initialEntries={[{ pathname: '/page', state: nav }]}>
        <Routes>
          <Route path="/page" element={<Page />} />
        </Routes>
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '')).toEqual({ ...nav, overlay: true })
  })

  it('closing a directly opened overlay stays on the page', async () => {
    renderAt(['/page?action=edit'])
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'close' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/page$/)
  })

  it('Back closes an overlay opened in-app and stays on the page', async () => {
    renderAt(['/list', '/page'])
    await userEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'back' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/page$/)
  })

  it('closing an in-app overlay twice in one tick does not leave the page', async () => {
    renderAt(['/list', '/page'])
    await userEvent.click(screen.getByRole('button', { name: 'open' }))

    await userEvent.click(screen.getByRole('button', { name: 'close twice' }))

    expect(screen.getByTestId('where')).toHaveTextContent(/^\/page$/)
  })
})

describe('useSearchParam', () => {
  it('filter changes do not add history entries', async () => {
    renderAt(['/list', '/page'])
    await userEvent.click(screen.getByRole('button', { name: 'search' }))
    expect(screen.getByTestId('q')).toHaveTextContent('abc')

    await userEvent.click(screen.getByRole('button', { name: 'back' }))

    expect(screen.getByTestId('where')).toHaveTextContent('/list')
  })
})
