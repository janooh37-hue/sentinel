import type { NavigateFunction } from 'react-router-dom'

import { isQuickActionAllowed } from '@/lib/dashboardLayout'
import { saveDraft } from '@/lib/formDrafts'
import { serviceHref } from '@/lib/quickActions'

/** The English Material Request Form is the paper HQ supplies the Store from. */
const HQ_MRF = 'Material Request Form'

export interface HqRequestRow {
  code: string
  description: string
  unit: string
  qty: number
}

/** Mirrors the Services route gate and the MRF quick-action capability. */
export function canOpenHqMaterialRequest(has: (cap: string) => boolean): boolean {
  return isQuickActionAllowed(HQ_MRF, has)
}

/**
 * Prefills the English MRF draft with the given rows (legacy items-table shape)
 * and opens it; `?paper=en` keeps the English paper in the Arabic UI.
 */
export function openHqMaterialRequest(navigate: NavigateFunction, rows: HqRequestRow[]): void {
  saveDraft(HQ_MRF, {
    items: rows.map((r, i) => ({
      sno: String(i + 1),
      code: r.code,
      description: r.description,
      unit: r.unit,
      qty: String(r.qty),
      quantity: String(r.qty),
      remarks: '',
    })),
  })
  navigate(`${serviceHref(HQ_MRF)}?paper=en`)
}
