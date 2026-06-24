/**
 * EmailSection — IONOS IMAP account, signature, linked-employee. TAMM redesign.
 *
 * Renders three sub-cards inside a single Email integration SectionCard:
 *   1. Account config (email / username / password / folders / sync interval)
 *   2. Linked employee (single FK on EmailAccount.linked_employee_id)
 *   3. Signature (delegated to SignatureSection)
 *
 * IONOS-only: imap_host/smtp_host are baked in at save-time. Password is
 * masked and only sent when the user changes it.
 */

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Mail,
  RefreshCw,
  Plug,
  Trash2,
  Loader2,
  Eye,
  EyeOff,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import type { EmailAccountUpsert } from '@/lib/api'
import { useIdentity } from '@/lib/useIdentity'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmployeePicker } from '@/pages/application/EmployeePicker'
import { SignatureSection } from './SignatureSection'

const DEFAULTS: EmailAccountUpsert = {
  email: '',
  imap_host: 'imap.ionos.com',
  imap_port: 993,
  use_ssl: true,
  username: '',
  password: '',
  smtp_host: 'smtp.ionos.com',
  smtp_port: 587,
  smtp_use_tls: true,
  sent_folder: 'Sent',
  inbox_folder: 'INBOX',
  enabled: true,
  sync_interval_minutes: 5,
}

// ---------------------------------------------------------------------------
// Inline pill button helpers — TAMM vocabulary
// ---------------------------------------------------------------------------

const OUTLINE_PILL =
  'inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2 text-[0.82em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY_PILL =
  'inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-[0.85em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
const DESTRUCTIVE_PILL =
  'inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[0.82em] font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
const INPUT_BASE =
  'w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[0.9em] text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15'

// ---------------------------------------------------------------------------
// EmailSection
// ---------------------------------------------------------------------------

export function EmailSection(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const qc = useQueryClient()

  const accountQuery = useQuery({
    queryKey: ['email-account'],
    queryFn: () => api.getEmailAccount(),
    staleTime: 5_000,
  })

  const { identity, isAdmin } = useIdentity()
  const [linkPickerId, setLinkPickerId] = useState<string | null>(null)
  const [isChangingLink, setIsChangingLink] = useState(false)

  const [form, setForm] = useState<EmailAccountUpsert>(DEFAULTS)
  const [showPassword, setShowPassword] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  useEffect(() => {
    if (accountQuery.data) {
      setForm({
        email: accountQuery.data.email,
        imap_host: accountQuery.data.imap_host,
        imap_port: accountQuery.data.imap_port,
        use_ssl: accountQuery.data.use_ssl,
        username: accountQuery.data.username,
        password: '', // never echoed back
        smtp_host: accountQuery.data.smtp_host,
        smtp_port: accountQuery.data.smtp_port,
        smtp_use_tls: accountQuery.data.smtp_use_tls,
        sent_folder: accountQuery.data.sent_folder,
        inbox_folder: accountQuery.data.inbox_folder,
        enabled: accountQuery.data.enabled,
        sync_interval_minutes: accountQuery.data.sync_interval_minutes,
      })
    }
  }, [accountQuery.data])

  const saveMutation = useMutation({
    mutationFn: (body: EmailAccountUpsert) => api.upsertEmailAccount(body),
    onSuccess: () => {
      toast.success(t('settings.email.saved', { defaultValue: 'Email settings saved' }))
      void qc.invalidateQueries({ queryKey: ['email-account'] })
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  const testMutation = useMutation({
    mutationFn: () => api.testEmailConnection(),
    onSuccess: () =>
      toast.success(
        t('settings.email.testOk', { defaultValue: 'Connection successful' }),
      ),
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  const syncMutation = useMutation({
    mutationFn: () => api.syncEmail(),
    onSuccess: (r) => {
      toast.success(
        t('settings.email.syncOk', {
          imported: r.imported,
          skipped: r.skipped_duplicate,
          defaultValue: 'Imported {{imported}}, skipped {{skipped}}',
        }),
      )
      void qc.invalidateQueries({ queryKey: ['email-account'] })
      void qc.invalidateQueries({ queryKey: ['ledger'] })
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteEmailAccount(),
    onSuccess: () => {
      toast.success(t('settings.email.deleted', { defaultValue: 'Email account removed' }))
      setForm(DEFAULTS)
      void qc.invalidateQueries({ queryKey: ['email-account'] })
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  const linkMutation = useMutation({
    mutationFn: (employee_id: string | null) =>
      api.upsertEmailAccount({
        ...form,
        imap_host: 'imap.ionos.com',
        imap_port: 993,
        use_ssl: true,
        smtp_host: 'smtp.ionos.com',
        smtp_port: 587,
        smtp_use_tls: true,
        linked_employee_id: employee_id,
        password: undefined,
      }),
    onSuccess: (acc) => {
      const wasAdminVacant = !identity?.is_admin && !identity?.linked
      if (wasAdminVacant && acc.linked_employee_id) {
        toast.success(
          t('settings.email.linkAdminGranted', {
            name: acc.linked_employee_id,
            id: acc.linked_employee_id,
          }),
        )
      } else if (acc.linked_employee_id) {
        toast.success(
          t('settings.email.linkSuccess', {
            name: acc.linked_employee_id,
            id: acc.linked_employee_id,
          }),
        )
      }
      void qc.invalidateQueries({ queryKey: ['email-account'] })
      void qc.invalidateQueries({ queryKey: ['identity'] })
      setIsChangingLink(false)
      setLinkPickerId(null)
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  const update = <K extends keyof EmailAccountUpsert>(
    key: K,
    value: EmailAccountUpsert[K],
  ): void => {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const handleSave = (): void => {
    // Bake IONOS defaults into every payload — GSSG is IONOS-only.
    // Send `password` only if non-empty (preserves existing on PATCH-like edits).
    const payload: EmailAccountUpsert = {
      ...form,
      imap_host: 'imap.ionos.com',
      imap_port: 993,
      use_ssl: true,
      smtp_host: 'smtp.ionos.com',
      smtp_port: 587,
      smtp_use_tls: true,
      // Preserve the linked employee — Save shouldn't clear an existing link.
      // The dedicated linkMutation owns changes to this field.
      linked_employee_id: accountQuery.data?.linked_employee_id ?? null,
    }
    if (!payload.password) delete (payload as Record<string, unknown>).password
    saveMutation.mutate(payload)
  }

  const hasAccount = !!accountQuery.data

  return (
    <section className="rounded-2xl bg-surface p-6">
      {/* Section header */}
      <div className="mb-4 border-b border-hairline pb-4">
        <h3 className="text-[1.05em] font-semibold tracking-tight text-foreground">
          {t('settings.email.heading')}
        </h3>
        <p className="mt-1 text-[0.86em] text-muted-foreground">
          {t('settings.email.description')}
        </p>
      </div>

      {/* IONOS-only notice */}
      <div className="mb-5 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-[0.82em] text-warning">
        <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
        <span>{t('settings.email.ionosOnly')}</span>
      </div>

      {/* Account form */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="email-address"
            className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
          >
            {t('settings.email.address', { defaultValue: 'Email address' })}
            <span className="ms-0.5 text-accent">*</span>
          </label>
          <input
            id="email-address"
            type="email"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            placeholder="ahmed.m@gssg.ae"
            className={INPUT_BASE}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="email-username"
            className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
          >
            {t('settings.email.username', { defaultValue: 'IMAP username' })}
            <span className="ms-0.5 text-accent">*</span>
          </label>
          <input
            id="email-username"
            value={form.username}
            onChange={(e) => update('username', e.target.value)}
            placeholder="ahmed.m@gssg.ae"
            className={INPUT_BASE}
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label
            htmlFor="email-password"
            className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
          >
            {t('settings.email.password', { defaultValue: 'Password' })}
            {!hasAccount && <span className="ms-0.5 text-accent">*</span>}
          </label>
          <div className="relative">
            <input
              id="email-password"
              type={showPassword ? 'text' : 'password'}
              value={form.password ?? ''}
              onChange={(e) => update('password', e.target.value)}
              placeholder={
                hasAccount
                  ? '••••••••  ' +
                    t('settings.email.passwordKeep', {
                      defaultValue: '(leave blank to keep current)',
                    })
                  : ''
              }
              className={`${INPUT_BASE} pe-10`}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
              aria-label={
                showPassword
                  ? t('settings.email.hidePassword', { defaultValue: 'Hide password' })
                  : t('settings.email.showPassword', { defaultValue: 'Show password' })
              }
              tabIndex={-1}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" strokeWidth={1.7} />
              ) : (
                <Eye className="h-4 w-4" strokeWidth={1.7} />
              )}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="email-inbox"
            className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
          >
            {t('settings.email.inboxFolder', { defaultValue: 'Inbox folder' })}
          </label>
          <input
            id="email-inbox"
            value={form.inbox_folder}
            onChange={(e) => update('inbox_folder', e.target.value)}
            className={INPUT_BASE}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="email-sent"
            className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
          >
            {t('settings.email.sentFolder', { defaultValue: 'Sent folder' })}
          </label>
          <input
            id="email-sent"
            value={form.sent_folder}
            onChange={(e) => update('sent_folder', e.target.value)}
            className={INPUT_BASE}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <label className="flex cursor-pointer items-center gap-2.5 text-[0.86em] text-foreground">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => update('enabled', e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          {t('settings.email.enabled', { defaultValue: 'Enable sync' })}
        </label>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="email-sync-interval"
            className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
          >
            {t('settings.email.syncInterval', {
              defaultValue: 'Background sync interval',
            })}
          </label>
          <div className="flex items-center gap-2.5">
            <input
              id="email-sync-interval"
              type="number"
              min={0}
              max={1440}
              step={1}
              value={form.sync_interval_minutes ?? 5}
              onChange={(e) =>
                update('sync_interval_minutes', Math.max(0, Number(e.target.value)))
              }
              className={`${INPUT_BASE} w-28`}
              disabled={!form.enabled}
            />
            <span className="text-[0.82em] text-muted-foreground">
              {t('settings.email.syncIntervalSuffix')}
            </span>
          </div>
        </div>
      </div>

      {/* Status row */}
      {hasAccount && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline bg-surface-tinted px-3.5 py-2.5 text-[0.82em] text-muted-foreground">
          <span>
            {accountQuery.data?.last_synced_at
              ? t('settings.email.lastSynced', {
                  date: new Date(accountQuery.data.last_synced_at).toLocaleString(),
                  count: accountQuery.data.last_sync_count,
                  defaultValue: 'Last synced {{date}} · {{count}} imported',
                })
              : t('settings.email.neverSynced', { defaultValue: 'Never synced' })}
          </span>
          {accountQuery.data?.last_sync_error && (
            <span className="text-accent">
              {t('settings.email.lastError', { defaultValue: 'Last error' })}:{' '}
              {accountQuery.data.last_sync_error}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-5 flex flex-wrap items-center gap-2.5 border-t border-hairline pt-4">
        <button
          type="button"
          className={PRIMARY_PILL}
          onClick={handleSave}
          disabled={
            saveMutation.isPending ||
            !form.email ||
            !form.username ||
            (!hasAccount && !form.password)
          }
        >
          {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('common.save')}
        </button>
        {hasAccount && (
          <>
            <button
              type="button"
              className={OUTLINE_PILL}
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
            >
              {testMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plug className="h-3.5 w-3.5" strokeWidth={1.7} />
              )}
              {t('settings.email.test', { defaultValue: 'Test connection' })}
            </button>
            <button
              type="button"
              className={OUTLINE_PILL}
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending || !form.enabled}
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} />
              )}
              {t('settings.email.syncNow', { defaultValue: 'Sync now' })}
            </button>
            {isAdmin && (
              <button
                type="button"
                className={`${DESTRUCTIVE_PILL} ms-auto`}
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                {t('common.delete')}
              </button>
            )}
          </>
        )}
      </div>

      {/* Linked employee sub-card */}
      {hasAccount && (
        <div className="mt-5 rounded-lg border border-hairline bg-surface-raised p-4">
          {identity?.linked && !isChangingLink ? (
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft text-primary">
                {identity.photo_url ? (
                  <img
                    src={identity.photo_url}
                    alt=""
                    className="h-12 w-12 rounded-full object-cover"
                  />
                ) : (
                  <span className="text-base font-semibold">
                    {identity.name_en?.[0] ?? '?'}
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {t('settings.email.linkedHeading')}
                </div>
                <div className="text-[0.95em] font-semibold text-foreground">
                  {(isAr ? identity.name_ar : identity.name_en) ?? identity.name_en}{' '}
                  <span className="font-mono text-[0.78em] text-muted-foreground">
                    ({identity.employee_id})
                  </span>
                </div>
                <div className="text-[0.82em] text-muted-foreground">
                  {identity.position}
                  {identity.role === 'admin' && (
                    <>
                      {' · '}
                      <span className="font-semibold text-primary">
                        {t('settings.email.adminBadge')}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                className={OUTLINE_PILL}
                disabled={!isAdmin}
                onClick={() => setIsChangingLink(true)}
                title={!isAdmin ? t('settings.email.linkAdminOnly') : undefined}
              >
                {t('settings.email.changeLink')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <div className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {t('settings.email.linkHeading')}
                </div>
                <p className="text-[0.82em] text-muted-foreground">
                  {t('settings.email.linkHint')}
                </p>
              </div>
              <EmployeePicker selectedId={linkPickerId} onSelect={setLinkPickerId} />
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  className={PRIMARY_PILL}
                  disabled={!linkPickerId || linkMutation.isPending}
                  onClick={() => linkPickerId && linkMutation.mutate(linkPickerId)}
                >
                  {linkMutation.isPending && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {t('settings.email.linkButton')}
                </button>
                {isChangingLink && (
                  <button
                    type="button"
                    className={OUTLINE_PILL}
                    onClick={() => {
                      setIsChangingLink(false)
                      setLinkPickerId(null)
                    }}
                  >
                    {t('settings.email.skipLink')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Signature sub-card */}
      {hasAccount && (
        <div className="mt-5">
          <SignatureSection />
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={t('settings.email.confirmDelete', {
          defaultValue: 'Remove email account?',
        })}
        description={t('settings.email.confirmDeleteDesc', {
          defaultValue: 'This will remove the email account and stop syncing.',
        })}
        confirmLabel={t('common.delete')}
        onConfirm={() => deleteMutation.mutate()}
        destructive
      />
    </section>
  )
}
