/**
 * AccessRequestsPage — admin-only review of account requests + user management.
 *
 * Implements the Claude Design "Access Requests" handoff in the production TAMM
 * vocabulary. Four tabs:
 *   - Pending   → expandable request cards with a role picker + Approve / Reject
 *   - Active    → users table with per-row Reset password / Change role / Suspend
 *   - Suspended → locked/disabled users with Reactivate
 *   - History   → audit log of approve/reject/role/reset/lock/unlock events
 *
 * Data: GET /auth/users (admin) + GET /auth/audit (admin). All mutations go
 * through the existing /auth/users/{id}/* endpoints and re-invalidate both
 * queries so the tabs, counts, and history stay in sync.
 *
 * Gated to admins by App.tsx's route wrapper; this component also renders a
 * not-authorized notice as a defensive fallback.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlertTriangle,
  BadgeCheck,
  BadgeMinus,
  Check,
  ChevronDown,
  Clock,
  Inbox,
  KeyRound,
  Lock,
  Mail,
  MoreVertical,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  Unlock,
  X,
} from 'lucide-react'

import { api, ApiError, type AdminUserRead, type AuditEntryRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { PermissionRequestsTab } from '@/components/access/PermissionRequestsTab'
import { UserPermissionsSheet } from '@/components/access/UserPermissionsSheet'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'

type Role = 'admin' | 'manager' | 'operator'
type TabId = 'pending' | 'active' | 'suspended' | 'history' | 'permission-requests'

const ROLE_ORDER: Role[] = ['admin', 'manager', 'operator']

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function initialsOf(name: string | null | undefined, fallback: string): string {
  const source = (name ?? '').trim() || fallback
  const parts = source.split(/[\s._@-]+/).filter(Boolean)
  if (parts.length === 0) return source[0]?.toUpperCase() ?? '·'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function displayName(u: AdminUserRead): string {
  return (u.display_name || u.name_en || u.email.split('@')[0]) ?? u.email
}

// The API serializes naive UTC datetimes (no tz suffix); JS would read those as
// local time. Treat a tz-less stamp as UTC so relative times don't drift by the
// server's offset.
function parseTs(iso: string): number {
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)
  return new Date(hasTz ? iso : `${iso}Z`).getTime()
}

function relativeTime(iso: string | null, locale: string): string {
  if (!iso) return ''
  const then = parseTs(iso)
  if (Number.isNaN(then)) return ''
  const diffMs = then - Date.now()
  const abs = Math.abs(diffMs)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const min = 60_000
  const hr = 60 * min
  const day = 24 * hr
  if (abs < min) return rtf.format(0, 'minute')
  if (abs < hr) return rtf.format(Math.round(diffMs / min), 'minute')
  if (abs < day) return rtf.format(Math.round(diffMs / hr), 'hour')
  if (abs < 30 * day) return rtf.format(Math.round(diffMs / day), 'day')
  return new Date(then).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
}

function shortDate(iso: string | null, locale: string): string {
  if (!iso) return ''
  const t = parseTs(iso)
  if (Number.isNaN(t)) return ''
  return new Date(t).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
}

function isNew(iso: string | null): boolean {
  if (!iso) return false
  return Date.now() - parseTs(iso) < 48 * 60 * 60 * 1000
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function UserAvatar({ u, size = 'md' }: { u: AdminUserRead; size?: 'sm' | 'md' }): React.JSX.Element {
  const cls = size === 'sm' ? 'h-8 w-8 text-[0.72em]' : 'h-11 w-11 text-[0.82em]'
  return (
    <Avatar className={`${cls} shrink-0 bg-primary-soft text-primary`}>
      <AvatarFallback className="font-semibold">
        {initialsOf(displayName(u), u.email)}
      </AvatarFallback>
    </Avatar>
  )
}

function RolePill({ role, status }: { role: Role; status: AdminUserRead['status'] }): React.JSX.Element {
  const { t } = useTranslation()
  if (status === 'locked' || status === 'disabled') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 text-[0.72em] font-medium text-accent">
        <Lock className="h-3 w-3" strokeWidth={2} /> {t('access.tabs.suspended')}
      </span>
    )
  }
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-info-soft px-2.5 py-0.5 text-[0.72em] font-medium text-info">
        <ShieldCheck className="h-3 w-3" strokeWidth={2} /> {t('access.roleName.admin')}
      </span>
    )
  }
  if (role === 'manager') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-0.5 text-[0.72em] font-medium text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" /> {t('access.roleName.manager')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-tinted px-2.5 py-0.5 text-[0.72em] font-medium text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-border-strong" /> {t('access.roleName.operator')}
    </span>
  )
}

function RolePicker({
  value,
  onChange,
}: {
  value: Role
  onChange: (r: Role) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
      {ROLE_ORDER.map((r) => {
        const active = value === r
        return (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(r)}
            className={`flex flex-col gap-1 rounded-xl border p-3 text-start transition-colors ${
              active
                ? 'border-primary bg-primary-soft/60 ring-1 ring-inset ring-primary'
                : 'border-border bg-surface hover:bg-surface-tinted'
            }`}
          >
            <span className="flex items-center gap-2">
              <span
                className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border-[1.5px] ${
                  active ? 'border-primary' : 'border-border-strong'
                }`}
              >
                {active && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
              </span>
              <span className="text-[0.9em] font-semibold text-foreground">
                {t(`access.pending.roles.${r}`)}
              </span>
            </span>
            <span className="ps-[22px] text-[0.75em] leading-snug text-muted-foreground">
              {t(`access.pending.roles.${r}Hint`)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Lightweight hand-rolled modal (backdrop + panel), matching the design.
 *  Adds Escape-to-close, a focus trap, and focus return to the trigger. */
function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
}): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const lastFocusedRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    lastFocusedRef.current = document.activeElement as HTMLElement | null
    // Initial focus: first focusable element, else the panel itself.
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    )
    ;(first ?? panel)?.focus()

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null)
      if (focusable.length === 0) return
      const firstEl = focusable[0]!
      const lastEl = focusable[focusable.length - 1]!
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      lastFocusedRef.current?.focus?.()
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(13,20,35,0.45)] p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[460px] flex-col gap-3 rounded-2xl bg-surface p-6 shadow-2xl focus:outline-none"
      >
        <h2 className="text-[1.05em] font-semibold text-foreground">{title}</h2>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pending request card
// ---------------------------------------------------------------------------

function RequestCard({
  req,
  approving,
  onApprove,
  onReject,
}: {
  req: AdminUserRead
  approving: boolean
  onApprove: (role: Role) => void
  onReject: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<Role>('operator')

  return (
    <div
      className={`rounded-2xl border p-4 transition-colors sm:p-5 ${
        approving
          ? 'border-success/40 bg-success-soft/40'
          : open
            ? 'border-border bg-surface shadow-sm'
            : 'border-hairline bg-surface hover:border-border'
      }`}
    >
      {/*
        Responsive header row.
        Desktop (md+):  [avatar] [info····] [reject] [approve] [chevron]  — single row
        Mobile (<md):   [avatar] [info····] [chevron]                     — top row
                        [reject (50%)] [approve (50%)]                    — bottom row
        Both rows share the same handlers/state; the mobile CTA row uses
        CSS wrapping not duplicate buttons so the a11y tree stays clean.
        Strategy: wrap everything in a `flex-wrap` container, then on mobile
        force the action buttons to their own line via `basis-full`.
      */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <UserAvatar u={req} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[0.95em] font-semibold text-foreground" dir="auto">
              {displayName(req)}
            </span>
            {isNew(req.created_at) && (
              <span className="rounded-full bg-accent px-1.5 py-px text-[0.6em] font-bold uppercase tracking-wider text-white">
                {t('access.pending.newBadge')}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.82em] text-muted-foreground">
            <span className="truncate font-mono">{req.email}</span>
            {req.employee_id && (
              <>
                <span className="text-border-strong">·</span>
                <span
                  title={t('access.pending.unverifiedLink', {
                    defaultValue: 'Self-claimed — verify before approving',
                  })}
                  className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 font-mono font-semibold text-accent"
                >
                  <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                  {req.employee_id}
                </span>
              </>
            )}
            <span className="text-border-strong">·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" strokeWidth={1.8} />
              {t('access.pending.requested')} {relativeTime(req.created_at, locale)}
            </span>
          </div>
        </div>
        {/* Expand chevron — always present, shown beside info on both layouts */}
        <button
          type="button"
          aria-label={open ? t('access.pending.collapse') : t('access.pending.expand')}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground md:hidden"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
            strokeWidth={1.8}
          />
        </button>
        {/*
          Action buttons wrapper.
          - On desktop (md+): inline with the avatar/info row (no basis-full).
          - On mobile (<md): forced to its own line (basis-full) and rendered
            as a 2-col grid so Reject and Approve each take exactly 50 %.
        */}
        <div className="flex basis-full items-center gap-1.5 md:basis-auto">
          <button
            type="button"
            disabled={approving}
            onClick={onReject}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1.5 text-[0.82em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground disabled:opacity-50 md:flex-none"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} /> {t('access.pending.reject')}
          </button>
          <button
            type="button"
            disabled={approving}
            onClick={() => (open ? onApprove(role) : setOpen(true))}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-[0.82em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60 md:flex-none"
          >
            {approving ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                {t('access.pending.approving')}
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" strokeWidth={2} />
                {open ? t('access.pending.approve') : `${t('access.pending.approve')}…`}
              </>
            )}
          </button>
          {/* Desktop-only chevron (inline with action row) */}
          <button
            type="button"
            aria-label={open ? t('access.pending.collapse') : t('access.pending.expand')}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground md:flex"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
              strokeWidth={1.8}
            />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 flex flex-col gap-4 border-t border-dashed border-hairline pt-4">
          <dl className="grid gap-3 sm:grid-cols-3">
            <DetailKV icon={<Clock className="h-3.5 w-3.5" strokeWidth={1.8} />} label={t('access.pending.requested')}>
              {shortDate(req.created_at, locale) || '—'}
            </DetailKV>
            <DetailKV icon={<Mail className="h-3.5 w-3.5" strokeWidth={1.8} />} label={t('access.pending.email')}>
              <span className="break-all font-mono text-[0.92em]">{req.email}</span>
            </DetailKV>
            <DetailKV icon={<ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.8} />} label={t('access.pending.linked')}>
              {req.employee_id ? (
                <span className="flex flex-col gap-1">
                  <span>
                    {req.name_en ?? '—'}{' '}
                    <span className="font-mono text-muted-foreground">({req.employee_id})</span>
                  </span>
                  <span className="inline-flex w-fit items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[0.66em] font-semibold uppercase tracking-wider text-accent">
                    <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                    {t('access.pending.unverifiedLink', {
                      defaultValue: 'Self-claimed — verify before approving',
                    })}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">{t('access.pending.notLinked')}</span>
              )}
            </DetailKV>
          </dl>

          <div className="flex flex-col gap-2">
            <span className="text-[0.78em] text-muted-foreground">{t('access.pending.rolePrompt')}</span>
            <RolePicker value={role} onChange={setRole} />
          </div>
        </div>
      )}
    </div>
  )
}

function DetailKV({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-tinted text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-[0.65em] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </dt>
        <dd className="mt-0.5 text-[0.86em] text-foreground">{children}</dd>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Active / Suspended users table
// ---------------------------------------------------------------------------

function UsersTable({
  users,
  emptyMessage,
  currentUserId,
  onReset,
  onChangeRole,
  onEditPermissions,
  onSetDefaultManager,
  onLock,
  onUnlock,
}: {
  users: AdminUserRead[]
  emptyMessage: string
  currentUserId: number | undefined
  onReset: (u: AdminUserRead) => void
  onChangeRole: (u: AdminUserRead) => void
  onEditPermissions: (u: AdminUserRead) => void
  onSetDefaultManager: (u: AdminUserRead, enabled: boolean) => void
  onLock: (u: AdminUserRead) => void
  onUnlock: (u: AdminUserRead) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language

  if (users.length === 0) {
    return <EmptyState icon={Inbox} message={emptyMessage} className="py-12" />
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-hairline bg-surface">
      <table className="w-full border-collapse text-start">
        <thead>
          <tr className="border-b border-hairline text-[0.7em] uppercase tracking-[0.08em] text-muted-foreground">
            <th scope="col" className="w-14 py-2.5" />
            <th scope="col" className="px-2 py-2.5 text-start font-semibold">{t('access.active.name')}</th>
            <th scope="col" className="px-2 py-2.5 text-start font-semibold">{t('access.active.role')}</th>
            <th scope="col" className="hidden px-2 py-2.5 text-start font-semibold md:table-cell">
              {t('access.active.lastSeen')}
            </th>
            <th scope="col" className="hidden px-2 py-2.5 text-start font-semibold lg:table-cell">
              {t('access.active.joined')}
            </th>
            <th scope="col" className="w-12 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const locked = u.status === 'locked' || u.status === 'disabled'
            const isSelf = currentUserId != null && u.id === currentUserId
            return (
              <tr
                key={u.id}
                className={`border-b border-hairline/70 last:border-0 ${locked ? 'opacity-60' : ''}`}
              >
                <td className="ps-3.5">
                  <UserAvatar u={u} size="sm" />
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex flex-col">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[0.9em] text-foreground" dir="auto">
                        {displayName(u)}
                      </span>
                      {isSelf && (
                        <span className="rounded-full bg-primary-soft px-1.5 py-px text-[0.6em] font-bold uppercase tracking-wider text-primary">
                          {t('access.active.you')}
                        </span>
                      )}
                    </span>
                    <span className="text-[0.76em] text-muted-foreground">
                      {u.employee_id && <span className="font-mono">{u.employee_id} · </span>}
                      <span className="font-mono">{u.email}</span>
                    </span>
                  </div>
                </td>
                <td className="px-2 py-2.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <RolePill role={u.role} status={u.status} />
                    {u.is_default_manager && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-0.5 text-[0.72em] font-medium text-primary">
                        <BadgeCheck className="h-3 w-3" strokeWidth={2} />
                        {t('access.defaultManager.badge')}
                      </span>
                    )}
                  </span>
                </td>
                <td className="hidden px-2 py-2.5 font-mono text-[0.8em] text-muted-foreground md:table-cell">
                  {u.last_login_at ? relativeTime(u.last_login_at, locale) : t('access.active.never')}
                </td>
                <td className="hidden px-2 py-2.5 font-mono text-[0.8em] text-muted-foreground lg:table-cell">
                  {shortDate(u.created_at, locale)}
                </td>
                <td className="pe-2 text-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={t('access.active.rowActions')}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-surface-tinted data-[state=open]:text-foreground"
                    >
                      <MoreVertical className="h-4 w-4" strokeWidth={1.8} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => onReset(u)}>
                        <KeyRound className="h-3.5 w-3.5" strokeWidth={1.8} />
                        {t('access.active.reset')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onChangeRole(u)}>
                        <UserCog className="h-3.5 w-3.5" strokeWidth={1.8} />
                        {t('access.active.changeRole')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onEditPermissions(u)}>
                        <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />
                        {t('access.active.editPermissions')}
                      </DropdownMenuItem>
                      {u.is_default_manager ? (
                        <DropdownMenuItem onSelect={() => onSetDefaultManager(u, false)}>
                          <BadgeMinus className="h-3.5 w-3.5" strokeWidth={1.8} />
                          {t('access.defaultManager.remove')}
                        </DropdownMenuItem>
                      ) : !locked ? (
                        <DropdownMenuItem onSelect={() => onSetDefaultManager(u, true)}>
                          <BadgeCheck className="h-3.5 w-3.5" strokeWidth={1.8} />
                          {t('access.defaultManager.make')}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuSeparator />
                      {locked ? (
                        <DropdownMenuItem onSelect={() => onUnlock(u)}>
                          <Unlock className="h-3.5 w-3.5" strokeWidth={1.8} />
                          {t('access.active.reactivate')}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          variant="danger"
                          disabled={isSelf}
                          onSelect={() => onLock(u)}
                        >
                          <Lock className="h-3.5 w-3.5" strokeWidth={1.8} />
                          {t('access.active.suspend')}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// History (audit) list
// ---------------------------------------------------------------------------

function HistoryList({ items }: { items: AuditEntryRead[] }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  if (items.length === 0) {
    return <EmptyState icon={Clock} message={t('access.history.empty')} className="py-12" />
  }
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-hairline bg-surface p-2">
      {items.map((h) => {
        const rejected = h.action === 'reject'
        const approved = h.action === 'approve'
        const who = h.target_name || h.target_email || '—'
        return (
          <div key={h.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-tinted">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                approved
                  ? 'bg-success-soft text-success'
                  : rejected
                    ? 'bg-accent-soft text-accent'
                    : 'bg-surface-tinted text-muted-foreground'
              }`}
            >
              {approved ? (
                <Check className="h-3.5 w-3.5" strokeWidth={2} />
              ) : rejected ? (
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              ) : (
                <UserCog className="h-3.5 w-3.5" strokeWidth={1.8} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[0.9em] text-foreground">
                <span className="truncate font-medium" dir="auto">
                  {who}
                </span>
                {h.target_g && (
                  <span className="font-mono text-[0.85em] text-muted-foreground">{h.target_g}</span>
                )}
              </div>
              <div className="mt-0.5 text-[0.78em] text-muted-foreground">
                {t(`access.history.actions.${h.action}`, { defaultValue: h.action })}
                {h.actor && (
                  <>
                    {' '}
                    {t('access.history.by')} <span className="text-foreground">{h.actor}</span>
                  </>
                )}
                {approved && h.role && (
                  <>
                    {' · '}
                    {t('access.history.as')}{' '}
                    <span className="text-foreground">{t(`access.roleName.${h.role}`, { defaultValue: h.role })}</span>
                  </>
                )}
                {rejected && h.reason && (
                  <>
                    {' · '}
                    {t('access.history.reason')}: <span className="text-foreground">{h.reason}</span>
                  </>
                )}
              </div>
            </div>
            <span className="shrink-0 font-mono text-[0.72em] text-muted-foreground">
              {relativeTime(h.ts, locale)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function TabButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean
  count: number | null
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-[0.92em] transition-colors ${
        active
          ? 'border-primary font-semibold text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      <span>{label}</span>
      {count != null && count > 0 && (
        <span
          className={`inline-flex h-[18px] min-w-[20px] items-center justify-center rounded-full px-1.5 text-[0.72em] font-semibold ${
            active ? 'bg-primary-soft text-primary' : 'bg-surface-tinted text-muted-foreground'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AccessRequestsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  // One-shot URL → state sync: ?tab=permission-requests deep-links into that tab.
  const [tab, setTab] = useState<TabId>(() => {
    const p = searchParams.get('tab')
    if (p === 'permission-requests') return 'permission-requests'
    return 'pending'
  })

  // Clear the ?tab param after reading it so the URL stays clean.
  useEffect(() => {
    if (searchParams.has('tab')) {
      setSearchParams((prev) => {
        const n = new URLSearchParams(prev)
        n.delete('tab')
        return n
      }, { replace: true })
    }
  // Only run on mount — intentionally no deps to avoid loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [rejectTarget, setRejectTarget] = useState<AdminUserRead | null>(null)
  const [resetTarget, setResetTarget] = useState<AdminUserRead | null>(null)
  const [roleTarget, setRoleTarget] = useState<AdminUserRead | null>(null)
  const [permsTarget, setPermsTarget] = useState<AdminUserRead | null>(null)
  const [approvingId, setApprovingId] = useState<number | null>(null)

  const usersQuery = useQuery({
    queryKey: ['auth-users'],
    queryFn: () => api.listAuthUsers(),
  })
  const auditQuery = useQuery({
    queryKey: ['auth-audit'],
    queryFn: () => api.listAuthAudit(80),
    enabled: tab === 'history',
  })

  const users = useMemo(() => usersQuery.data ?? [], [usersQuery.data])
  const pending = users.filter((u) => u.status === 'pending')
  const active = users.filter((u) => u.status === 'active')
  const suspended = users.filter((u) => u.status === 'locked' || u.status === 'disabled')

  function invalidate(): void {
    void qc.invalidateQueries({ queryKey: ['auth-users'] })
    void qc.invalidateQueries({ queryKey: ['auth-audit'] })
  }
  function onError(e: unknown): void {
    toast.error(e instanceof ApiError ? e.message : String(e))
  }

  const approveMut = useMutation({
    mutationFn: ({ id, role }: { id: number; role: Role }) => api.approveAuthUser(id, role),
    onMutate: ({ id }) => setApprovingId(id),
    onSuccess: (u) => {
      toast.success(t('access.toast.approved', { name: displayName(u) }))
      invalidate()
    },
    onError,
    onSettled: () => setApprovingId(null),
  })
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => api.rejectAuthUser(id, reason),
    onSuccess: () => {
      toast.success(t('access.toast.rejected'))
      setRejectTarget(null)
      invalidate()
    },
    onError,
  })
  const resetMut = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      api.resetAuthPassword(id, password),
    onSuccess: () => {
      toast.success(t('access.toast.passwordReset'))
      setResetTarget(null)
      invalidate()
    },
    onError,
  })
  const roleMut = useMutation({
    mutationFn: ({ id, role }: { id: number; role: Role }) => api.setAuthUserRole(id, role),
    onSuccess: () => {
      toast.success(t('access.toast.roleChanged'))
      setRoleTarget(null)
      invalidate()
    },
    onError,
  })
  const defaultManagerMut = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api.setDefaultManager(id, enabled),
    onSuccess: () => {
      // Refresh the users table (badge) + the submit-dialog approver picker
      // (its `is_default` preselect) in one go.
      invalidate()
      void qc.invalidateQueries({ queryKey: ['books', 'approvers'] })
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'NOT_ELIGIBLE') {
        toast.error(t('access.defaultManager.notEligible'))
        return
      }
      onError(e)
    },
  })
  const lockMut = useMutation({
    mutationFn: (id: number) => api.lockAuthUser(id),
    onSuccess: () => {
      toast.success(t('access.toast.suspended'))
      invalidate()
    },
    onError,
  })
  const unlockMut = useMutation({
    mutationFn: (id: number) => api.unlockAuthUser(id),
    onSuccess: () => {
      toast.success(t('access.toast.reactivated'))
      invalidate()
    },
    onError,
  })

  // Defensive: route already admin-gates, but if a non-admin reaches here the
  // /auth/users call 403s — show a clean notice instead of an error toast loop.
  if (usersQuery.isError && usersQuery.error instanceof ApiError && usersQuery.error.status === 403) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background p-8">
        <EmptyState icon={Lock} message={t('access.notAuthorized')} />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-10 pt-4 md:px-8 md:pt-6">
        <header className="mb-5">
          <div className="text-[0.75em] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {t('access.eyebrow')}
          </div>
          <h1 className="mt-1 text-[1.7em] font-bold tracking-tight text-foreground">
            {t('access.title')}
          </h1>
          <p className="mt-1 text-[0.86em] text-muted-foreground">
            {t('access.meta', {
              pending: pending.length,
              active: active.length,
              suspended: suspended.length,
            })}
          </p>
        </header>

        <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto border-b border-hairline [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabButton active={tab === 'pending'} count={pending.length} label={t('access.tabs.pending')} onClick={() => setTab('pending')} />
          <TabButton active={tab === 'active'} count={active.length} label={t('access.tabs.active')} onClick={() => setTab('active')} />
          <TabButton active={tab === 'suspended'} count={suspended.length} label={t('access.tabs.suspended')} onClick={() => setTab('suspended')} />
          <TabButton active={tab === 'history'} count={null} label={t('access.tabs.history')} onClick={() => setTab('history')} />
          <TabButton active={tab === 'permission-requests'} count={null} label={t('access.permReq.tab')} onClick={() => setTab('permission-requests')} />
        </div>

        {usersQuery.isPending && tab !== 'history' ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-2xl" />
            ))}
          </div>
        ) : usersQuery.isError ? (
          <EmptyState icon={Inbox} message={t('access.loadError')} className="py-12" />
        ) : (
          <>
            {tab === 'pending' &&
              (pending.length === 0 ? (
                <EmptyState
                  icon={Check}
                  message={t('access.pending.emptyTitle')}
                  description={t('access.pending.emptySub')}
                  className="py-16"
                />
              ) : (
                <div className="flex flex-col gap-3">
                  {pending.map((req) => (
                    <RequestCard
                      key={req.id}
                      req={req}
                      approving={approvingId === req.id}
                      onApprove={(role) => approveMut.mutate({ id: req.id, role })}
                      onReject={() => setRejectTarget(req)}
                    />
                  ))}
                </div>
              ))}

            {tab === 'active' && (
              <UsersTable
                users={active}
                emptyMessage={t('access.active.empty')}
                currentUserId={user?.id}
                onReset={setResetTarget}
                onChangeRole={setRoleTarget}
                onEditPermissions={setPermsTarget}
                onSetDefaultManager={(u, enabled) => defaultManagerMut.mutate({ id: u.id, enabled })}
                onLock={(u) => lockMut.mutate(u.id)}
                onUnlock={(u) => unlockMut.mutate(u.id)}
              />
            )}

            {tab === 'suspended' && (
              <UsersTable
                users={suspended}
                emptyMessage={t('access.active.suspendedEmpty')}
                currentUserId={user?.id}
                onReset={setResetTarget}
                onChangeRole={setRoleTarget}
                onEditPermissions={setPermsTarget}
                onSetDefaultManager={(u, enabled) => defaultManagerMut.mutate({ id: u.id, enabled })}
                onLock={(u) => lockMut.mutate(u.id)}
                onUnlock={(u) => unlockMut.mutate(u.id)}
              />
            )}

            {tab === 'history' &&
              (auditQuery.isPending ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-xl" />
                  ))}
                </div>
              ) : (
                <HistoryList items={auditQuery.data ?? []} />
              ))}

            {tab === 'permission-requests' && <PermissionRequestsTab />}
          </>
        )}
      </div>

      {rejectTarget && (
        <RejectModalView
          target={rejectTarget}
          pending={rejectMut.isPending}
          onCancel={() => setRejectTarget(null)}
          onConfirm={(reason) => rejectMut.mutate({ id: rejectTarget.id, reason })}
        />
      )}
      {resetTarget && (
        <ResetModalView
          target={resetTarget}
          pending={resetMut.isPending}
          onCancel={() => setResetTarget(null)}
          onConfirm={(password) => resetMut.mutate({ id: resetTarget.id, password })}
        />
      )}
      {roleTarget && (
        <RoleModalView
          target={roleTarget}
          pending={roleMut.isPending}
          onCancel={() => setRoleTarget(null)}
          onConfirm={(role) => roleMut.mutate({ id: roleTarget.id, role })}
        />
      )}
      {permsTarget && (
        <UserPermissionsSheet user={permsTarget} onClose={() => setPermsTarget(null)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modals (own components so their local form state resets per-open)
// ---------------------------------------------------------------------------

function RejectModalView({
  target,
  pending,
  onCancel,
  onConfirm,
}: {
  target: AdminUserRead
  pending: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  return (
    <Modal title={t('access.reject.title')} onClose={onCancel}>
      <p className="text-[0.9em] leading-relaxed text-muted-foreground">
        {t('access.reject.body', { name: displayName(target) })}
      </p>
      <label className="mt-1 text-[0.72em] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {t('access.reject.reasonLabel')}
      </label>
      <textarea
        autoFocus
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('access.reject.reasonPlaceholder')}
        className="min-h-[72px] resize-y rounded-lg border border-border bg-surface px-3 py-2.5 text-[0.9em] text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15"
      />
      <div className="mt-2 flex justify-end gap-2">
        <GhostBtn onClick={onCancel}>{t('access.reject.cancel')}</GhostBtn>
        <button
          type="button"
          disabled={pending || reason.trim().length === 0}
          onClick={() => onConfirm(reason)}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[0.85em] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} /> {t('access.reject.confirm')}
        </button>
      </div>
    </Modal>
  )
}

function ResetModalView({
  target,
  pending,
  onCancel,
  onConfirm,
}: {
  target: AdminUserRead
  pending: boolean
  onCancel: () => void
  onConfirm: (password: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  function generate(): void {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
    const arr = new Uint32Array(12)
    crypto.getRandomValues(arr)
    setPassword(Array.from(arr, (n) => chars[n % chars.length]).join(''))
  }
  return (
    <Modal title={t('access.resetModal.title')} onClose={onCancel}>
      <p className="text-[0.9em] leading-relaxed text-muted-foreground">
        {t('access.resetModal.body', { name: displayName(target) })}
      </p>
      <label className="mt-1 text-[0.72em] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {t('access.resetModal.label')}
      </label>
      <div className="flex gap-2">
        <input
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('access.resetModal.placeholder')}
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2.5 font-mono text-[0.9em] text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15"
        />
        <GhostBtn onClick={generate}>{t('access.resetModal.generate')}</GhostBtn>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <GhostBtn onClick={onCancel}>{t('access.resetModal.cancel')}</GhostBtn>
        <button
          type="button"
          disabled={pending || password.length < 8}
          onClick={() => onConfirm(password)}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[0.85em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          <KeyRound className="h-3.5 w-3.5" strokeWidth={2} /> {t('access.resetModal.confirm')}
        </button>
      </div>
    </Modal>
  )
}

function RoleModalView({
  target,
  pending,
  onCancel,
  onConfirm,
}: {
  target: AdminUserRead
  pending: boolean
  onCancel: () => void
  onConfirm: (role: Role) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [role, setRole] = useState<Role>(target.role)
  return (
    <Modal title={t('access.roleModal.title', { name: displayName(target) })} onClose={onCancel}>
      <RolePicker value={role} onChange={setRole} />
      <div className="mt-2 flex justify-end gap-2">
        <GhostBtn onClick={onCancel}>{t('access.roleModal.cancel')}</GhostBtn>
        <button
          type="button"
          disabled={pending}
          onClick={() => onConfirm(role)}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[0.85em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {t('access.roleModal.confirm')}
        </button>
      </div>
    </Modal>
  )
}

function GhostBtn({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-4 py-2 text-[0.85em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground"
    >
      {children}
    </button>
  )
}
