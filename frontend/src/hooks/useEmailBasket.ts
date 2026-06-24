import { useCallback, useSyncExternalStore } from 'react'

import {
  addToBasket, BASKET_EVENT, BASKET_KEY, clearBasket, loadBaskets,
  removeFromBasket, type BasketKey, type EmailBasketItem,
} from '@/lib/emailBasket'

function subscribe(cb: () => void): () => void {
  const onStorage = (e: StorageEvent): void => {
    if (e.key === BASKET_KEY || e.key === null) cb()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(BASKET_EVENT, cb)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(BASKET_EVENT, cb)
  }
}

// Snapshot must be referentially stable while unchanged → cache the raw string.
let cachedRaw = ''
let cachedValue: Record<BasketKey, EmailBasketItem[]> = {}
function getSnapshot(): Record<BasketKey, EmailBasketItem[]> {
  const raw = (() => {
    try {
      return localStorage.getItem(BASKET_KEY) ?? ''
    } catch {
      return ''
    }
  })()
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cachedValue = loadBaskets()
  }
  return cachedValue
}

export function useEmailBasket(): {
  baskets: Record<BasketKey, EmailBasketItem[]>
  add: (i: EmailBasketItem) => { added: boolean; key: BasketKey }
  remove: (k: BasketKey, docId: number) => void
  clear: (k: BasketKey) => void
  totalCount: number
} {
  const baskets = useSyncExternalStore(subscribe, getSnapshot, () => ({}))
  const add = useCallback((i: EmailBasketItem) => addToBasket(i), [])
  const remove = useCallback((k: BasketKey, docId: number) => removeFromBasket(k, docId), [])
  const clear = useCallback((k: BasketKey) => clearBasket(k), [])
  const totalCount = (Object.values(baskets) as EmailBasketItem[][]).reduce((n, list) => n + list.length, 0)
  return { baskets, add, remove, clear, totalCount }
}
