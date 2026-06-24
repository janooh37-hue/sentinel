/**
 * SettingsPage — TAMM redesign (Task 10).
 *
 * Page shell: max-w-[1180px] mx-auto px-8 py-6, eyebrow + big title + meta line.
 * Section cards: bg-surface rounded-2xl p-6 with h3 header + sub-paragraph +
 * border-b border-hairline separator.
 *
 * Sections (top to bottom):
 *  1. Appearance — informational only (font + theme moved to TopNav)
 *  2. Defaults — stamp style, manager hand-sign
 *  3. Email integration — Email + Signature + linked-employee (manager-gated)
 *  4. Submitters — CRUD list (manager-gated)
 *  5. System — diagnostic info + update check
 *  6. Advanced — admin gate, paths copy (manager-gated)
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Loader2, Copy as CopyIcon, ArrowRight } from 'lucide-react'

import {
  api,
  type AppSettingsRead,
  type AppSettingsUpdate,
  type SubmitterCreate,
} from '@/lib/api'
import { RoleGate } from '@/components/shell/RoleGate'
import { CapabilityGate } from '@/components/shell/CapabilityGate'
import { useAuth } from '@/lib/authContext'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmailSection } from './EmailSection'
import { SigningSignatureSection } from './SigningSignatureSection'
import { MigrationWizard, MIGRATION_SKIPPED_KEY } from '@/pages/system/MigrationWizard'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ---------------------------------------------------------------------------
// Shared building blocks — TAMM vocabulary
// ---------------------------------------------------------------------------

function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-2xl bg-surface p-6">
      <div className="mb-4 border-b border-hairline pb-4">
        <h3 className="text-[1.05em] font-semibold tracking-tight text-foreground">
          {title}
        </h3>
        {description && (
          <p className="mt-1 text-[0.86em] text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  )
}

/** Read-only key/value row: 180px uppercase tracking label + foreground value. */
function KeyValueRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-0.5 border-b border-hairline/60 py-3 last:border-0 sm:grid-cols-[180px_1fr] sm:items-center sm:gap-4">
      <span className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 text-[0.9em] text-foreground [overflow-wrap:anywhere]">{children}</div>
    </div>
  )
}

/** Outline pill button (secondary action). */
function OutlineButton({
  onClick,
  disabled,
  children,
  className = '',
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2 text-[0.82em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}

/** Primary navy pill (primary action). */
function PrimaryButton({
  onClick,
  disabled,
  children,
  type = 'button',
}: {
  onClick?: () => void
  disabled?: boolean
  children: React.ReactNode
  type?: 'button' | 'submit'
}): React.JSX.Element {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-[0.85em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Your account — the signed-in user (distinct from the shared mailbox below)
// ---------------------------------------------------------------------------

function AccountSection(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const { user } = useAuth()

  const roleLabel = ((): string => {
    switch (user?.role) {
      case 'admin':
        return t('settings.account.roleAdmin')
      case 'manager':
        return t('settings.account.roleManager')
      default:
        return t('settings.account.roleOperator')
    }
  })()

  return (
    <SectionCard
      title={t('settings.account.title')}
      description={t('settings.account.description')}
    >
      <div>
        <KeyValueRow label={t('settings.account.email')}>
          <span className="break-all">{user?.email ?? '—'}</span>
        </KeyValueRow>
        <KeyValueRow label={t('settings.account.name')}>
          {(isAr ? user?.name_ar : user?.name_en) ?? user?.name_en ?? '—'}
        </KeyValueRow>
        <KeyValueRow label={t('settings.account.role')}>{roleLabel}</KeyValueRow>
        {user?.employee_id && (
          <KeyValueRow label={t('settings.account.employeeId')}>
            <span className="font-mono">{user.employee_id}</span>
          </KeyValueRow>
        )}
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Appearance — informational only (font size + theme live in TopNav)
// ---------------------------------------------------------------------------

function AppearanceSection({
  settings,
  onUpdate,
}: {
  settings: AppSettingsRead
  onUpdate: (u: AppSettingsUpdate) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <SectionCard
      title={t('settings.appearance.title')}
      description={t('settings.appearance.description')}
    >
      <p className="text-[0.86em] text-muted-foreground">
        {t('settings.appearance.hint')}
      </p>
      <div className="mt-4 border-t border-hairline/60 pt-4">
        <label className="flex cursor-pointer items-center gap-2.5 text-[0.86em] text-foreground">
          <input
            type="checkbox"
            checked={settings.sentry_opt_in}
            onChange={(e) => onUpdate({ sentry_opt_in: e.target.checked })}
            className="h-4 w-4 accent-primary"
          />
          <span>{t('settings.appearance.sentryLabel')}</span>
        </label>
        <p className="ms-6 mt-1 text-[0.78em] text-muted-foreground">
          {t('settings.appearance.sentryHint')}
        </p>
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Defaults — stamp style + manager hand-sign default
// ---------------------------------------------------------------------------

function DefaultsSection({
  settings,
  onUpdate,
}: {
  settings: AppSettingsRead
  onUpdate: (u: AppSettingsUpdate) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  const stampOptions: { value: string; label: string }[] = [
    { value: 'header', label: t('settings.defaults.stampHeader') },
    { value: 'bold_top_right', label: t('settings.defaults.stampBoldTopRight') },
    { value: 'watermark', label: t('settings.defaults.stampWatermark') },
  ]

  return (
    <SectionCard
      title={t('settings.defaults.title')}
      description={t('settings.defaults.description')}
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {t('settings.defaults.stampStyle')}
          </label>
          <Select
            value={settings.stamp_style}
            onValueChange={(v) => onUpdate({ stamp_style: v })}
          >
            <SelectTrigger className="max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stampOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Submitters — manager-gated CRUD list
// ---------------------------------------------------------------------------

function SubmittersSection(): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: submitters, isLoading } = useQuery({
    queryKey: ['submitters'],
    queryFn: () => api.listSubmitters(),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteSubmitter(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['submitters'] })
      toast.success(t('settings.submitters.deletedToast'))
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmpId, setNewEmpId] = useState('')
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const createMut = useMutation({
    mutationFn: (body: SubmitterCreate) => api.createSubmitter(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['submitters'] })
      toast.success(t('settings.submitters.addedToast'))
      setShowAdd(false)
      setNewName('')
      setNewEmpId('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <SectionCard
      title={t('settings.submitters.title')}
      description={t('settings.submitters.description')}
    >
      <div className="space-y-2.5">
        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-11 w-full rounded-lg" />
            ))}
          </div>
        )}
        {submitters && submitters.length === 0 && (
          <p className="py-2 text-[0.86em] text-muted-foreground">
            {t('settings.submitters.empty')}
          </p>
        )}
        {submitters?.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between rounded-lg border border-hairline bg-surface-raised px-4 py-2.5"
          >
            <div className="min-w-0">
              <span className="text-[0.9em] font-medium text-foreground">{s.name}</span>
              {s.employee_id && (
                <span className="ms-2 font-mono text-[0.78em] text-muted-foreground">
                  {s.employee_id}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setDeleteId(s.id)}
              className="rounded-full px-3 py-1 text-[0.78em] font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t('settings.submitters.delete')}
            </button>
          </div>
        ))}

        {showAdd ? (
          <div className="space-y-2.5 rounded-lg border border-hairline bg-surface-tinted p-3">
            <div className="flex gap-2">
              <input
                autoFocus
                className="flex-1 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[0.86em] text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15"
                placeholder={t('settings.submitters.name')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <input
                className="w-32 rounded-lg border border-border bg-surface px-3.5 py-2.5 font-mono text-[0.86em] text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15"
                placeholder={t('settings.submitters.employeeId')}
                value={newEmpId}
                onChange={(e) => setNewEmpId(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <OutlineButton onClick={() => setShowAdd(false)}>
                {t('settings.submitters.cancel')}
              </OutlineButton>
              <PrimaryButton
                disabled={!newName.trim() || createMut.isPending}
                onClick={() =>
                  createMut.mutate({ name: newName.trim(), employee_id: newEmpId || null })
                }
              >
                {createMut.isPending && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {t('settings.submitters.addAction')}
              </PrimaryButton>
            </div>
          </div>
        ) : (
          <OutlineButton onClick={() => setShowAdd(true)}>
            {t('settings.submitters.add')}
          </OutlineButton>
        )}
      </div>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => { if (!o) setDeleteId(null) }}
        title={t('settings.submitters.confirmDelete')}
        confirmLabel={t('settings.submitters.delete')}
        onConfirm={() => { if (deleteId !== null) deleteMut.mutate(deleteId) }}
        destructive
      />
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Managers — settings.edit-gated account-link list
// ---------------------------------------------------------------------------

function ManagersSection(): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: managers } = useQuery({
    queryKey: ['managers'],
    queryFn: () => api.listManagers(),
  })

  const { data: users } = useQuery({
    queryKey: ['auth', 'users'],
    queryFn: () => api.listAuthUsers(),
  })

  const linkMut = useMutation({
    mutationFn: ({ id, userId }: { id: number; userId: number | null }) =>
      api.linkManagerAccount(id, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['managers'] })
      toast.success(t('settings.managers.linkedToast'))
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const active = (users ?? []).filter((u) => u.status === 'active')

  return (
    <SectionCard
      title={t('settings.managers.title')}
      description={t('settings.managers.description')}
    >
      <div className="space-y-2.5">
        {managers && managers.length === 0 && (
          <p className="py-2 text-[0.86em] text-muted-foreground">
            {t('settings.managers.empty')}
          </p>
        )}
        {managers?.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-surface-raised px-4 py-2.5"
          >
            <span
              className="min-w-0 text-[0.9em] font-medium text-foreground"
              dir="auto"
            >
              {m.name_en ?? m.name_ar}
            </span>
            <select
              aria-label={t('settings.managers.noAccount')}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[0.84em]"
              value={m.user_id != null ? String(m.user_id) : ''}
              onChange={(e) =>
                linkMut.mutate({
                  id: m.id,
                  userId: e.target.value ? Number(e.target.value) : null,
                })
              }
            >
              <option value="">{t('settings.managers.noAccount')}</option>
              {active.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name_en ?? u.display_name ?? u.email}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Access requests — admin-gated entry point to the review screen
// ---------------------------------------------------------------------------

function AccessRequestsSection(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { data: users } = useQuery({
    queryKey: ['auth-users'],
    queryFn: () => api.listAuthUsers(),
  })
  const pendingCount = (users ?? []).filter((u) => u.status === 'pending').length

  return (
    <SectionCard
      title={t('access.settingsCard.title')}
      description={t('access.settingsCard.desc')}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {pendingCount > 0 ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-[0.84em] font-medium text-accent">
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[0.72em] font-bold text-white">
              {pendingCount}
            </span>
            {t('access.settingsCard.pending', { count: pendingCount })}
          </span>
        ) : (
          <span className="text-[0.86em] text-muted-foreground">
            {t('access.settingsCard.none')}
          </span>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <PrimaryButton onClick={() => navigate('/access-requests')}>
            {t('access.settingsCard.review')}
            <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={1.8} />
          </PrimaryButton>
        </div>
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// System — diagnostic info + update check
// ---------------------------------------------------------------------------

function SystemSection(): React.JSX.Element {
  const { t } = useTranslation()
  const [showMigration, setShowMigration] = useState(false)

  const { data: info, isLoading: infoLoading } = useQuery({
    queryKey: ['system-info'],
    queryFn: () => api.getSystemInfo(),
  })

  const [updateResult, setUpdateResult] = useState<{
    message: string
    ok: boolean
  } | null>(null)
  const [checking, setChecking] = useState(false)

  const handleCheckUpdates = async (): Promise<void> => {
    setChecking(true)
    try {
      const res = await api.checkForUpdates()
      if (res.error) {
        setUpdateResult({ message: res.error, ok: false })
      } else if (res.update_available && res.latest) {
        setUpdateResult({
          message: t('settings.system.updateAvailable', { version: res.latest }),
          ok: false,
        })
      } else {
        setUpdateResult({
          message: t('settings.system.upToDate'),
          ok: true,
        })
      }
    } catch {
      setUpdateResult({ message: t('settings.system.checkFailed'), ok: false })
    } finally {
      setChecking(false)
    }
  }

  function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return `${h}h ${m}m`
  }

  const rows: { label: string; value: string; mono?: boolean }[] = info
    ? [
        { label: t('settings.system.version'), value: info.version },
        { label: t('settings.system.database'), value: info.db_path, mono: true },
        { label: t('settings.system.logFile'), value: info.log_path, mono: true },
        { label: t('settings.system.dataDir'), value: info.data_dir, mono: true },
        { label: t('settings.system.python'), value: info.python_version },
        { label: t('settings.system.platform'), value: info.platform },
        { label: t('settings.system.uptime'), value: formatUptime(info.uptime_seconds) },
      ]
    : []

  return (
    <SectionCard
      title={t('settings.system.title')}
      description={t('settings.system.description')}
    >
      {infoLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-full rounded-md" />
          ))}
        </div>
      ) : (
        <div>
          {rows.map((row) => (
            <KeyValueRow key={row.label} label={row.label}>
              <span
                className={
                  row.mono
                    ? 'break-all font-mono text-[0.82em] text-foreground'
                    : 'text-[0.9em] text-foreground'
                }
              >
                {row.value}
              </span>
            </KeyValueRow>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <OutlineButton onClick={() => void handleCheckUpdates()} disabled={checking}>
          {checking
            ? t('settings.system.checking')
            : t('settings.system.checkUpdates')}
        </OutlineButton>
        {updateResult && (
          <span
            className={
              updateResult.ok
                ? 'text-[0.82em] text-success'
                : 'text-[0.82em] text-accent'
            }
          >
            {updateResult.message}
          </span>
        )}
        <OutlineButton
          onClick={() => {
            try {
              localStorage.removeItem(MIGRATION_SKIPPED_KEY)
            } catch {
              /* ignore */
            }
            setShowMigration(true)
          }}
        >
          {t('migration.buttons.runMigration')}
        </OutlineButton>
      </div>
      {showMigration && (
        <MigrationWizard detectedDir={null} onClose={() => setShowMigration(false)} />
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Advanced — admin gate + path copy (manager-gated)
// ---------------------------------------------------------------------------

function AdvancedSection({
  settings,
}: {
  settings: AppSettingsRead
}): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: info } = useQuery({
    queryKey: ['system-info'],
    queryFn: () => api.getSystemInfo(),
  })

  const adminMut = useMutation({
    mutationFn: (enabled: boolean) => api.setAdminKey(enabled),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['settings'] })
      toast.success(
        res.admin_gate_enabled
          ? t('settings.advanced.adminGateOnToast')
          : t('settings.advanced.adminGateOffToast'),
      )
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function copyPath(path: string): void {
    void navigator.clipboard.writeText(path)
    toast.success(t('settings.advanced.pathCopiedToast'))
  }

  return (
    <SectionCard
      title={t('settings.advanced.title')}
      description={t('settings.advanced.description')}
    >
      <div className="space-y-1">
        {settings.admin_gate_enabled && (
          <KeyValueRow label={t('settings.advanced.adminGate')}>
            <label className="inline-flex cursor-pointer items-center gap-2 text-[0.86em] text-foreground">
              <input
                type="checkbox"
                checked={settings.admin_gate_enabled}
                onChange={(e) => adminMut.mutate(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              {t('settings.advanced.adminGateEnabled')}
            </label>
          </KeyValueRow>
        )}
        {info && (
          <>
            <KeyValueRow label={t('settings.advanced.dataDir')}>
              <div className="flex items-center gap-2.5">
                <span className="truncate font-mono text-[0.82em] text-muted-foreground">
                  {info.data_dir}
                </span>
                <OutlineButton onClick={() => copyPath(info.data_dir)}>
                  <CopyIcon className="h-3.5 w-3.5" strokeWidth={1.7} />
                  {t('settings.advanced.copy')}
                </OutlineButton>
              </div>
            </KeyValueRow>
            <KeyValueRow label={t('settings.advanced.logFile')}>
              <div className="flex items-center gap-2.5">
                <span className="truncate font-mono text-[0.82em] text-muted-foreground">
                  {info.log_path}
                </span>
                <OutlineButton onClick={() => copyPath(info.log_path)}>
                  <CopyIcon className="h-3.5 w-3.5" strokeWidth={1.7} />
                  {t('settings.advanced.copy')}
                </OutlineButton>
              </div>
            </KeyValueRow>
          </>
        )}
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Main SettingsPage
// ---------------------------------------------------------------------------

export function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
  })

  const updateMut = useMutation({
    mutationFn: (body: AppSettingsUpdate) => api.updateSettings(body),
    onSuccess: (updated) => {
      qc.setQueryData(['settings'], updated)
      toast.success(t('settings.savedToast'))
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleUpdate = (body: AppSettingsUpdate): void => {
    updateMut.mutate(body)
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto w-full max-w-[1180px] flex-1 px-8 pb-10 pt-6">
        {/* TAMM page header */}
        <header className="mb-5">
          <div className="text-[0.75em] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {t('settings.eyebrow')}
          </div>
          <h1 className="mt-1 text-[1.7em] font-bold tracking-tight text-foreground">
            {t('settings.title')}
          </h1>
          <p className="mt-1 text-[0.86em] text-muted-foreground">
            {t('settings.subtitle')}
          </p>
        </header>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-40 w-full rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <AccountSection />

            {settings ? (
              <SigningSignatureSection settings={settings} onUpdate={handleUpdate} />
            ) : (
              <SigningSignatureSection />
            )}

            {settings && (
              <AppearanceSection settings={settings} onUpdate={handleUpdate} />
            )}

            {settings && (
              <DefaultsSection settings={settings} onUpdate={handleUpdate} />
            )}

            {/* Email integration is its own composite section. The EmailSection
                component renders its own SectionCard chrome so it can host
                Signature + linked-employee as sub-cards. Gated to users with
                the email.manage capability so they can see/edit their own
                mailbox credentials (backend enforces the same). */}
            <CapabilityGate cap="email.manage">
              <EmailSection />
            </CapabilityGate>

            <CapabilityGate cap="users.manage">
              <AccessRequestsSection />
            </CapabilityGate>

            <RoleGate role="manager">
              <SubmittersSection />
            </RoleGate>

            <CapabilityGate cap="settings.edit">
              <ManagersSection />
            </CapabilityGate>

            <SystemSection />

            <RoleGate role="manager">
              {settings && <AdvancedSection settings={settings} />}
            </RoleGate>
          </div>
        )}
      </div>
    </div>
  )
}
