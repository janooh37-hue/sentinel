/**
 * TopNav tray listing open per-kind email baskets. "Send as one email" builds
 * a compose prefill (summary table + all PDFs + learned recipient) and routes
 * to /ledger, where the compose seeds the references and attaches every PDF.
 *
 * Uses DropdownMenu (Radix, portals to body) instead of a hand-rolled popover
 * so the tray escapes overflow/transform stacking contexts. Per-item ✕ and
 * "Clear" are plain <button>s (not DropdownMenuItems) so they do NOT auto-close
 * the menu on click. "Send" navigates away, so closing there is fine.
 */
import { Mail, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useEmailBasket } from '@/hooks/useEmailBasket'
import { basketLabel, type BasketKey, type EmailBasketItem } from '@/lib/emailBasket'
import { buildBasketPrefill } from '@/lib/basketEmail'
import { buildRecordBasketItem } from '@/pages/books/recordsBasket'
import { getRecentRecipientsForForm } from '@/lib/recentRecipients'

export function EmailBasketTray(): React.JSX.Element | null {
  const { t: tRaw, i18n } = useTranslation()
  // basketLabel expects a simple (k, o?) => string; cast the i18next TFunction.
  const t = tRaw as (k: string, o?: object) => string
  const navigate = useNavigate()
  const { baskets, remove, clear, totalCount } = useEmailBasket()

  if (totalCount === 0) return null

  const send = async (key: BasketKey, items: EmailBasketItem[]): Promise<void> => {
    // Re-enrich each item fresh at send time. A basket entry's employee/leave
    // data (designation, nationality, dates, …) is captured when it's ADDED, so
    // items added before the enrichment fix — or before the employee record was
    // complete — would otherwise send blank. Rebuild from current data via
    // getBook + buildRecordBasketItem; fall back to the stored item if the
    // lookup fails (deleted book / offline). Subject + body are fixed
    // official-letter templates owned by buildBasketPrefill.
    const refreshed = await Promise.all(
      items.map(async (it) => {
        try {
          const fresh = await buildRecordBasketItem(await api.getBook(it.bookId))
          return fresh ?? it
        } catch {
          return it
        }
      }),
    )
    const prefill = buildBasketPrefill(refreshed, getRecentRecipientsForForm(key))
    // Keep the basket's stored key so the correct (possibly mis-keyed, stale)
    // basket is the one cleared on a successful send.
    prefill.basketKey = key
    navigate('/ledger', { state: { composePrefill: prefill } })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('basket.tray.title')}
        >
          <Mail className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden />
          <span
            aria-hidden
            className="absolute -end-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground"
          >
            {totalCount}
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        {/* Header */}
        <div className="border-b border-border px-4 py-2.5 text-sm font-semibold">
          {t('basket.tray.title')}
        </div>

        {/* Per-basket rows — plain divs, not DropdownMenuItems, so buttons inside don't auto-close */}
        <div className="max-h-96 overflow-y-auto">
          {Object.entries(baskets).map(([key, items]) => (
            <div key={key} className="border-b border-border px-4 py-3 last:border-0">
              {/* Kind header + item count */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{basketLabel(key, t)}</span>
                <span className="text-xs text-muted-foreground">
                  {t('basket.tray.count', { count: items.length })}
                </span>
              </div>

              {/* Item list */}
              <ul className="mt-2 space-y-1">
                {items.map((item) => (
                  <li key={item.docId} className="flex items-center gap-2 text-xs text-foreground">
                    <span className="min-w-0 flex-1 truncate">
                      {(i18n.language === 'ar' && item.nameAr) || item.nameEn}
                      {' · '}
                      <span dir="ltr">{item.ref}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(key, item.docId)}
                      aria-label={t('basket.tray.remove')}
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>

              {/* Per-basket actions */}
              <div className="mt-2.5 flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void send(key, items)}
                >
                  {t('basket.tray.send')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => clear(key)}
                >
                  {t('basket.tray.clear')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
