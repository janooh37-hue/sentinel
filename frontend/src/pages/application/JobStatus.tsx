/**
 * JobStatus — polls GET /api/v1/jobs/{jobId} until done or failed.
 *
 * Polling schedule: 500 ms for the first 5 s, then 2 s thereafter.
 * On done: renders DocPreview + download buttons.
 * On failed: renders the error message with code.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle } from 'lucide-react'

import { api } from '@/lib/api'
import type { JobStatusResponse } from '@/lib/api'
import { Progress } from '@/components/ui/progress'
import { useFakeProgress, useReducedMotion } from '@/lib/useFakeProgress'
import { DocPreview } from './DocPreview'

interface JobStatusProps {
  jobId: string
  onDone?: (job: JobStatusResponse) => void
}

export function JobStatus({ jobId, onDone }: JobStatusProps): React.JSX.Element {
  const { t } = useTranslation()
  const [job, setJob] = useState<JobStatusResponse | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [gaveUp, setGaveUp] = useState(false)
  const reducedMotion = useReducedMotion()

  const startTime = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const errorCountRef = useRef(0)

  // Keep the latest onDone in a ref so the (jobId-keyed) poll effect always
  // calls the current callback, not the one captured when polling started.
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  // Stop retrying after this many consecutive poll failures so a downed
  // server doesn't keep the timer alive indefinitely.
  const MAX_POLL_ERRORS = 5

  useEffect(() => {
    mountedRef.current = true
    startTime.current = Date.now()
    errorCountRef.current = 0

    function scheduleNext(): void {
      const elapsed = Date.now() - startTime.current
      const interval = elapsed < 5_000 ? 500 : 2_000
      timerRef.current = setTimeout(poll, interval)
    }

    async function poll(): Promise<void> {
      if (!mountedRef.current) return
      try {
        const result = await api.getJob(jobId)
        if (!mountedRef.current) return
        errorCountRef.current = 0
        setJob(result)
        if (result.status === 'done') {
          onDoneRef.current?.(result)
        } else if (result.status !== 'failed') {
          scheduleNext()
        }
      } catch {
        if (!mountedRef.current) return
        errorCountRef.current += 1
        setPollError(t('errors.network'))
        // Keep trying on transient network hiccups, but give up after a
        // bounded number of consecutive failures (e.g. server down).
        if (errorCountRef.current < MAX_POLL_ERRORS) {
          scheduleNext()
        } else {
          setGaveUp(true)
        }
      }
    }

    void poll()

    return () => {
      mountedRef.current = false
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  const status = job?.status ?? 'queued'
  const isWorking = status === 'queued' || status === 'running'
  const isDone = status === 'done'
  const isFailed = status === 'failed' || gaveUp

  // Fake-fast progress for the generate wait. `active` drives the fast-fill +
  // crawl; `done` snaps to 100 and holds. On failure/give-up `active` drops
  // and the bar hides cleanly with no snap. `visible` stays true through the
  // brief 100% hold, so we keep the bar mounted until it self-hides before
  // swapping in the rendered preview.
  const progress = useFakeProgress({
    active: isWorking && !gaveUp,
    done: isDone,
    reducedMotion,
  })

  // --- loading / queued / running (and the brief 100% hold after done) ---
  if ((isWorking || (isDone && progress.visible)) && !isFailed) {
    return (
      <GenerateProgress
        value={progress.value}
        label={t(`application.jobStatus.${isDone ? 'done' : status}`)}
        error={pollError}
      />
    )
  }

  // --- failed (job reported failure, or we gave up polling) ---
  if (isFailed) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" strokeWidth={1.8} />
        <div>
          <p className="text-sm font-medium text-foreground">
            {t('application.jobStatus.failed')}
          </p>
          {job?.error_code && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">{job.error_code}</p>
          )}
          {job?.error_message ? (
            <p className="mt-1 text-xs text-destructive">{job.error_message}</p>
          ) : (
            pollError && <p className="mt-1 text-xs text-destructive">{pollError}</p>
          )}
        </div>
      </div>
    )
  }

  // --- done (after the progress bar's 100% hold has elapsed) ---
  return <DocPreview documents={job?.documents ?? []} />
}

/** The generate/preview wait: a fake-fast progress bar with a status label.
 * The numeric value comes from useFakeProgress; this component is presentation
 * only. The bar fills from the inline-start (right in RTL via the Progress
 * component's direction-aware indicator). */
function GenerateProgress({
  value,
  label,
  error,
}: {
  value: number
  label: string
  error: string | null
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="w-full max-w-xs">
        <Progress
          value={value}
          aria-label={label}
          aria-valuetext={label}
        />
        <p className="mt-3 text-sm text-muted-foreground">{label}</p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  )
}
