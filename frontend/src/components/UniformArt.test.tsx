import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UniformArt } from './UniformArt'
import { UNIFORM_ART_GROUPS, UNIFORM_ART_KINDS, UNIFORM_ART_LABELS } from './uniformArtCatalog'

const silhouettes = [
  ['suit', 'M44 82h15l-1 22H46zM61 82h15l-2 22H62z', '#1c2b4a'],
  ['boots', 'M34 100V62q0-4 4-4h16q4 0 4 4v18q4 3 14 5l12 3q8 2 8 9v3z', '#b0916b'],
  ['polo', 'M45 32l-9 4-13 13 9 10 6-6v49h44V53l6 6 9-10-13-13-9-4q-15 7-30 0z', '#556642'],
  ['cargo', 'M36 36h48l2 68H64l-4-48-4 48H34z', '#c9b38e'],
  ['belt', 'M30 68a30 17 0 0 0 60 0', 'none'],
  ['cap', 'M32 80q0-34 28-36 28 2 28 36z', '#c9b38e'],
  ['socks', 'M38 34h18v38l18 10q8 4 4 12-4 6-12 2L42 84q-6-3-4-10z', '#ac9772'],
  ['jacket', 'M40 37l10-5h20l10 5 3 65H37z', '#c9b38e'],
  ['vest', 'M42 31l10 1 8 16 8-16 10-1q-3 23 10 29v41H32V60q13-6 10-29z', '#556642'],
  ['parka', 'M39 44l10-3 11 10 11-10 10 3 4 60H35z', '#556642'],
  ['dressshirt', 'M40 36l11-6h18l11 6 1 62q-21 12-42 0z', '#e8edf2'],
  ['longsleeve', 'M43 34l7-3h20l7 3 4 69H39z', '#556642'],
] as const

describe('UniformArt', () => {
  it.each(silhouettes)('renders the fixed %s silhouette and colour', (kind, path, fill) => {
    const { container } = render(<UniformArt kind={kind} />)
    const outline = Array.from(container.querySelectorAll('path')).find(node => node.getAttribute('d') === path)
    expect(outline).toHaveAttribute('fill', fill)
    expect(container.querySelector('ellipse')).toHaveAttribute('cy', '106')
    expect(container.querySelector('ellipse')).toHaveAttribute('ry', '4.5')
  })

  it('renders twelve distinct drawings, covering the entire catalog', () => {
    expect(UNIFORM_ART_KINDS).toEqual(silhouettes.map(([kind]) => kind))
    const { container, rerender } = render(<UniformArt />)
    const drawings = UNIFORM_ART_KINDS.map(kind => {
      rerender(<UniformArt kind={kind} />)
      return container.querySelector('svg')?.innerHTML
    })
    expect(new Set(drawings).size).toBe(12)
  })

  it.each([undefined, null, '', 'unknown', 'constructor', 'toString', '__proto__', 'hasOwnProperty'])('falls back to polo for %s', kind => {
    const { container, rerender } = render(<UniformArt kind="polo" />)
    const polo = container.innerHTML
    rerender(<UniformArt kind={kind} />)
    expect(container.innerHTML).toBe(polo)
  })

  it('is decorative and unfocusable, with a configurable frame', () => {
    const { container, rerender } = render(<UniformArt kind="suit" />)
    expect(container.querySelector('svg')).toHaveAttribute('width', '48')
    expect(container.querySelector('svg')).toHaveAttribute('height', '48')
    rerender(<UniformArt kind="suit" size={96} className="uniform-preview" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('viewBox', '20 20 80 90')
    expect(svg).toHaveAttribute('width', '96')
    expect(svg).toHaveAttribute('height', '96')
    expect(svg).toHaveClass('uniform-preview')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg).not.toHaveAttribute('tabindex')
    expect(svg?.querySelector('title, text')).toBeNull()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('provides bilingual labels and valid groups for every drawing', () => {
    expect(UNIFORM_ART_LABELS.map(entry => entry.kind)).toEqual(UNIFORM_ART_KINDS)
    expect(UNIFORM_ART_GROUPS.map(entry => entry.id)).toEqual(['tops', 'outerwear', 'bottoms', 'headwear', 'footwear', 'accessories'])
    for (const entry of [...UNIFORM_ART_GROUPS, ...UNIFORM_ART_LABELS]) {
      expect(entry.en).toMatch(/[A-Za-z]/)
      expect(entry.ar).toMatch(/[\u0600-\u06ff]/)
    }
    for (const entry of UNIFORM_ART_LABELS) {
      expect(UNIFORM_ART_GROUPS.some(group => group.id === entry.group)).toBe(true)
    }
    expect(UNIFORM_ART_LABELS.find(entry => entry.kind === 'polo')).toEqual({ kind: 'polo', en: 'Polo shirt', ar: 'قميص بولو', group: 'tops' })
  })
})
