import { describe, expect, it } from 'vitest'

import {
  FULL_TOOLBAR_ROWS,
  GENERAL_BOOK_PAGE_VIEW,
  buildContentStyle,
} from './rich-editor-config'

describe('FULL_TOOLBAR_ROWS', () => {
  it('puts pagebreak in row 1 beside the GSSG buttons', () => {
    expect(FULL_TOOLBAR_ROWS[0]).toContain('gssg-table pagebreak')
    expect(FULL_TOOLBAR_ROWS[1]).not.toContain('pagebreak')
  })
})

describe('buildContentStyle page view', () => {
  const css = buildContentStyle({ variant: 'full', pageView: GENERAL_BOOK_PAGE_VIEW })

  it('shapes the body as the printed page', () => {
    expect(css).toContain(`width: ${GENERAL_BOOK_PAGE_VIEW.pageWidthPx}px`)
    expect(css).toContain('margin: 18px auto')
    expect(css).toContain('box-shadow')
  })

  it('draws a labeled page-1 guide and repeated page-end guides', () => {
    expect(css).toContain(`${GENERAL_BOOK_PAGE_VIEW.page1BodyPx}px`)
    expect(css).toContain('نهاية الصفحة')
    expect(css).toContain('page end')
    // guide for page 2 = page1 + pageN
    expect(css).toContain(
      `${GENERAL_BOOK_PAGE_VIEW.page1BodyPx + GENERAL_BOOK_PAGE_VIEW.pageNBodyPx}px`,
    )
  })

  it('styles the page-break placeholder as a visible bar', () => {
    expect(css).toContain('img.mce-pagebreak')
    expect(css).toContain('double')
  })

  it('keeps the paper white in dark mode', () => {
    const dark = buildContentStyle({
      variant: 'full',
      pageView: GENERAL_BOOK_PAGE_VIEW,
      dark: true,
    })
    expect(dark).toContain('background: #fff')
  })
})

describe('buildContentStyle without page view', () => {
  it('full variant without pageView has no page canvas', () => {
    const css = buildContentStyle({ variant: 'full' })
    expect(css).not.toContain('box-shadow')
    expect(css).not.toContain('نهاية الصفحة')
  })

  it('minimal variant unchanged and hugs table paragraphs', () => {
    const css = buildContentStyle({ variant: 'minimal' })
    expect(css).toContain('table p { margin: 0; }')
    expect(css).not.toContain('box-shadow')
  })
})
