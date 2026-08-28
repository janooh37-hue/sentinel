import { useMemo, useState } from 'react'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Search, ShieldCheck, X } from 'lucide-react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import {
  api,
  type AdminUserRead,
  type CapabilityRead,
  type PermissionEffect,
  type UserPermissionRead,
} from '@/lib/api'
import { isQuickActionId } from '@/lib/dashboardLayout'
import { cn } from '@/lib/utils'

type Effect = PermissionEffect | 'default'

function capMatches(
  cap: CapabilityRead,
  query: string,
  t: TFunction,
): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  const localized = t(`access.permissions.caps.${cap.id}`, { defaultValue: '' }).toLowerCase()
  const localizedDescription = t(`perms.caps.${cap.id}.desc`, { defaultValue: '' }).toLowerCase()
  return (
    cap.id.toLowerCase().includes(normalized) ||
    cap.label.toLowerCase().includes(normalized) ||
    cap.description.toLowerCase().includes(normalized) ||
    localized.includes(normalized) ||
    localizedDescription.includes(normalized)
  )
}

function EffectToggle({
  value,
  disabled,
  onChange,
  compact = false,
  groupLabel,
}: {
  value: Effect
  disabled: boolean
  onChange: (next: Effect) => void
  compact?: boolean
  groupLabel: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const options: Array<{ id: Effect; label: string; active: string }> = [
    {
      id: 'default',
      label: t('access.permissions.state.default'),
      active: 'bg-surface-tinted text-foreground',
    },
    {
      id: 'grant',
      label: t('access.permissions.state.grant'),
      active: 'bg-success-soft text-success',
    },
    {
      id: 'deny',
      label: t('access.permissions.state.deny'),
      active: 'bg-accent-soft text-accent',
    },
  ]
  return (
    <div
      className="inline-flex shrink-0 overflow-hidden rounded-md border border-border"
      role="group"
      aria-busy={disabled}
      aria-label={groupLabel}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-disabled={disabled}
          aria-pressed={value === option.id}
          onMouseDown={(event) => {
            if (disabled) event.preventDefault()
          }}
          onClick={() => {
            if (!disabled) onChange(option.id)
          }}
          className={cn(
            compact ? 'min-h-9 px-2.5 text-[0.72em] max-sm:min-h-11' : 'min-h-10 px-3 text-xs max-sm:min-h-11',
            'border-e border-border font-medium transition-colors last:border-e-0',
            value === option.id
              ? option.active
              : 'bg-surface text-muted-foreground hover:bg-surface-tinted',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function DomainGroup({
  domain,
  caps,
  perms,
  onSet,
  onBulk,
  saving,
  writePending,
  query,
}: {
  domain: string
  caps: CapabilityRead[]
  perms: UserPermissionRead
  onSet: (capability: string, effect: Effect) => void
  onBulk: (caps: CapabilityRead[], effect: Effect) => void
  saving: string | null
  writePending: boolean
  query: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const domainLabel =
    domain === 'services'
      ? t('access.permissions.mirror.blueprintServices')
      : t(`access.permissions.domains.${domain}`, domain)
  const [open, setOpen] = useState(true)
  const roleDefaults = new Set(perms.role_defaults)
  const visible = useMemo(
    () => (query.trim() ? caps.filter((cap) => capMatches(cap, query, t)) : caps),
    [caps, query, t],
  )

  if (query.trim() && visible.length === 0) return <></>

  const effects = caps.map((cap) => (perms.overrides[cap.id] ?? 'default') as Effect)
  const uniform = effects.every((effect) => effect === effects[0]) ? effects[0] : null

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="flex min-h-11 flex-1 items-center justify-between gap-2 text-start focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={open}
          >
            <CardTitle className="text-base">
              {domainLabel}
              <span className="ms-2 rounded border border-border px-1.5 font-mono text-[0.7em] text-muted-foreground">
                {visible.length}
              </span>
            </CardTitle>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform motion-reduce:transition-none',
                open && 'rotate-180',
              )}
              strokeWidth={1.7}
              aria-hidden
            />
          </button>
          <EffectToggle
            compact
            value={uniform ?? 'default'}
            disabled={writePending || saving === `domain:${domain}`}
            groupLabel={`${t('access.permissions.bulkApply')} ${domainLabel}`}
            onChange={(next) => onBulk(caps, next)}
          />
        </div>
      </CardHeader>
      {open && (
        <CardContent className="divide-y divide-border/60 p-0">
          {visible.map((cap) => {
            const roleDefault = roleDefaults.has(cap.id)
            const override = perms.overrides[cap.id]
            const value: Effect = override ?? 'default'
            const label = t(`access.permissions.caps.${cap.id}`, { defaultValue: cap.label })
            const description = t(`perms.caps.${cap.id}.desc`, {
              defaultValue: cap.description,
            })
            return (
              <div
                key={cap.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-medium text-foreground">{label}</span>
                  {description ? (
                    <span className="text-xs leading-relaxed text-muted-foreground">
                      {description}
                    </span>
                  ) : null}
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <bdi className="font-mono text-[0.8em] text-muted-foreground/60" dir="ltr">
                      {cap.id}
                    </bdi>
                    <span
                      className={cn(
                        'inline-flex items-center rounded px-1.5 py-px text-[0.65em] font-semibold uppercase tracking-[0.06em]',
                        roleDefault
                          ? 'bg-success-soft text-success'
                          : 'bg-surface-tinted text-muted-foreground',
                      )}
                    >
                      {t('access.permissions.inherited', {
                        state: roleDefault
                          ? t('access.permissions.state.grant')
                          : t('access.permissions.state.deny'),
                      })}
                    </span>
                    {override ? (
                      <span className="inline-flex items-center rounded bg-warning-soft px-1.5 py-px text-[0.65em] font-semibold uppercase tracking-[0.06em] text-warning">
                        {t('access.permissions.overridden')}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="shrink-0 sm:pt-0.5">
                  <EffectToggle
                    value={value}
                    disabled={writePending || saving === cap.id}
                    groupLabel={label}
                    onChange={(next) => onSet(cap.id, next)}
                  />
                </div>
              </div>
            )
          })}
        </CardContent>
      )}
    </Card>
  )
}

export function AdvancedPermissionsDrawer({
  user,
  perms,
  capabilities,
}: {
  user: AdminUserRead
  perms: UserPermissionRead
  capabilities: CapabilityRead[]
}): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const permissionWritesPending =
    useIsMutating({ mutationKey: ['user-permission-write', user.id] }) > 0

  const catalog = useMemo(
    () =>
      capabilities.filter((capability) => {
        if (capability.id.startsWith('books.category.')) return false
        if (!capability.id.startsWith('books.service.')) return true
        const serviceId = capability.id.slice('books.service.'.length)
        return serviceId !== 'other' && !isQuickActionId(serviceId)
      }),
    [capabilities],
  )
  const grouped = useMemo(() => {
    const order: string[] = []
    const byDomain: Record<string, CapabilityRead[]> = {}
    for (const cap of catalog) {
      if (!byDomain[cap.domain]) {
        byDomain[cap.domain] = []
        order.push(cap.domain)
      }
      byDomain[cap.domain]!.push(cap)
    }
    return order.map((domain) => ({ domain, caps: byDomain[domain]! }))
  }, [catalog])

  const visibleCount = query.trim()
    ? catalog.filter((cap) => capMatches(cap, query, t)).length
    : catalog.length

  const setMutation = useMutation({
    mutationKey: ['user-permission-write', user.id],
    scope: { id: `user-permission-write:${user.id}` },
    mutationFn: ({ capability, effect }: { capability: string; effect: PermissionEffect | null }) =>
      api.setUserPermission(user.id, capability, effect),
    onSuccess: (data) => {
      queryClient.setQueryData(['user-permissions', user.id], data)
    },
    onError: () => toast.error(t('access.permissions.saveError')),
    onSettled: () => setSaving(null),
  })
  const bulkMutation = useMutation({
    mutationKey: ['user-permission-write', user.id],
    scope: { id: `user-permission-write:${user.id}` },
    mutationFn: ({ items }: { items: Array<{ capability: string; effect: PermissionEffect | null }> }) =>
      api.setUserPermissionsBulk(user.id, items),
    onSuccess: (data) => {
      queryClient.setQueryData(['user-permissions', user.id], data)
    },
    onError: () => toast.error(t('access.permissions.saveError')),
    onSettled: () => setSaving(null),
  })

  const handleSet = (capability: string, effect: Effect): void => {
    setSaving(capability)
    setMutation.mutate({ capability, effect: effect === 'default' ? null : effect })
  }
  const handleBulk = (caps: CapabilityRead[], effect: Effect): void => {
    setSaving(`domain:${caps[0]?.domain ?? ''}`)
    bulkMutation.mutate({
      items: caps.map((cap) => ({
        capability: cap.id,
        effect: effect === 'default' ? null : effect,
      })),
    })
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-hairline bg-surface">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="advanced-permissions-body"
        className="flex min-h-14 w-full items-center gap-3 px-5 py-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ShieldCheck className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.7} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-foreground">
            {t('access.permissions.mirror.advanced')}
          </span>
          <span className="block text-[0.78em] text-muted-foreground">
            {t('access.permissions.mirror.advancedCaption')}
          </span>
        </span>
        <span className="rounded-full bg-primary-soft px-2.5 py-1 font-mono text-[0.72em] font-semibold text-primary">
          {catalog.length}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          strokeWidth={1.8}
          aria-hidden
        />
      </button>

      {open ? (
        <div id="advanced-permissions-body" className="border-t border-hairline">
          <div className="sticky top-0 z-10 border-b border-border bg-background px-5 py-3">
            <div className="flex min-h-11 items-center gap-2.5 rounded-lg border border-border bg-surface px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('access.permissions.searchPlaceholder')}
                aria-label={t('access.permissions.searchPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {query.trim() ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="flex min-h-9 items-center gap-1 rounded px-2 text-xs font-medium text-muted-foreground hover:text-foreground max-sm:min-h-11"
                  aria-label={t('access.permissions.clearSearch')}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  {t('access.permissions.clearSearch')}
                </button>
              ) : null}
            </div>
            {query.trim() ? (
              <p role="status" className="mt-2 text-xs text-muted-foreground">
                {t('access.permissions.results', { count: visibleCount })}
              </p>
            ) : null}
          </div>

          <div className="space-y-4 p-5">

            {query.trim() && visibleCount === 0 ? (
              <EmptyState
                message={t('access.permissions.noResults')}
                description={t('access.permissions.noResultsHint')}
                actionLabel={t('access.permissions.clearSearch')}
                onAction={() => setQuery('')}
              />
            ) : (
              grouped.map(({ domain, caps }) => (
                <DomainGroup
                  key={domain}
                  domain={domain}
                  caps={caps}
                  perms={perms}
                  onSet={handleSet}
                  onBulk={handleBulk}
                  saving={saving}
                  writePending={permissionWritesPending}
                  query={query}
                />
              ))
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
