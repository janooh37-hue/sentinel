/**
 * Per-kind email baskets, persisted to localStorage. Each basket holds
 * lightweight document references (no bytes); the PDF is fetched fresh at send.
 * Keyed by *perceived kind*: leave forms split by leave type, others by template.
 */
export interface EmailBasketItem {
  bookId: number // book row id — identity (dedupe) + compose reference id
  docId: number // backing document id — PDF attach source
  ref: string
  employeeId: string
  nameEn: string
  nameAr: string | null
  formKind: string // template id, e.g. "Leave Application Form" / "Violation Form"
  leaveType?: string // present for leave forms; drives the basket key
  detail: string // period for leaves, subject for others
  startDate?: string // leave forms: ISO start_date — drives From / تاريخ الإجازة + Leave Days
  endDate?: string // leave forms: ISO end_date — drives To / ولغاية + Leave Days
  positionEn?: string // employee designation (English)
  positionAr?: string // employee designation (Arabic) — المسمى الوظيفي / المهام column
  nationality?: string // employee nationality — الجنسية column (salary transfer / resignation / passport)
  bankName?: string // salary transfer: destination bank (form field bank_name) — named in the intro
  phone?: string // employee contact — رقم الهاتف column (resignation)
  joinDate?: string // employee doj — تاريخ الالتحاق column (resignation)
  resumptionDate?: string // duty resumption: تاريخ استئناف الواجب column (return-from-leave)
  lastWorkDay?: string // resignation: أخر يوم عمل column
  bookDate?: string // ISO issue date (book.created_at) — transfer cover-email date
}

export type BasketKey = string

export const BASKET_KEY = 'gssg.emailBasket'
/** Dispatched on the window after a same-tab mutation so the hook re-reads. */
export const BASKET_EVENT = 'gssg:emailBasket'

export function basketKey(item: EmailBasketItem): BasketKey {
  return item.leaveType ? `leave:${item.leaveType}` : item.formKind
}

const LEAVE_LABEL_KEYS: Record<string, string> = {
  Sick: 'basket.kind.sick',
  Annual: 'basket.kind.annual',
  Compassionate: 'basket.kind.compassionate',
  Duty: 'basket.kind.duty',
  Emergency: 'basket.kind.emergency',
  Hajj: 'basket.kind.hajj',
  Others: 'basket.kind.others',
}

/** Human label for a basket. Leave kinds use i18n; other forms show the template id. */
export function basketLabel(
  key: BasketKey,
  t: (k: string, o?: object) => string,
): string {
  if (key.startsWith('leave:')) {
    const type = key.slice('leave:'.length)
    const k = LEAVE_LABEL_KEYS[type]
    return k ? t(k) : type
  }
  return key
}

function sanitize(part: string): string {
  return (part || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
}

/** `{ref}_{form}_{employee}.pdf` — readable when several PDFs land in one email. */
export function filenameForItem(item: EmailBasketItem): string {
  return `${sanitize(item.ref)}_${sanitize(item.formKind)}_${sanitize(item.nameEn)}.pdf`
}

/** Count basket items per template (formKind). Leave-type baskets all roll up
 *  under "Leave Application Form" since every leave item carries that formKind. */
export function countByFormKind(
  baskets: Record<BasketKey, EmailBasketItem[]>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const list of Object.values(baskets)) {
    for (const item of list) out[item.formKind] = (out[item.formKind] ?? 0) + 1
  }
  return out
}

export function loadBaskets(): Record<BasketKey, EmailBasketItem[]> {
  try {
    const raw = localStorage.getItem(BASKET_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<BasketKey, EmailBasketItem[]>)
      : {}
  } catch {
    return {}
  }
}

function save(baskets: Record<BasketKey, EmailBasketItem[]>): void {
  try {
    localStorage.setItem(BASKET_KEY, JSON.stringify(baskets))
    window.dispatchEvent(new Event(BASKET_EVENT))
  } catch {
    /* private-mode / quota — non-fatal */
  }
}

export function addToBasket(item: EmailBasketItem): { added: boolean; key: BasketKey } {
  const key = basketKey(item)
  const baskets = loadBaskets()
  const list = baskets[key] ?? []
  if (list.some((i) => i.bookId === item.bookId)) return { added: false, key }
  baskets[key] = [...list, item]
  save(baskets)
  return { added: true, key }
}

export function removeFromBasket(key: BasketKey, docId: number): void {
  const baskets = loadBaskets()
  const list = baskets[key]
  if (!list) return
  const next = list.filter((i) => i.docId !== docId)
  if (next.length === 0) delete baskets[key]
  else baskets[key] = next
  save(baskets)
}

export function clearBasket(key: BasketKey): void {
  const baskets = loadBaskets()
  if (!(key in baskets)) return
  delete baskets[key]
  save(baskets)
}
