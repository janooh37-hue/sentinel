/** Roomy settings workspace: grouped category rail, focused controls, editor. */

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
import { CapabilityGate } from '@/components/shell/CapabilityGate'
import { useAuth } from '@/lib/authContext'
import { useCapabilities } from '@/lib/useCapabilities'
import { copyToClipboard } from '@/lib/clipboard'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmailSection } from './EmailSection'
import { OutlookConnectionSection } from './OutlookConnectionSection'
import { ManagersSection } from './ManagersSection'
import { DesignationCatalog } from './DesignationCatalog'
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

export function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-2xl bg-surface p-4 sm:p-6">
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
      <span className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground rtl:tracking-normal">
        {label}
      </span>
      <div className="min-w-0 text-[0.9em] text-foreground [overflow-wrap:anywhere]">{children}</div>
    </div>
  )
}

/** Outline pill button (secondary action). */
export function OutlineButton({
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
export function PrimaryButton({
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

function CrashReportingSection({
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
      <div>
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

function SmsAutosendSection({
  settings,
  onUpdate,
}: {
  settings: AppSettingsRead
  onUpdate: (u: AppSettingsUpdate) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <SectionCard
      title={t('settings.smsAutosend.label')}
      description={t('settings.smsAutosend.hint')}
    >
      <div>
        <label className="flex cursor-pointer items-center gap-2.5 text-[0.86em] text-foreground">
          <input
            type="checkbox"
            checked={settings.sms_autosend_enabled}
            onChange={(e) => onUpdate({ sms_autosend_enabled: e.target.checked })}
            className="h-4 w-4 accent-primary"
          />
          <span>{t('settings.smsAutosend.label')}</span>
        </label>
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
          <label className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground rtl:tracking-normal">
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
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hairline bg-surface-raised px-4 py-2.5"
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
              className="ms-auto min-h-11 shrink-0 rounded-full px-3 py-1 text-[0.78em] font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-0"
            >
              {t('settings.submitters.delete')}
            </button>
          </div>
        ))}

        {showAdd ? (
          <div className="space-y-2.5 rounded-lg border border-hairline bg-surface-tinted p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_8rem]">
              <label className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground rtl:tracking-normal">
                {t('settings.submitters.name')}
                <input
                  autoFocus
                  className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[0.86em] font-normal normal-case tracking-normal text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </label>
              <label className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground rtl:tracking-normal">
                {t('settings.submitters.employeeId')}
                <input
                  className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 font-mono text-[0.86em] font-normal normal-case tracking-normal text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15"
                  value={newEmpId}
                  onChange={(e) => setNewEmpId(e.target.value)}
                />
              </label>
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
        <CapabilityGate cap="system.admin">
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
        </CapabilityGate>
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
    void copyToClipboard(path).then((ok) => {
      if (ok) toast.success(t('settings.advanced.pathCopiedToast'))
    })
  }

  return (
    <SectionCard
      title={t('settings.advanced.title')}
      description={t('settings.advanced.description')}
    >
      <div className="space-y-1">
        <KeyValueRow label={t('settings.advanced.adminGate')}>
          <label className="inline-flex cursor-pointer items-center gap-2 text-[0.86em] text-foreground">
            <input
              type="checkbox"
              checked={settings.admin_gate_enabled}
              disabled={adminMut.isPending}
              onChange={(e) => adminMut.mutate(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            {t('settings.advanced.adminGateEnabled')}
          </label>
        </KeyValueRow>
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

type SettingsPanelId =
  | 'account'
  | 'signing'
  | 'defaults'
  | 'submitters'
  | 'designations'
  | 'managers'
  | 'outlook'
  | 'email'
  | 'sms'
  | 'access'
  | 'crashReporting'
  | 'system'
  | 'advanced'

type SettingsGroupId = 'personal' | 'operations' | 'administration'

interface SettingsPanelItem {
  id: SettingsPanelId
  title: string
  description: string
}

interface SettingsCategory {
  id: string
  group: SettingsGroupId
  label: string
  panels: SettingsPanelItem[]
}

export function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { has } = useCapabilities()
  const [activePanel, setActivePanel] = useState<SettingsPanelId>('account')

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

  const panels: Record<SettingsPanelId, SettingsPanelItem> = {
    account: {
      id: 'account',
      title: t('settings.account.title'),
      description: t('settings.account.description'),
    },
    signing: {
      id: 'signing',
      title: t('settings.signingSignature.title'),
      description: t('settings.signingSignature.description'),
    },
    defaults: {
      id: 'defaults',
      title: t('settings.defaults.title'),
      description: t('settings.defaults.description'),
    },
    submitters: {
      id: 'submitters',
      title: t('settings.submitters.title'),
      description: t('settings.submitters.description'),
    },
    designations: {
      id: 'designations',
      title: t('timesheet.designations.title'),
      description: t('timesheet.designations.description'),
    },
    managers: {
      id: 'managers',
      title: t('settings.managers.title'),
      description: t('settings.managers.description'),
    },
    outlook: {
      id: 'outlook',
      title: t('settings.outlook.title'),
      description: t('settings.outlook.description'),
    },
    email: {
      id: 'email',
      title: t('settings.email.heading'),
      description: t('settings.email.description'),
    },
    sms: {
      id: 'sms',
      title: t('settings.smsAutosend.label'),
      description: t('settings.smsAutosend.hint'),
    },
    access: {
      id: 'access',
      title: t('access.settingsCard.title'),
      description: t('access.settingsCard.desc'),
    },
    crashReporting: {
      id: 'crashReporting',
      title: t('settings.appearance.title'),
      description: t('settings.appearance.description'),
    },
    system: {
      id: 'system',
      title: t('settings.system.title'),
      description: t('settings.system.description'),
    },
    advanced: {
      id: 'advanced',
      title: t('settings.advanced.title'),
      description: t('settings.advanced.description'),
    },
  }

  const categories = ([
    {
      id: 'profile',
      group: 'personal',
      label: t('settings.navigation.profile'),
      panels: [panels.account, panels.signing],
    },
    {
      id: 'documents',
      group: 'operations',
      label: t('settings.navigation.documents'),
      panels: [
        ...(has('settings.edit') ? [panels.defaults, panels.managers] : []),
        ...(has('submitters.manage') ? [panels.submitters] : []),
        // The catalog's only effect is the order the two monthly workbooks
        // print, so it belongs with the other "what our paperwork says"
        // panels. `timesheet.edit` per amendment A3: managers only.
        ...(has('timesheet.edit') ? [panels.designations] : []),
      ],
    },
    {
      id: 'communications',
      group: 'operations',
      label: t('settings.navigation.communications'),
      panels: [
        ...(has('email.manage') ? [panels.email, panels.outlook] : []),
        ...(has('settings.edit') ? [panels.sms] : []),
      ],
    },
    {
      id: 'people',
      group: 'administration',
      label: t('settings.navigation.peopleAccess'),
      panels: has('users.manage') ? [panels.access] : [],
    },
    {
      id: 'application',
      group: 'administration',
      label: t('settings.navigation.application'),
      panels: has('settings.edit') ? [panels.crashReporting] : [],
    },
    {
      id: 'system',
      group: 'administration',
      label: t('settings.navigation.system'),
      panels: [panels.system, ...(has('system.admin') ? [panels.advanced] : [])],
    },
  ] satisfies SettingsCategory[]).filter((category) => category.panels.length > 0)

  const visiblePanelIds = new Set(
    categories.flatMap((category) => category.panels.map((panel) => panel.id)),
  )
  const selectedPanelId = visiblePanelIds.has(activePanel) ? activePanel : 'account'
  const selectedCategory =
    categories.find((category) =>
      category.panels.some((panel) => panel.id === selectedPanelId),
    ) ?? categories[0]!

  const groups: { id: SettingsGroupId; label: string }[] = [
    { id: 'personal', label: t('settings.navigation.personal') },
    { id: 'operations', label: t('settings.navigation.operations') },
    { id: 'administration', label: t('settings.navigation.administration') },
  ]

  const settingsSkeleton = (
    <div className="space-y-3 rounded-2xl bg-surface p-4 sm:p-6">
      <Skeleton className="h-6 w-48 rounded-md" />
      <Skeleton className="h-4 w-72 max-w-full rounded-md" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  )

  const renderSelectedPanel = (): React.JSX.Element => {
    switch (selectedPanelId) {
      case 'account':
        return <AccountSection />
      case 'signing':
        return settings ? (
          <SigningSignatureSection settings={settings} onUpdate={handleUpdate} />
        ) : (
          <SigningSignatureSection />
        )
      case 'defaults':
        return settings ? (
          <DefaultsSection settings={settings} onUpdate={handleUpdate} />
        ) : settingsSkeleton
      case 'submitters':
        return <SubmittersSection />
      case 'designations':
        return <DesignationCatalog />
      case 'managers':
        return <ManagersSection />
      case 'outlook':
        return <OutlookConnectionSection />
      case 'email':
        return <EmailSection />
      case 'sms':
        return settings ? (
          <SmsAutosendSection settings={settings} onUpdate={handleUpdate} />
        ) : settingsSkeleton
      case 'access':
        return <AccessRequestsSection />
      case 'crashReporting':
        return settings ? (
          <CrashReportingSection settings={settings} onUpdate={handleUpdate} />
        ) : settingsSkeleton
      case 'system':
        return <SystemSection />
      case 'advanced':
        return settings ? <AdvancedSection settings={settings} /> : settingsSkeleton
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-10 pt-6 sm:px-8">
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

        <div className="overflow-hidden rounded-2xl border border-hairline bg-surface shadow-sm lg:grid lg:grid-cols-[250px_220px_minmax(0,1fr)] xl:grid-cols-[285px_240px_minmax(0,1fr)]">
          <nav
            aria-label={t('settings.navigation.categories')}
            className="overflow-x-auto bg-primary p-2 text-primary-foreground lg:min-h-[620px] lg:overflow-y-auto lg:p-5"
          >
            <div className="hidden lg:block">
              <h2 className="text-xl font-bold">{t('settings.title')}</h2>
              <p className="mt-1 text-xs leading-relaxed text-primary-foreground/70">
                {t('settings.subtitle')}
              </p>
            </div>

            <div className="flex min-w-max gap-1 lg:mt-5 lg:block lg:min-w-0">
              {groups.map((group) => {
                const groupCategories = categories.filter(
                  (category) => category.group === group.id,
                )
                if (groupCategories.length === 0) return null
                return (
                  <div key={group.id} className="contents lg:block">
                    <div className="mb-1 mt-5 hidden px-2 text-[0.68em] font-bold uppercase tracking-[0.16em] text-primary-foreground/55 first:mt-0 rtl:tracking-normal lg:block">
                      {group.label}
                    </div>
                    {groupCategories.map((category) => {
                      const active = category.id === selectedCategory.id
                      return (
                        <button
                          key={category.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setActivePanel(category.panels[0].id)}
                          className={`flex min-h-11 shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-start text-sm transition-colors lg:mb-0.5 lg:w-full ${
                            active
                              ? 'bg-surface font-semibold text-primary shadow-sm'
                              : 'text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground'
                          }`}
                        >
                          <span>{category.label}</span>
                          {category.panels.length > 1 && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[0.72em] ${
                                active
                                  ? 'bg-surface-tinted text-primary'
                                  : 'bg-white/10 text-primary-foreground/75'
                              }`}
                            >
                              {category.panels.length}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </nav>

          <nav
            aria-label={t('settings.navigation.controls')}
            className="max-h-64 overflow-y-auto border-b border-hairline lg:max-h-none lg:min-h-[620px] lg:border-b-0 lg:border-e"
          >
            <div className="border-b border-hairline px-4 py-4">
              <h2 className="font-semibold text-foreground">{selectedCategory.label}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('settings.navigation.controlsCount', {
                  count: selectedCategory.panels.length,
                })}
              </p>
            </div>
            {selectedCategory.panels.map((panel) => {
              const active = panel.id === selectedPanelId
              return (
                <button
                  key={panel.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setActivePanel(panel.id)}
                  className={`block min-h-[4.5rem] w-full border-b border-hairline border-s-4 px-4 py-3 text-start transition-colors ${
                    active
                      ? 'border-s-primary bg-primary/5'
                      : 'border-s-transparent hover:bg-surface-tinted'
                  }`}
                >
                  <span className="block text-sm font-semibold text-foreground">
                    {panel.title}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                    {panel.description}
                  </span>
                </button>
              )
            })}
          </nav>

          <section
            aria-label={panels[selectedPanelId].title}
            className="min-w-0 bg-surface-raised p-3 sm:p-4"
          >
            {isLoading && selectedPanelId !== 'account' && selectedPanelId !== 'system'
              ? settingsSkeleton
              : renderSelectedPanel()}
          </section>
        </div>
      </div>
    </div>
  )
}
