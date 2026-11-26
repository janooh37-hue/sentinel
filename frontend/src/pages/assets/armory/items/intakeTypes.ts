/** What opens Receive stock prefilled: from an item, a safe, Find's unknown serial or a duplicate shortcut. */
export interface ReceivePreset {
  itemId?: number
  safeId?: number
  mode?: 'receipt' | 'opening'
  /** Normalized serial code typed in Find; never registered without the user saving. */
  serialCode?: string
}

/** Resume signal after "Not listed? Add item": the new item to add as a line, or `null` when Add item was cancelled. */
export interface ReceiveResume {
  signal: number
  itemId: number | null
}
