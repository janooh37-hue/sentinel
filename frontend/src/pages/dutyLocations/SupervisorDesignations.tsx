/**
 * SupervisorDesignations — per-unit editor for the duty-supervisor notification
 * designations.  Lists the posts designated to receive WhatsApp/SMS alerts for
 * a given duty unit, with Add (combobox-backed) and Remove controls.
 *
 * Props:
 *  - unit: the active duty unit key (Arabic name).  Must not be UNASSIGNED.
 *  - posts: candidate post strings for the <datalist> (from postsForUnit).
 *
 * Reads from / writes to the /duty-supervisors/ API (Task 3, Phase 2a).
 * Bilingual (AR/EN) via useTranslation(); logical CSS; dir="auto" on Arabic text.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage, type DutySupervisorRead } from '@/lib/api'

interface Props {
  /** Active duty unit (Arabic name). */
  unit: string
  /** Candidate post strings for the add-row datalist. */
  posts: string[]
}

const DATALIST_ID = 'supervisor-posts-datalist'

export function SupervisorDesignations({ unit, posts }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const [designation, setDesignation] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  const { data: allDesignations, isLoading } = useQuery({
    queryKey: ['duty-supervisors'],
    queryFn: () => api.listDutySupervisors(),
  })

  // Filter server-side list to this unit only
  const unitDesignations: DutySupervisorRead[] = (allDesignations ?? []).filter(
    (d) => d.duty_unit === unit,
  )

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['duty-supervisors'] })

  const addMut = useMutation({
    mutationFn: () =>
      api.addDutySupervisor({ duty_unit: unit, recipient_duty_post: designation.trim() }),
    onSuccess: () => {
      setDesignation('')
      setAddError(null)
      invalidate()
    },
    onError: (e: unknown) => {
      setAddError(apiErrorMessage(e))
      toast.error(t('dutySupervisors.addError'))
    },
  })

  const removeMut = useMutation({
    mutationFn: (id: number) => api.deleteDutySupervisor(id),
    onSuccess: invalidate,
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  })

  function handleAdd(): void {
    const trimmed = designation.trim()
    if (!trimmed) return
    addMut.mutate()
  }

  return (
    <div className="border-t border-hairline px-4 py-4 sm:px-5">
      {/* Section header */}
      <div className="mb-3">
        <p className="text-[0.9em] font-semibold text-foreground">
          {t('dutySupervisors.title')}
        </p>
        <p className="text-[0.78em] text-muted-foreground">
          {t('dutySupervisors.subtitle')}
        </p>
      </div>

      {/* Designation list */}
      {isLoading ? null : unitDesignations.length === 0 ? (
        <p className="mb-3 text-[0.82em] text-muted-foreground">
          {t('dutySupervisors.empty')}
        </p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {unitDesignations.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface/60 px-3 py-1.5"
            >
              <span
                className="flex-1 text-[0.85em] text-foreground"
                dir="auto"
              >
                {d.recipient_duty_post}
              </span>
              <button
                type="button"
                onClick={() => removeMut.mutate(d.id)}
                disabled={removeMut.isPending}
                className="rounded px-2 py-0.5 text-[0.78em] font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30 disabled:opacity-50"
              >
                {t('dutySupervisors.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add row */}
      <datalist id={DATALIST_ID}>
        {posts.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <div className="flex gap-2">
        <input
          type="text"
          list={DATALIST_ID}
          value={designation}
          onChange={(e) => setDesignation(e.target.value)}
          placeholder={t('dutySupervisors.designation')}
          aria-label={t('dutySupervisors.designation')}
          dir="auto"
          className="h-8 flex-1 rounded-md border border-border bg-surface px-3 text-[0.85em] text-foreground placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={addMut.isPending || !designation.trim()}
          className="h-8 rounded-md bg-primary px-3 text-[0.82em] font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50"
        >
          {t('dutySupervisors.add')}
        </button>
      </div>
      {addError && (
        <p className="mt-1.5 text-[0.78em] text-destructive" dir="auto">
          {addError}
        </p>
      )}
    </div>
  )
}
