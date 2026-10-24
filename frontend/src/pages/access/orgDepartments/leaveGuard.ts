/**
 * Lets a view that holds unsaved work (guided setup) tell the section tabs
 * above it, so switching sections asks before discarding choices and waits
 * while a batch save runs.
 */

import { createContext } from 'react'

export interface LeaveState {
  /** A batch create or service save is running: leaving would drop its outcomes. */
  busy: boolean
  /** Unsaved choices that leaving would discard. */
  unsaved: number
}

export const NO_PENDING_WORK: LeaveState = { busy: false, unsaved: 0 }

export const LeaveGuardContext = createContext<(state: LeaveState) => void>(() => {})
