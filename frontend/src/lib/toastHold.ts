/**
 * Whether the pointer or keyboard focus is holding the toast stack.
 *
 * Sileo pauses every toast's close timer while one is hovered and restarts each
 * from its full duration when the pointer leaves. The host (AppToaster) reports
 * that here so an Undo countdown can pause with it and restart in step.
 */
export interface ToastHold {
  held: boolean
  /** Bumped on every release: the moment Sileo restarts the timers. */
  epoch: number
}

let state: ToastHold = { held: false, epoch: 0 }
const listeners = new Set<() => void>()

export function setToastHeld(held: boolean): void {
  if (held === state.held) return
  state = { held, epoch: held ? state.epoch : state.epoch + 1 }
  for (const listener of listeners) listener()
}

export function subscribeToastHold(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getToastHold(): ToastHold {
  return state
}
