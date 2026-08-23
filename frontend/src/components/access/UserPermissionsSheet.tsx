/**
 * UserPermissionsSheet — per-user granular permission matrix in a slide-in sheet.
 *
 * Opened from the Active-users three-dots menu (one fixed user, no picker).
 * Roles set the default capability bundles; the admin layers per-user grant/deny
 * overrides on top. Toggle each capability between Default (inherit the role
 * preset) / Grant / Deny. A sticky search box filters the matrix by raw id,
 * catalog label/description, or their localized equivalents; each domain header
 * carries a compact toggle that applies the chosen state to every capability in
 * the domain through a single bulk call. The backend resolves the effective set
 * and enforces it on every request — this is the management surface, not the
 * security boundary.
 *
 * Capabilities are grouped by domain (collapsible). Admin users always have every
 * capability (lockout protection), so the controls are disabled for them.
 *
 * Deferred: per-override expiry chip ("expires at …"). The backend auto-expires
 * temporary grants server-side, but GET /permissions does not yet return per-
 * override expiry timestamps, so we cannot display a chip here yet. Wire this up
 * once the backend adds `overrides_meta: Record<string, { expires_at: string }>`
 * to UserPermissionRead (separate backend task).
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronDown, Search, ShieldCheck, X } from 'lucide-react'

import {
  api,
  type AdminUserRead,
  type CapabilityRead,
  type PermissionEffect,
  type UserPermissionRead,
} from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

type Effect = PermissionEffect | 'default'

function userLabel(u: AdminUserRead): string {
  return (u.display_name || u.name_en || u.email.split('@')[0]) ?? u.email
}

function roleChipClass(role: 'operator' | 'manager' | 'admin'): string {
  return role === 'admin'
    ? 'bg-accent-soft text-accent'
    : role === 'manager'
      ? 'bg-info-soft text-info'
      : 'bg-surface-tinted text-muted-foreground'
}

/** Search matcher shared by the domain filter and the results counter so the
 * two can never drift apart (raw id, catalog label/description, localized
 * label/description). */
function capMatches(
  cap: CapabilityRead,
  query: string,
  t: ReturnType<typeof useTranslation>['t'],
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const localized = t(`access.permissions.caps.${cap.id}`, { defaultValue: '' }).toLowerCase()
  const localizedDesc = t(`perms.caps.${cap.id}.desc`, { defaultValue: '' }).toLowerCase()
  return (
    cap.id.toLowerCase().includes(q) ||
    cap.label.toLowerCase().includes(q) ||
    cap.description.toLowerCase().includes(q) ||
    localized.includes(q) ||
    localizedDesc.includes(q)
  )
}

/** Tri-state segmented control: Default / Grant / Deny. */
function EffectToggle({
  value,
  disabled,
  onChange,
  size = 'row',
  groupLabel,
}: {
  value: Effect
  disabled: boolean
  onChange: (next: Effect) => void
  size?: 'row' | 'header'
  groupLabel?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const options: { id: Effect; label: string; active: string }[] = [
    { id: 'default', label: t('access.permissions.state.default'), active: 'bg-surface-tinted text-foreground' },
    { id: 'grant', label: t('access.permissions.state.grant'), active: 'bg-success-soft text-success' },
    { id: 'deny', label: t('access.permissions.state.deny'), active: 'bg-accent-soft text-accent' },
  ]
  return (
    <div
      className="inline-flex shrink-0 overflow-hidden rounded-md border border-border"
      role="group"
      aria-label={groupLabel}
    >
      {options.map((opt) => {
        const selected = value === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(opt.id)}
            className={cn(
              size === 'header' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
              'font-medium transition-colors border-e border-border last:border-e-0',
              selected ? opt.active : 'bg-surface text-muted-foreground hover:bg-surface-tinted',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function DomainGroup({
  domain,
  caps,
  perms,
  isAdmin,
  onSet,
  onBulk,
  saving,
  query,
}: {
  domain: string
  caps: CapabilityRead[]
  perms: UserPermissionRead
  isAdmin: boolean
  onSet: (capability: string, effect: Effect) => void
  onBulk: (caps: CapabilityRead[], effect: Effect) => void
  saving: string | null
  query: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const roleDefaults = new Set(perms.role_defaults)

  const visible = useMemo(() => {
    if (!query.trim()) return caps
    return caps.filter((c) => capMatches(c, query, t))
  }, [caps, query, t])

  if (query.trim() && visible.length === 0) return <></>

  // Uniform header state only when every capability in the domain shares it.
  const effects = caps.map((c) => (perms.overrides[c.id] ?? 'default') as Effect)
  const uniform = effects.every((e) => e === effects[0]) ? effects[0] : null

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex flex-1 items-center justify-between gap-2 text-start"
            aria-expanded={open}
          >
            <CardTitle className="text-base">
              {t(`access.permissions.domains.${domain}`, domain)}
              <span className="ms-2 rounded border border-border px-1.5 font-mono text-[0.7em] text-muted-foreground">
                {visible.length}
              </span>
            </CardTitle>
            <ChevronDown
              className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')}
              strokeWidth={1.7}
            />
          </button>
          {!isAdmin && (
            <EffectToggle
              size="header"
              value={uniform ?? 'default'}
              disabled={saving === `domain:${domain}`}
              groupLabel={t('access.permissions.bulkApply')}
              onChange={(next) => onBulk(caps, next)}
            />
          )}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="divide-y divide-border/60 p-0">
          {visible.map((cap) => {
            const isDefault = roleDefaults.has(cap.id)
            const override = perms.overrides[cap.id]
            const value: Effect = override ?? 'default'
            const description = t(`perms.caps.${cap.id}.desc`, { defaultValue: cap.description })
            return (
              <div
                key={cap.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                {/* Label + description + chips */}
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-medium text-foreground">
                    {t(`access.permissions.caps.${cap.id}`, { defaultValue: cap.label })}
                  </span>
                  {description && (
                    <span className="text-xs leading-relaxed text-muted-foreground">
                      {description}
                    </span>
                  )}
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono text-[0.8em] text-muted-foreground/60" dir="ltr">{cap.id}</span>
                    <span
                      className={cn(
                        'inline-flex items-center rounded px-1.5 py-px text-[0.65em] font-semibold uppercase tracking-[0.06em]',
                        isDefault ? 'bg-success-soft text-success' : 'bg-surface-tinted text-muted-foreground',
                      )}
                    >
                      {t('access.permissions.inherited', {
                        state: isDefault
                          ? t('access.permissions.state.grant')
                          : t('access.permissions.state.deny'),
                      })}
                    </span>
                    {override && !isAdmin && (
                      <span className="inline-flex items-center rounded bg-warning-soft px-1.5 py-px text-[0.65em] font-semibold uppercase tracking-[0.06em] text-warning">
                        {t('access.permissions.overridden')}
                      </span>
                    )}
                  </span>
                </div>
                {/* Tri-state toggle — right-aligned on wider viewports */}
                <div className="shrink-0 sm:pt-0.5">
                  <EffectToggle
                    value={isAdmin ? 'grant' : value}
                    disabled={isAdmin || saving === cap.id}
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

export function UserPermissionsSheet({
  user,
  onClose,
}: {
  user: AdminUserRead
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')

  const capsQuery = useQuery({ queryKey: ['capabilities'], queryFn: () => api.listCapabilities() })
  const permsQuery = useQuery({
    queryKey: ['user-permissions', user.id],
    queryFn: () => api.getUserPermissions(user.id),
  })

  const [saving, setSaving] = useState<string | null>(null)
  const setMutation = useMutation({
    mutationFn: ({ capability, effect }: { capability: string; effect: PermissionEffect | null }) =>
      api.setUserPermission(user.id, capability, effect),
    onSuccess: (data) => {
      queryClient.setQueryData(['user-permissions', user.id], data)
      toast.success(t('access.permissions.saved'))
    },
    onError: () => toast.error(t('access.permissions.saveError')),
    onSettled: () => setSaving(null),
  })
  const bulkMutation = useMutation({
    mutationFn: ({ items }: { items: Array<{ capability: string; effect: PermissionEffect | null }> }) =>
      api.setUserPermissionsBulk(user.id, items),
    onSuccess: (data) => {
      queryClient.setQueryData(['user-permissions', user.id], data)
      toast.success(t('access.permissions.savedBulk'))
    },
    onError: () => toast.error(t('access.permissions.saveError')),
    onSettled: () => setSaving(null),
  })

  function handleSet(capability: string, effect: Effect): void {
    setSaving(capability)
    setMutation.mutate({ capability, effect: effect === 'default' ? null : effect })
  }

  function handleBulk(caps: CapabilityRead[], effect: Effect): void {
    setSaving(`domain:${caps[0]?.domain}`)
    bulkMutation.mutate({
      items: caps.map((c) => ({ capability: c.id, effect: effect === 'default' ? null : effect })),
    })
  }

  // Group capabilities by domain, preserving catalog order.
  const grouped = useMemo(() => {
    const caps = capsQuery.data ?? []
    const order: string[] = []
    const byDomain: Record<string, CapabilityRead[]> = {}
    for (const c of caps) {
      if (!byDomain[c.domain]) {
        byDomain[c.domain] = []
        order.push(c.domain)
      }
      byDomain[c.domain]!.push(c)
    }
    return order.map((d) => ({ domain: d, caps: byDomain[d]! }))
  }, [capsQuery.data])

  const perms = permsQuery.data
  const totalCaps = capsQuery.data?.length ?? 0
  const visibleCount = query.trim()
    ? grouped.reduce(
        (n, g) => n + g.caps.filter((c) => capMatches(c, query, t)).length,
        0,
      )
    : totalCaps

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent className="w-full max-w-2xl">
        <SheetTitle className="sr-only">
          {t('access.permissions.title')} — {userLabel(user)}
        </SheetTitle>

        {/* Header: user + role chip */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="min-w-0 space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t('access.permissions.sheetEyebrow')}
            </span>
            <p className="truncate text-base font-semibold text-foreground" dir="auto">
              {userLabel(user)}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('access.permissions.sheetSubtitle')}
            </p>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[0.7em] font-semibold uppercase tracking-[0.06em]',
                roleChipClass(user.role),
              )}
            >
              {t(`access.roleName.${user.role}`)}
            </span>
          </div>
          <SheetClose
            className="flex min-h-9 min-w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <ChevronDown className="h-5 w-5 -rotate-90 rtl:rotate-90" strokeWidth={1.8} aria-hidden />
          </SheetClose>
        </div>

        {/* Search — sticky under the header */}
        <div className="border-b border-border bg-background px-6 py-3">
          <div className="flex min-h-10 items-center gap-2.5 rounded-lg border border-border bg-surface px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('access.permissions.searchPlaceholder', { defaultValue: 'Search permissions…' })}
              aria-label={t('access.permissions.searchPlaceholder', { defaultValue: 'Search permissions…' })}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {query.trim() && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="flex items-center gap-1 rounded p-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                {t('access.permissions.clearSearch', { defaultValue: 'Clear' })}
              </button>
            )}
          </div>
          {query.trim() && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('access.permissions.results', { count: visibleCount, defaultValue: '{{count}} matching' })}
            </p>
          )}
        </div>

        {/* Scrollable matrix */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {capsQuery.isError ? (
            <EmptyState message={t('access.permissions.loadError')} />
          ) : (
            <>
              {perms?.is_admin && (
                <div className="flex items-center gap-2.5 rounded-lg border border-border bg-accent-soft/40 px-4 py-3 text-sm text-foreground">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
                  {t('access.permissions.adminAll')}
                </div>
              )}

              {permsQuery.isLoading || capsQuery.isLoading || !perms ? (
                <div className="space-y-4">
                  <Skeleton className="h-40 w-full" />
                  <Skeleton className="h-40 w-full" />
                </div>
              ) : query.trim() && visibleCount === 0 ? (
                <EmptyState
                  message={t('access.permissions.noResults', { defaultValue: 'No permissions match' })}
                  description={t('access.permissions.noResultsHint', {
                    defaultValue: 'Try a different term or clear the search.',
                  })}
                  actionLabel={t('access.permissions.clearSearch', { defaultValue: 'Clear' })}
                  onAction={() => setQuery('')}
                />
              ) : (
                grouped.map(({ domain, caps }) => (
                  <DomainGroup
                    key={domain}
                    domain={domain}
                    caps={caps}
                    perms={perms}
                    isAdmin={perms.is_admin}
                    onSet={handleSet}
                    onBulk={handleBulk}
                    saving={saving}
                    query={query}
                  />
                ))
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export default UserPermissionsSheet
