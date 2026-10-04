/**
 * Visible names of a record's papers, used by every switcher (desk toolbar,
 * phone chips, full-screen viewer, pane strip): signed copy / original
 * (unsigned) / imported document / "Scan N". N counts scans in list order, so
 * labels stay 1…n even when an attachment index is not contiguous.
 */
import type { TFunction } from 'i18next'

import type { Paper } from './recordPapers'

export function paperLabels(t: TFunction, papers: readonly Paper[]): string[] {
  let scanOrdinal = 0
  return papers.map((p) => {
    switch (p.kind) {
      case 'signed':
        return t('books.paper.signed')
      case 'generated':
        return t('books.paper.original')
      case 'imported':
        return t('books.paper.imported')
      case 'scan':
        scanOrdinal += 1
        return t('books.paper.scan', { n: scanOrdinal })
    }
  })
}
