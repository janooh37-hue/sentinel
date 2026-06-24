/**
 * MigrationWizard — v3 → v4 data import modal.
 *
 * Steps:
 *   1. Welcome
 *   2. Pick data dir (prefilled if v3_data_dir_detected is non-null)
 *   3. Preview (dry-run counts)
 *   4. Importing (real run, spinner)
 *   5. Summary (done)
 *
 * Skip: stores `gssg.migration.skipped` in localStorage so the wizard
 * doesn't re-appear this session.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, type MigrationResult, type MigrationStatus } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MIGRATION_SKIPPED_KEY = 'gssg.migration.skipped'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = 'welcome' | 'pickPath' | 'preview' | 'importing' | 'summary'

// ---------------------------------------------------------------------------
// CountRow helper
// ---------------------------------------------------------------------------

function CountRow({
  label,
  value,
}: {
  label: string
  value: number
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-semibold text-foreground">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEP_KEYS: Step[] = ['welcome', 'pickPath', 'preview', 'importing', 'summary']

function StepDots({ current }: { current: Step }): React.JSX.Element {
  const idx = STEP_KEYS.indexOf(current)
  return (
    <div className="flex items-center justify-center gap-1.5 pt-1">
      {STEP_KEYS.map((s, i) => (
        <span
          key={s}
          className={cn(
            'h-1.5 rounded-full transition-all',
            i === idx
              ? 'w-4 bg-primary'
              : i < idx
                ? 'w-1.5 bg-primary/40'
                : 'w-1.5 bg-border',
          )}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface MigrationWizardProps {
  /** Called when wizard is dismissed (skip or done). */
  onClose: () => void
  /** Pre-detected v3 data dir from the status call. */
  detectedDir: string | null
}

export function MigrationWizard({
  onClose,
  detectedDir,
}: MigrationWizardProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')

  const [step, setStep] = useState<Step>('welcome')
  const [v3Path, setV3Path] = useState(detectedDir ?? '')
  const [previewResult, setPreviewResult] = useState<MigrationResult | null>(null)
  const [finalResult, setFinalResult] = useState<MigrationResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false)

  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  function handleSkip(): void {
    setSkipConfirmOpen(true)
  }

  // Dialog hardening: initial focus, focus trap, and Escape-to-dismiss (routes
  // through the skip-confirm flow). Mirrors the AccessRequests Modal. Suspended
  // while the nested skip-confirm dialog is open so it owns focus/Escape.
  useEffect(() => {
    if (skipConfirmOpen) return
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    )
    ;(first ?? panel)?.focus()

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleSkip()
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
    return () => document.removeEventListener('keydown', onKeyDown)
    // step is a dep so focus re-lands on the first control of each new step.
  }, [step, skipConfirmOpen])

  function handleSkipConfirmed(): void {
    try {
      localStorage.setItem(MIGRATION_SKIPPED_KEY, 'true')
    } catch {
      // localStorage may be unavailable in some environments.
    }
    onClose()
  }

  async function handleDryRun(): Promise<void> {
    setErrorMsg(null)
    setBusy(true)
    try {
      const result = await api.migrateV3({ v3_data_dir: v3Path.trim(), dry_run: true })
      setPreviewResult(result)
      setStep('preview')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      toast.error(t('migration.error.heading') + ': ' + msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleRealRun(): Promise<void> {
    setErrorMsg(null)
    setBusy(true)
    setStep('importing')
    try {
      const result = await api.migrateV3({ v3_data_dir: v3Path.trim(), dry_run: false })
      setFinalResult(result)
      setStep('summary')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setStep('preview')
      toast.error(t('migration.error.heading') + ': ' + msg)
    } finally {
      setBusy(false)
    }
  }

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  function renderWelcome(): React.JSX.Element {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {t('migration.welcome.title')}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            {t('migration.welcome.subtitle')}
          </p>
        </div>
        <div className="flex justify-between pt-2">
          <Button variant="secondary" size="sm" onClick={handleSkip}>
            {t('migration.buttons.skip')}
          </Button>
          <Button size="sm" onClick={() => setStep('pickPath')}>
            {t('migration.buttons.next')}
          </Button>
        </div>
      </div>
    )
  }

  function renderPickPath(): React.JSX.Element {
    return (
      <div className="space-y-4">
        <div>
          <label htmlFor="v3-path-input" className="block text-xs font-medium text-foreground mb-1.5">
            {t('migration.pickPath.label')}
          </label>
          <input
            id="v3-path-input"
            type="text"
            value={v3Path}
            onChange={(e) => setV3Path(e.target.value)}
            placeholder={t('migration.pickPath.placeholder')}
            dir="ltr"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {errorMsg && (
          <p className="text-xs text-destructive">{errorMsg}</p>
        )}
        <div className="flex justify-between pt-2">
          <Button variant="secondary" size="sm" onClick={() => setStep('welcome')}>
            {t('migration.buttons.back')}
          </Button>
          <Button size="sm" disabled={!v3Path.trim() || busy} onClick={() => void handleDryRun()}>
            {busy ? t('common.loading') : t('migration.buttons.next')}
          </Button>
        </div>
      </div>
    )
  }

  function renderPreview(): React.JSX.Element {
    const r = previewResult!
    return (
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">
          {t('migration.preview.heading')}
        </h2>
        <div className="rounded-md border border-border bg-muted/20 px-4 py-2">
          <CountRow label={t('migration.counts.employees')} value={r.employees} />
          <CountRow label={t('migration.counts.leaves')} value={r.leaves} />
          <CountRow label={t('migration.counts.books')} value={r.books} />
          <CountRow label={t('migration.counts.vaultFiles')} value={r.vault_files} />
          <CountRow label={t('migration.counts.violations')} value={r.violations} />
        </div>
        {errorMsg && (
          <p className="text-xs text-destructive">{errorMsg}</p>
        )}
        <div className="flex justify-between pt-2">
          <Button variant="secondary" size="sm" onClick={() => setStep('pickPath')} disabled={busy}>
            {t('migration.buttons.back')}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void handleRealRun()}>
            {busy ? t('common.loading') : t('migration.buttons.proceed')}
          </Button>
        </div>
      </div>
    )
  }

  function renderImporting(): React.JSX.Element {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-6">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground">{t('migration.importing.status')}</p>
      </div>
    )
  }

  function renderSummary(): React.JSX.Element {
    const r = finalResult!
    const detail = t('migration.summary.detail', {
      employees: r.employees,
      leaves: r.leaves,
      books: r.books,
      backup: r.backup_path ?? '—',
    })
    return (
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">
          {t('migration.summary.heading')}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{detail}</p>
        <div className="flex justify-end pt-2">
          <Button size="sm" onClick={onClose}>
            {t('migration.buttons.done')}
          </Button>
        </div>
      </div>
    )
  }

  // -----------------------------------------------------------------------
  // Modal shell
  // -----------------------------------------------------------------------

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        dir={isAr ? 'rtl' : 'ltr'}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

        {/* Dialog */}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="relative z-10 w-full max-w-md rounded-xl border border-border bg-background shadow-2xl p-6 space-y-5 mx-4 focus:outline-none"
        >
          <h2 id={titleId} className="sr-only">
            {t('migration.welcome.title')}
          </h2>
          <StepDots current={step} />

          {step === 'welcome' && renderWelcome()}
          {step === 'pickPath' && renderPickPath()}
          {step === 'preview' && renderPreview()}
          {step === 'importing' && renderImporting()}
          {step === 'summary' && renderSummary()}
        </div>
      </div>

      <ConfirmDialog
        open={skipConfirmOpen}
        onOpenChange={setSkipConfirmOpen}
        title={t('migration.skip.title', { defaultValue: 'Skip migration?' })}
        description={t('migration.skip.confirm')}
        confirmLabel={t('migration.buttons.skip')}
        onConfirm={handleSkipConfirmed}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// MigrationGate — wraps the app and shows the wizard on first launch
// ---------------------------------------------------------------------------

interface MigrationGateProps {
  children: React.ReactNode
}

export function MigrationGate({ children }: MigrationGateProps): React.JSX.Element {
  const [dismissed, setDismissed] = useState(false)

  const statusQuery = useQuery<MigrationStatus>({
    queryKey: ['migration-status'],
    queryFn: () => api.getMigrationStatus(),
    // Don't retry on error — a missing/slow server shouldn't block the UI.
    retry: false,
  })

  const skipped = (() => {
    try { return localStorage.getItem(MIGRATION_SKIPPED_KEY) === 'true' } catch { return false }
  })()

  const status = statusQuery.data
  const loaded = !statusQuery.isPending
  const showWizard =
    loaded &&
    !dismissed &&
    !skipped &&
    status !== undefined &&
    !status.has_data

  return (
    <>
      {children}
      {showWizard && (
        <MigrationWizard
          detectedDir={status!.v3_data_dir_detected}
          onClose={() => setDismissed(true)}
        />
      )}
    </>
  )
}
