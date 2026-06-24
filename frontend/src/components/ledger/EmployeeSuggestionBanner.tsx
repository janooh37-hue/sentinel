/**
 * EmployeeSuggestionBanner — amber call-out shown above the body of a ledger
 * entry when exactly one G-number is detected in the HTML and the entry isn't
 * already linked to an employee.
 *
 * Click "Set as related" → PATCH the entry with `related_employee_id` and
 * invalidate the affected queries; parent re-renders, banner disappears.
 *
 * If the detected G-number doesn't resolve to a real employee (404) the banner
 * silently hides — false positives shouldn't shout at the operator.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { UserPlus } from 'lucide-react'
import { toast } from 'sonner'

import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { pickEmployeeName } from '@/lib/employeeName'

interface EmployeeSuggestionBannerProps {
  gnumber: string
  entryId: number
}

export function EmployeeSuggestionBanner({
  gnumber,
  entryId,
}: EmployeeSuggestionBannerProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()

  const employeeQuery = useQuery({
    queryKey: ['employee', gnumber],
    queryFn: () => api.getEmployee(gnumber),
    retry: false,
    staleTime: 60_000,
  })

  const linkMutation = useMutation({
    mutationFn: () =>
      api.updateLedgerEntry(entryId, { related_employee_id: gnumber }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ledger-entry', entryId] })
      void qc.invalidateQueries({ queryKey: ['ledger'] })
      toast.success(
        t('ledger.suggestEmployee.linked', {
          defaultValue: 'Linked to {{id}}',
          id: gnumber,
        }),
      )
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  // Silently hide while we don't know yet, or when the G-number isn't real.
  if (employeeQuery.isPending) return null
  if (employeeQuery.isError) return null
  const employee = employeeQuery.data
  if (!employee) return null

  const name = pickEmployeeName(employee, i18n.language)

  return (
    <div
      className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-warning"
      role="status"
    >
      <UserPlus className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="text-xs font-semibold uppercase tracking-[0.08em]">
          {t('ledger.suggestEmployee.title')}
        </div>
        <div className="text-sm" dir="auto">
          {t('ledger.suggestEmployee.body', {
            gnumber,
            name,
            defaultValue: 'Detected {{gnumber}} in this message. Link to {{name}}?',
          })}
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => linkMutation.mutate()}
        disabled={linkMutation.isPending}
        className="shrink-0"
      >
        {t('ledger.suggestEmployee.button')}
      </Button>
    </div>
  )
}
