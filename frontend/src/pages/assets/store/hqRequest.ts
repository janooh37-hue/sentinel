/**
 * TEMPORARY STUB — writer B owns this file and replaces it wholesale at
 * integration. Only the signatures below are the contract; this body exists so
 * the Store dashboard compiles before B's branch lands.
 */

import type { NavigateFunction } from 'react-router-dom'

export interface HqRequestRow {
  code: string
  description: string
  unit: string
  qty: number
}

export function canOpenHqMaterialRequest(has: (cap: string) => boolean): boolean {
  return has('documents.generate')
}

export function openHqMaterialRequest(navigate: NavigateFunction, rows: HqRequestRow[]): void {
  void rows
  void navigate('/services/material_request?paper=en')
}
