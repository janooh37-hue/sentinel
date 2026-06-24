/**
 * AccountMenu — top-nav corner avatar (TAMM redesign).
 *
 * Single-user model: the avatar shows the linked employee's photo (or initial
 * fallback). Clicking opens a popover with:
 *   - Photo + name + role chip + linked employee meta (G-id · email · last sync)
 *   - "Link this account to an employee" CTA when account is configured but
 *     not yet linked.
 *   - "Lock app" action
 *   - "Email settings" action (opens the Settings page)
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Lock,
  LogOut,
  Mail,
  Settings as SettingsIcon,
  LinkIcon,
  ShieldCheck,
} from 'lucide-react'

import { api } from '@/lib/api'
import type { SessionUser } from '@/lib/api'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useIdentity } from '@/lib/useIdentity'
import { useAuth } from '@/lib/authContext'

function initialsOf(email: string | undefined): string {
  if (!email) return '?'
  const local = email.split('@')[0]
  const parts = local.split(/[._-]+/).filter(Boolean)
  if (parts.length === 0) return email[0]?.toUpperCase() ?? '?'
  return (
    parts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

/** Role chip — square, color-coded per the GSSG design system badge spec:
 *  Admin = accent (red, elevated privileges), Manager = info (blue),
 *  Operator = neutral. Sourced from the signed-in user's role so it renders
 *  for linked AND unlinked accounts. */
function RoleChip({
  role,
  label,
}: {
  role: SessionUser['role']
  label: string
}): React.JSX.Element {
  const cls =
    role === 'admin'
      ? 'bg-accent-soft text-accent'
      : role === 'manager'
        ? 'bg-info-soft text-info'
        : 'bg-surface-tinted text-muted-foreground'
  return (
    <span
      className={`inline-flex items-center rounded-md px-2.5 py-[3px] text-[0.65em] font-semibold uppercase tracking-[0.06em] ${cls}`}
    >
      {label}
    </span>
  )
}

interface AccountMenuProps {
  onLock: () => void
  onOpenSettings?: () => void
  onSignOut?: () => void
}

export function AccountMenu({
  onLock,
  onOpenSettings,
  onSignOut,
}: AccountMenuProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const accountQuery = useQuery({
    queryKey: ['email-account'],
    queryFn: () => api.getEmailAccount(),
    staleTime: 60_000,
  })

  const { identity, isAdmin } = useIdentity()
  // The signed-in account (email/role) is authoritative for "who is this" —
  // distinct from the shared mailbox below (`account`), which is install-wide.
  const { user } = useAuth()

  // Admins can review access requests from here; show the pending count.
  const usersQuery = useQuery({
    queryKey: ['auth-users'],
    queryFn: () => api.listAuthUsers(),
    enabled: isAdmin,
    staleTime: 30_000,
  })
  const pendingCount = isAdmin
    ? (usersQuery.data ?? []).filter((u) => u.status === 'pending').length
    : 0

  const account = accountQuery.data
  const initials = initialsOf(user?.email ?? account?.email)
  // Avatar photo/name/role come from the signed-in user (SessionUser), never
  // the install-wide shared mailbox — finishes the items 1-2 identity fix.
  const photoUrl = user?.photo_url
  const displayName = (isAr ? user?.name_ar : user?.name_en) ?? user?.name_en
  const roleLabel = user
    ? t(`access.roleName.${user.role}`)
    : ''

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Tick every minute so "Synced 5 min ago" rolls forward in the popover.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(handle)
  }, [])

  const lastSyncLabel = ((): string => {
    if (!account?.last_synced_at) {
      return t('appBar.sync.never', { defaultValue: 'Never synced' })
    }
    const minutes = Math.floor(
      (now - new Date(account.last_synced_at).getTime()) / 60_000,
    )
    if (minutes < 1) return t('appBar.sync.justNow', { defaultValue: 'Synced just now' })
    if (minutes < 60) {
      return t('appBar.sync.minutesAgo', { n: minutes, defaultValue: 'Synced {{n}} min ago' })
    }
    const hrs = Math.floor(minutes / 60)
    return t('appBar.sync.hoursAgo', { n: hrs, defaultValue: 'Synced {{n}} hr ago' })
  })()

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={user?.email ?? account?.email ?? t('appBar.account', { defaultValue: 'Account' })}
      >
        <Avatar className="h-9 w-9 bg-primary-soft text-primary ring-1 ring-border">
          {photoUrl && <AvatarImage src={photoUrl} alt="" />}
          <AvatarFallback>
            {user?.name_en ? user.name_en[0]?.toUpperCase() : initials}
          </AvatarFallback>
        </Avatar>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('appBar.account', { defaultValue: 'Account' })}
          className="absolute end-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-hairline bg-surface shadow-xl"
        >
          {/* Identity strip — name/photo/role/email all from the signed-in
              user (SessionUser), never the shared mailbox. */}
          <div className="flex items-center gap-3 border-b border-hairline px-4 py-4">
            <Avatar className="h-14 w-14 bg-primary-soft text-primary ring-1 ring-border">
              {photoUrl && <AvatarImage src={photoUrl} alt="" />}
              <AvatarFallback className="text-base">
                {user?.name_en ? user.name_en[0]?.toUpperCase() : initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[0.95em] font-semibold text-foreground">
                  {displayName ?? user?.email ?? (isAr ? 'لا يوجد حساب' : 'No account')}
                </span>
                {user && <RoleChip role={user.role} label={roleLabel} />}
              </div>
              {user?.position && (
                <span className="text-[0.78em] text-muted-foreground">
                  {user.position}
                </span>
              )}
              <span className="mt-0.5 text-[0.78em] text-muted-foreground">
                {user?.employee_id && (
                  <>
                    <span className="font-mono">{user.employee_id}</span>
                    {' · '}
                  </>
                )}
                {user?.email && <span className="truncate">{user.email}</span>}
              </span>
              <span className="mt-1 flex items-center gap-1.5 text-[0.78em] text-muted-foreground">
                <Mail className="h-3 w-3" strokeWidth={1.7} />
                {lastSyncLabel}
              </span>
            </div>
          </div>

          {/* Link CTA when a mailbox is configured but the user isn't linked */}
          {account && !identity?.linked && onOpenSettings && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onOpenSettings()
              }}
              className="flex w-full items-center gap-2 border-b border-hairline bg-warning-soft px-4 py-2.5 text-start text-[0.82em] font-medium text-warning transition-colors hover:bg-warning-soft/80"
            >
              <LinkIcon className="h-3.5 w-3.5" strokeWidth={1.7} />
              {t('appBar.linkAccountCta')}
            </button>
          )}

          {/* Actions */}
          <div className="flex flex-col py-1.5">
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  navigate('/access-requests')
                }}
                className="flex min-h-11 w-full items-center gap-2.5 px-4 py-2.5 text-start text-[0.9em] text-foreground transition-colors hover:bg-surface-tinted"
              >
                <ShieldCheck className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} />
                <span className="flex-1">{t('access.title')}</span>
                {pendingCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[0.7em] font-bold text-white">
                    {pendingCount}
                  </span>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onLock()
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-start text-[0.9em] text-foreground transition-colors hover:bg-surface-tinted"
            >
              <Lock className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} />
              {t('appBar.lockApp', { defaultValue: 'Lock app' })}
            </button>
            {onOpenSettings && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onOpenSettings()
                }}
                className="flex min-h-11 w-full items-center gap-2.5 px-4 py-2.5 text-start text-[0.9em] text-foreground transition-colors hover:bg-surface-tinted"
              >
                <SettingsIcon
                  className="h-4 w-4 text-muted-foreground"
                  strokeWidth={1.7}
                />
                {t('nav.settings', { defaultValue: 'Settings' })}
              </button>
            )}
            {onSignOut && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onSignOut()
                }}
                className="flex min-h-11 w-full items-center gap-2.5 border-t border-hairline px-4 py-2.5 text-start text-[0.9em] text-foreground transition-colors hover:bg-surface-tinted"
              >
                <LogOut className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} />
                {t('auth.signOut', { defaultValue: 'Sign out' })}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
