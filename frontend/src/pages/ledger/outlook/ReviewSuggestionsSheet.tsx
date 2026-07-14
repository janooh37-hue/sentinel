/**
 * ReviewSuggestionsSheet — the "Review suggestions" sheet (Phase 3, E4).
 *
 * Mirrors the prototype's `.review` panel: a list of suggested clusters, each
 * with a ✨ tile, name guess, "N emails · M correspondents" meta, "same subject"
 * + cluster chips, and a Create… / Dismiss pair. Create hands the cluster up to
 * the shell's create dialog; Dismiss removes the cluster (per-user, won't return).
 *
 * Built on the shared Sheet (portals to body; slides from the inline-start edge,
 * respecting the app direction). The leaf text is `dir="auto"`.
 */

import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api, ApiError, type SmartFolderSuggestion } from '@/lib/api'
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

interface ReviewSuggestionsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Confirm a cluster — opens the shell's create dialog. */
  onCreate: (suggestion: SmartFolderSuggestion) => void
}

export function ReviewSuggestionsSheet({
  open,
  onOpenChange,
  onCreate,
}: ReviewSuggestionsSheetProps): React.JSX.Element {
  const { t } = useTranslation()

  const suggestions = useQuery({
    queryKey: ['ledger-smart-suggestions'],
    queryFn: () => api.getSmartFolderSuggestions(),
    enabled: open,
  })
  const list = suggestions.data ?? []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[380px] max-w-[92vw] p-0">
        <div className="flex h-full min-h-0 flex-col">
          <SheetTitle className="flex-none border-b border-border px-4 py-3.5 text-sm font-bold text-foreground">
            {t('ledger.smart.reviewHeading', { count: list.length })}
          </SheetTitle>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.length === 0 && (
              <p className="px-5 py-10 text-center text-[0.82em] text-faint">
                {t('ledger.smart.reviewEmpty')}
              </p>
            )}
            {list.map((s) => (
              <SuggestionRow key={s.cluster_key} suggestion={s} onCreate={onCreate} />
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

interface SuggestionRowProps {
  suggestion: SmartFolderSuggestion
  onCreate: (suggestion: SmartFolderSuggestion) => void
}

function SuggestionRow({ suggestion, onCreate }: SuggestionRowProps): React.JSX.Element {
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
    <div className="flex flex-col gap-2 border-b border-hairline px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <span
          className="grid h-6 w-6 flex-none place-items-center rounded-md bg-smart-soft text-smart"
          aria-hidden
        >
          ✨
        </span>
        <div className="min-w-0">
          <div className="truncate text-[0.86em] font-semibold text-foreground" dir="auto">
            {suggestion.name_suggestion}
          </div>
          <div className="text-[0.74em] text-muted-foreground" dir="auto">
            {t('ledger.smart.rowMeta', {
              count: suggestion.correspondent_count,
              emails: suggestion.count,
              correspondents: suggestion.correspondent_count,
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-full bg-surface-tinted px-2 py-0.5 text-[0.7em] text-muted-foreground">
          {t('ledger.smart.chipSameSubject')}
        </span>
        <span
          className="max-w-[180px] truncate rounded-full bg-surface-tinted px-2 py-0.5 text-[0.7em] text-muted-foreground"
          dir="auto"
          title={suggestion.cluster_key}
        >
          {suggestion.cluster_key || t('ledger.smart.noSubject')}
        </span>
      </div>

      <div className="flex gap-1.5">
        <Button size="sm" onClick={() => onCreate(suggestion)}>
          {t('ledger.smart.createDots')}
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
