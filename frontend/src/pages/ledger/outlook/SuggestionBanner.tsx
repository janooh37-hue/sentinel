/**
 * SuggestionBanner — a calm prompt over the message list (Phase 3, E4).
 *
 * Mirrors the prototype's `.sbanner`: a quiet indigo-edged card (NOT a loud
 * gradient) surfacing the top suggested cluster — "N emails look related" with
 * a Review / Dismiss pair. Review opens the suggestions sheet; Dismiss calls the
 * dismiss endpoint (that cluster won't reappear, per-user).
 *
 * Shown only when there's at least one suggestion AND the user is on a normal
 * folder view (not already inside a smart folder). Ledger CHROME — lives inside
 * `[data-ledger-chrome] dir="ltr"`, never mirrors in Arabic.
 */

import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api, ApiError, type SmartFolderSuggestion } from '@/lib/api'
import { Button } from '@/components/ui/button'

interface SuggestionBannerProps {
  /** The top suggestion to surface (the highest-count cluster). */
  suggestion: SmartFolderSuggestion
  /** Total pending suggestions (drives the "Review (N)" affordance). */
  total: number
  /** Open the review sheet. */
  onReview: () => void
}

export function SuggestionBanner({
  suggestion,
  total,
  onReview,
}: SuggestionBannerProps): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const dismissMut = useMutation({
    mutationFn: () => api.dismissSmartFolderSuggestion(suggestion.cluster_key),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ledger-smart-suggestions'] })
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  return (
    <div
      role="status"
      className="m-2.5 flex items-center gap-3 rounded-lg border border-hairline border-s-[3px] border-s-smart bg-surface px-3.5 py-2.5"
    >
      <span
        className="grid h-7 w-7 flex-none place-items-center rounded-md bg-smart-soft text-smart"
        aria-hidden
      >
        ✨
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.84em] font-semibold text-foreground" dir="auto">
          {t('ledger.smart.bannerTitle', { count: suggestion.count })}
        </div>
        <div className="truncate text-[0.76em] text-muted-foreground" dir="auto">
          {t('ledger.smart.bannerSub', { name: suggestion.name_suggestion })}
        </div>
      </div>
      <div className="flex flex-none items-center gap-1.5">
        <Button size="sm" onClick={onReview}>
          {total > 1
            ? t('ledger.smart.reviewN', { count: total })
            : t('ledger.smart.review')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => dismissMut.mutate()}
          disabled={dismissMut.isPending}
        >
          {t('ledger.smart.dismiss')}
        </Button>
      </div>
    </div>
  )
}
