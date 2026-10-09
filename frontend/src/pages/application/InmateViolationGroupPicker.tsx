/**
 * InmateViolationGroupPicker — chooses the WhatsApp group that receives each
 * approved Inmate Conduct Violations record (signed PDF + short caption).
 * One organization-wide target; "Off" disables the send. messages.broadcast-
 * gated by the caller, matching the groups list it reads.
 */

import { useId } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { MessageCircle } from 'lucide-react'

import { api, type GroupOut } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { useGatewayStatus } from '@/lib/useGatewayStatus'

const QUERY_KEY = ['inmate-violation-group'] as const

export function InmateViolationGroupPicker(): React.JSX.Element {
  const { t } = useTranslation()
  const selectId = useId()
  const hintId = useId()
  const qc = useQueryClient()
  const { data: gateway, isLoading: gatewayLoading } = useGatewayStatus()
  const connected = gateway?.state === 'connected'
  const current = useQuery({ queryKey: QUERY_KEY, queryFn: api.getInmateViolationGroup })
  const groups = useQuery({
    queryKey: ['announce-groups'],
    queryFn: api.listGroups,
    enabled: connected,
  })
  const save = useMutation({
    mutationFn: (groupId: string | null) => api.setInmateViolationGroup(groupId),
    onSuccess: (data) => {
      qc.setQueryData(QUERY_KEY, data)
      toast.success(
        data.group
          ? t('application.violationWhatsApp.saved', { name: bidi(data.group.name) })
          : t('application.violationWhatsApp.turnedOff'),
      )
    },
    onError: () => toast.error(t('application.violationWhatsApp.saveFailed')),
  })

  const selected = current.data?.group ?? null
  const options: GroupOut[] = [...(groups.data ?? [])]
  if (selected && !options.some((g) => g.id === selected.id)) options.unshift(selected)
  const notConnected = !gatewayLoading && !connected

  return (
    <section data-print-hide className="mb-4 rounded-2xl bg-surface px-4 py-4 sm:px-7">
      <label htmlFor={selectId} className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <MessageCircle className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} aria-hidden />
        {t('application.violationWhatsApp.label')}
      </label>
      <p
        id={hintId}
        role={!notConnected && groups.isError ? 'alert' : undefined}
        className="mt-1 text-[0.82em] text-muted-foreground"
      >
        {notConnected
          ? t('application.violationWhatsApp.notConnected')
          : groups.isError
            ? t('application.violationWhatsApp.groupsLoadError')
            : t('application.violationWhatsApp.hint')}
      </p>
      <select
        id={selectId}
        aria-describedby={hintId}
        className="mt-2 h-9 w-full max-w-md rounded-md border border-input bg-surface px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-60"
        value={selected?.id ?? ''}
        disabled={current.isLoading || save.isPending || (notConnected && !selected)}
        onChange={(e) => save.mutate(e.target.value || null)}
      >
        <option value="">{t('application.violationWhatsApp.off')}</option>
        {options.map((g) => (
          <option key={g.id} value={g.id} dir="auto">
            {g.name}
          </option>
        ))}
      </select>
    </section>
  )
}
