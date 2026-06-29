/** Persist the last-used recipient / signing-manager / CC for transfers so the
 *  dialog pre-fills them next time. Non-fatal on any storage error. */
export interface TransferDefaults {
  recipientId: number | null
  managerId: number | null
  cc: string[]
}

const KEY = 'gssg.dutyTransfer.defaults'
const EMPTY: TransferDefaults = { recipientId: null, managerId: null, cc: [] }

export function loadTransferDefaults(): TransferDefaults {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...EMPTY }
    const p = JSON.parse(raw) as Partial<TransferDefaults>
    return {
      recipientId: typeof p.recipientId === 'number' ? p.recipientId : null,
      managerId: typeof p.managerId === 'number' ? p.managerId : null,
      cc: Array.isArray(p.cc) ? p.cc.filter((x): x is string => typeof x === 'string') : [],
    }
  } catch {
    return { ...EMPTY }
  }
}

export function saveTransferDefaults(d: TransferDefaults): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d))
  } catch {
    /* quota / private mode — non-fatal */
  }
}
