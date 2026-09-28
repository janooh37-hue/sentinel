/**
 * Debug Console — admin-only window into the running server: health checks
 * with plain-language hints, grouped "silent" errors, raw log tails, recent
 * API requests, and one-click AI diagnosis (server's logged-in claude/codex
 * CLI) or a copy-ready prompt for any chat AI.
 */

import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ClipboardCopy,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  apiErrorMessage,
  debugApi,
  type DebugAskBody,
  type DebugCheck,
  type DebugDiagnosis,
  type DebugIssue,
  type DebugLogEntry,
  type DebugLogSource,
  type DebugMachine,
} from '@/lib/api'
import { copyToClipboard } from '@/lib/clipboard'

const STATUS_STYLE: Record<DebugCheck['status'], { Icon: typeof CheckCircle2; cls: string }> = {
  ok: { Icon: CheckCircle2, cls: 'text-success bg-success-soft' },
  warn: { Icon: AlertTriangle, cls: 'text-caution bg-caution-soft' },
  fail: { Icon: XCircle, cls: 'text-destructive bg-destructive/10' },
}

const LEVEL_CLS: Record<string, string> = {
  DEBUG: 'text-faint',
  INFO: 'text-info',
  WARNING: 'text-caution',
  ERROR: 'text-destructive',
  CRITICAL: 'text-destructive font-bold',
}

const mono = 'font-mono text-[0.8em] leading-relaxed'

function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`
}

function fmtDuration(s: number): string {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(' ')
}

async function copy(text: string, ok: string): Promise<void> {
  if (await copyToClipboard(text)) toast.success(ok)
  else toast.error('Clipboard unavailable')
}

// ── AI helpers ───────────────────────────────────────────────────────────────
interface Ai {
  engines: ('claude' | 'codex')[]
  runsAs: string | null | undefined
  engine: 'claude' | 'codex' | null
  setEngine: (e: 'claude' | 'codex') => void
  /** Current/last AI run; runs happen server-side and are polled. */
  job: DebugDiagnosis | null
  running: boolean
  start: (body: DebugAskBody) => void
  clear: () => void
  copyPrompt: (body: DebugAskBody) => Promise<void>
}

function useAi(): Ai {
  const { t } = useTranslation()
  const engines = useQuery({ queryKey: ['debug', 'ai'], queryFn: debugApi.ai, staleTime: 60_000 })
  const [jobId, setJobId] = useState<string | null>(null)
  const [picked, setEngine] = useState<'claude' | 'codex' | null>(null)
  const available = engines.data?.engines ?? []
  const engine = picked && available.includes(picked) ? picked : (available[0] ?? null)
  const start = useMutation({
    mutationFn: (body: DebugAskBody) => debugApi.diagnose(body),
    onSuccess: (j) => setJobId(j.id),
    onError: (e) => toast.error(apiErrorMessage(e)),
  })
  const job = useQuery({
    queryKey: ['debug', 'diagnosis', jobId],
    queryFn: () => debugApi.diagnosis(jobId ?? ''),
    enabled: jobId !== null,
    refetchInterval: (q) => (q.state.data?.status === 'running' || !q.state.data ? 3000 : false),
  })
  const copyPrompt = async (body: DebugAskBody): Promise<void> => {
    try {
      const { prompt } = await debugApi.prompt(body)
      await copy(prompt, t('debug.ai.copied'))
    } catch (e) {
      toast.error(apiErrorMessage(e))
    }
  }
  const current = jobId ? (job.data ?? null) : null
  return {
    engines: available,
    runsAs: engines.data?.runs_as,
    engine,
    setEngine,
    job: current,
    running: start.isPending || (jobId !== null && current?.status !== 'done' && current?.status !== 'failed'),
    start: (body) => start.mutate({ ...body, engine }),
    clear: () => setJobId(null),
    copyPrompt,
  }
}

function AiButtons({ ai, body, compact }: { ai: Ai; body: DebugAskBody; compact?: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const available = ai.engines.length > 0
  const busy = ai.running && (ai.job?.issue_id ?? null) === (body.issue_id ?? null)
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size={compact ? 'xs' : 'sm'}
        disabled={!available || ai.running}
        title={available ? t('debug.ai.askHint', { engine: ai.engine }) : t('debug.ai.noEngine')}
        onClick={() => ai.start(body)}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Bot className="h-3.5 w-3.5" aria-hidden />}
        {busy ? t('debug.ai.thinking') : t('debug.ai.ask')}
      </Button>
      {ai.engines.length > 1 ? (
        <select
          aria-label={t('debug.ai.engine')}
          value={ai.engine ?? ''}
          onChange={(e) => ai.setEngine(e.target.value as 'claude' | 'codex')}
          disabled={ai.running}
          className={`rounded-lg border border-border bg-surface px-2 text-[0.85em] ${compact ? 'h-7' : 'h-8'}`}
        >
          {ai.engines.map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>
      ) : null}
      <Button size={compact ? 'xs' : 'sm'} variant="outline" onClick={() => void ai.copyPrompt(body)}>
        <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
        {t('debug.ai.copy')}
      </Button>
    </div>
  )
}

function Elapsed({ since }: { since: string }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return <span dir="ltr">{Math.max(0, Math.round((now - Date.parse(since)) / 1000))} s</span>
}

function DiagnosisPanel({ ai }: { ai: Ai }): React.JSX.Element | null {
  const { t } = useTranslation()
  const job = ai.job
  if (!job) return null
  return (
    <section className="rounded-xl border border-primary/30 bg-primary-soft/40 p-4" aria-live="polite">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {job.status === 'running' ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
        ) : (
          <Bot className="h-4 w-4 text-primary" aria-hidden />
        )}
        <h2 className="font-semibold">
          {job.status === 'running' ? (
            <>
              {t('debug.ai.thinking')} · {job.engine} · <Elapsed since={job.at} />
            </>
          ) : (
            t('debug.ai.result', { engine: job.engine, seconds: job.seconds })
          )}
        </h2>
        <div className="ms-auto flex gap-2">
          {job.output ? (
            <Button size="xs" variant="outline" onClick={() => void copy(job.output ?? '', t('debug.copied'))}>
              <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
              {t('debug.copy')}
            </Button>
          ) : null}
          {job.status !== 'running' ? (
            <Button size="xs" variant="ghost" onClick={ai.clear}>
              {t('debug.close')}
            </Button>
          ) : null}
        </div>
      </div>
      {job.status === 'running' ? <p className="text-[0.9em] text-muted-foreground">{t('debug.ai.running')}</p> : null}
      {job.error ? <p className="text-destructive" dir="auto">{job.error}</p> : null}
      {job.output ? (
        <div dir="auto" className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-[0.9em] leading-relaxed">
          {job.output}
        </div>
      ) : null}
    </section>
  )
}

// ── Server machine panel ─────────────────────────────────────────────────────
interface Sample { at: number; cpu: number | null; ram: number | null; rx: number | null; tx: number | null }

function Sparkline({ values, label }: { values: (number | null)[]; label: string }): React.JSX.Element {
  const pts = values
    .map((v, i) => (v == null ? null : `${(i / Math.max(1, values.length - 1)) * 100},${30 - (Math.min(100, v) / 100) * 30}`))
    .filter(Boolean)
    .join(' ')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full text-primary" role="img" aria-label={label}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Meter({ label, pct, detail, history }: { label: string; pct: number | null; detail: string; history: (number | null)[] }): React.JSX.Element {
  const tone = pct == null ? 'bg-faint' : pct >= 95 ? 'bg-destructive' : pct >= 85 ? 'bg-caution' : 'bg-success'
  return (
    <div className="rounded-lg border border-hairline p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{label}</span>
        <span className="font-mono text-[1.1em] font-bold" dir="ltr">{pct == null ? '—' : `${pct.toFixed(0)}%`}</span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-surface-tinted"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
      >
        <div className={`h-full ${tone} transition-[width]`} style={{ inlineSize: `${pct ?? 0}%` }} />
      </div>
      <p className={`mt-1.5 text-muted-foreground ${mono}`} dir="ltr">{detail}</p>
      <Sparkline values={history} label={label} />
    </div>
  )
}

function MachinePanel({ machine, history }: { machine: DebugMachine; history: Sample[] }): React.JSX.Element {
  const { t } = useTranslation()
  const ramPct = machine.ram_total_bytes && machine.ram_available_bytes != null
    ? (1 - machine.ram_available_bytes / machine.ram_total_bytes) * 100
    : null
  const [prev, last] = history.slice(-2)
  const secs = prev && last ? (last.at - prev.at) / 1000 : 0
  const rate = (a: number | null | undefined, b: number | null | undefined): string =>
    secs > 0 && a != null && b != null && b >= a ? `${fmtBytes((b - a) / secs)}/s` : '…'
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 font-semibold">{t('debug.machine.title')}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <Meter
          label={t('debug.machine.cpu')}
          pct={machine.cpu_percent}
          detail={`${machine.cpu_count ?? '?'} cores`}
          history={history.map((s) => s.cpu)}
        />
        <Meter
          label={t('debug.machine.ram')}
          pct={ramPct}
          detail={`${fmtBytes(machine.ram_available_bytes)} free / ${fmtBytes(machine.ram_total_bytes)}`}
          history={history.map((s) => s.ram)}
        />
      </div>
      <dl className={`mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 ${mono}`} dir="ltr">
        <dt className="text-muted-foreground">{t('debug.machine.uptime')}</dt>
        <dd>{machine.boot_uptime_seconds != null ? fmtDuration(machine.boot_uptime_seconds) : '—'}</dd>
        <dt className="text-muted-foreground">{t('debug.machine.network')}</dt>
        <dd>
          ↓ {rate(prev?.rx, last?.rx)} · ↑ {rate(prev?.tx, last?.tx)}
          <span className="text-muted-foreground"> ({fmtBytes(machine.net_received_bytes)} ↓ / {fmtBytes(machine.net_sent_bytes)} ↑ {t('debug.machine.sinceBoot')})</span>
        </dd>
      </dl>
      <h3 className="mb-2 mt-4 font-semibold">{t('debug.machine.services')}</h3>
      <ul className="flex flex-wrap gap-2">
        {Object.entries(machine.services).map(([name, state]) => {
          const cls = state === 'RUNNING' ? 'bg-success-soft text-success' : state === 'not installed' || state === 'n/a' ? 'bg-surface-tinted text-muted-foreground' : 'bg-destructive/10 text-destructive'
          return (
            <li key={name} className={`rounded-full px-3 py-1 text-[0.85em] font-medium ${cls}`} dir="ltr">
              {name}: {state}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ── Health tab ───────────────────────────────────────────────────────────────
function HealthTab({ ai }: { ai: Ai }): React.JSX.Element {
  const { t } = useTranslation()
  const [note, setNote] = useState('')
  const q = useQuery({ queryKey: ['debug', 'overview'], queryFn: debugApi.overview, refetchInterval: 5_000 })
  const [history, setHistory] = useState<Sample[]>([])
  const [seenAt, setSeenAt] = useState(0)
  const m = q.data?.machine
  if (m && q.dataUpdatedAt !== seenAt) {
    // Append one sample per fetch (React's "adjust state while rendering" pattern).
    // ponytail: history lives in the open tab only (last ~5 min); persist server-side if trends across days matter.
    const ram = m.ram_total_bytes && m.ram_available_bytes != null ? (1 - m.ram_available_bytes / m.ram_total_bytes) * 100 : null
    setSeenAt(q.dataUpdatedAt)
    setHistory((h) => [...h, { at: q.dataUpdatedAt, cpu: m.cpu_percent, ram, rx: m.net_received_bytes, tx: m.net_sent_bytes }].slice(-60))
  }
  if (q.isLoading) return <Loader2 className="m-8 h-6 w-6 animate-spin text-muted-foreground" aria-label={t('debug.loading')} />
  if (q.error || !q.data) return <p className="p-4 text-destructive">{apiErrorMessage(q.error)}</p>
  const { checks, stats, files, scheduler, crash_reports } = q.data
  const bad = checks.filter((c) => c.status !== 'ok').length
  const statRows: [string, string][] = [
    ['version', `${stats.version} · ${stats.git_branch ?? '?'}@${stats.git_commit ?? '?'}${stats.git_dirty ? ' (dirty)' : ''}`],
    ['uptime', `${fmtDuration(Number(stats.uptime_seconds))} (since ${stats.started_at})`],
    ['memory', fmtBytes(stats.memory_bytes as number | null)],
    ['threads', String(stats.threads)],
    ['pid', `${stats.pid} · ${stats.user ?? '?'}@${stats.hostname}`],
    ['python', `${stats.python} · ${stats.platform}`],
    ['mode', `dev_mode=${stats.dev_mode} · log_level=${stats.log_level}`],
    ['schema', `${stats.alembic_current} → head ${stats.alembic_head}`],
    ['disk', `${fmtBytes(stats.disk_free_bytes as number)} free / ${fmtBytes(stats.disk_total_bytes as number)}`],
    ['data', String(stats.data_dir)],
    ['crashes', `${crash_reports.count}${crash_reports.latest ? ` · latest ${crash_reports.latest}` : ''}`],
  ]
  return (
    <div className="flex flex-col gap-5">
      <section
        className={`flex flex-wrap items-center gap-3 rounded-xl p-4 ${bad ? 'bg-caution-soft' : 'bg-success-soft'}`}
        aria-live="polite"
      >
        {bad ? <AlertTriangle className="h-6 w-6 text-caution" aria-hidden /> : <CheckCircle2 className="h-6 w-6 text-success" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{bad ? t('debug.health.attention', { count: bad }) : t('debug.health.allGood')}</p>
          <p className="text-[0.85em] text-muted-foreground">{t('debug.health.autoRefresh')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? 'animate-spin' : ''}`} aria-hidden />
          {t('debug.refresh')}
        </Button>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-1 font-semibold">{t('debug.ai.wholeApp')}</h2>
        <p className="mb-3 text-[0.85em] text-muted-foreground">
          {ai.engines.length
            ? t('debug.ai.engineReady', { engines: ai.engines.join(', '), user: ai.runsAs ?? '?' })
            : t('debug.ai.noEngine')}
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          dir="auto"
          rows={2}
          placeholder={t('debug.ai.notePlaceholder')}
          className="mb-3 w-full rounded-lg border border-border bg-background p-2 text-[0.9em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <AiButtons ai={ai} body={{ issue_id: null, note }} />
      </section>

      <MachinePanel machine={q.data.machine} history={history} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {checks.map((c) => {
          const { Icon, cls } = STATUS_STYLE[c.status]
          return (
            <article key={c.id} className="flex gap-3 rounded-xl border border-border bg-surface p-4">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${cls}`}>
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold">{t(`debug.checks.${c.id}`, { defaultValue: c.label })}</h3>
                <p className={`${mono} break-words text-muted-foreground`} dir="ltr">{c.detail}</p>
                {c.hint ? <p className="mt-1 text-[0.85em]">{c.hint}</p> : null}
              </div>
            </article>
          )
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 font-semibold">{t('debug.health.stats')}</h2>
          <dl className={`grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 ${mono}`} dir="ltr">
            {statRows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 font-semibold">{t('debug.health.files')}</h2>
          <table className={`w-full ${mono}`} dir="ltr">
            <tbody>
              {Object.entries(files).map(([k, f]) => (
                <tr key={k} className="border-b border-hairline last:border-0">
                  <td className="py-1 pe-3 text-muted-foreground">{k}</td>
                  <td className="py-1 pe-3 text-end">{f.exists ? fmtBytes(f.size_bytes) : '—'}</td>
                  <td className="py-1 text-muted-foreground">{f.modified ?? t('debug.missing')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2 className="mb-2 mt-5 font-semibold">
            {t('debug.health.jobs')} {scheduler.running ? `(${scheduler.jobs.length})` : `— ${t('debug.health.stopped')}`}
          </h2>
          <ul className={`max-h-64 overflow-auto ${mono}`} dir="ltr">
            {scheduler.jobs.map((j) => (
              <li key={j.id} className="flex justify-between gap-3 border-b border-hairline py-1 last:border-0">
                <span className="truncate" title={j.name}>{j.id}</span>
                <span className="shrink-0 text-muted-foreground">{j.next_run?.replace('T', ' ').slice(0, 19) ?? 'paused'}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

// ── Issues tab ───────────────────────────────────────────────────────────────
function IssueRow({ issue, ai }: { issue: DebugIssue; ai: Ai }): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const err = issue.level === 'ERROR' || issue.level === 'CRITICAL'
  const detail = [issue.sample.msg, issue.sample.exc, issue.sample.stack].filter(Boolean).join('\n\n')
  return (
    <li className="rounded-xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-3 text-start hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={`mt-0.5 rounded-md px-2 py-0.5 text-[0.75em] font-bold ${err ? 'bg-destructive/10 text-destructive' : 'bg-caution-soft text-caution'}`}>
          ×{issue.count}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${mono}`} dir="ltr">{issue.title}</span>
          <span className="block text-[0.8em] text-muted-foreground" dir="ltr">
            {issue.logger} · {issue.source} · {t('debug.issues.last')} {issue.last_seen ?? '?'}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open ? (
        <div className="border-t border-border p-3">
          <p className="mb-2 text-[0.8em] text-muted-foreground" dir="ltr">
            {t('debug.issues.first')} {issue.first_seen ?? '?'} · id {issue.id}
          </p>
          <pre className={`mb-3 max-h-80 overflow-auto rounded-lg bg-background p-3 ${mono} whitespace-pre-wrap`} dir="ltr">
            {detail}
          </pre>
          <div className="flex flex-wrap gap-2">
            <AiButtons ai={ai} body={{ issue_id: issue.id }} compact />
            <Button size="xs" variant="ghost" onClick={() => void copy(JSON.stringify(issue.sample, null, 2), t('debug.copied'))}>
              {t('debug.issues.copyRaw')}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

function IssuesTab({ ai }: { ai: Ai }): React.JSX.Element {
  const { t } = useTranslation()
  const q = useQuery({ queryKey: ['debug', 'issues'], queryFn: debugApi.issues, refetchInterval: 30_000 })
  if (q.isLoading) return <Loader2 className="m-8 h-6 w-6 animate-spin text-muted-foreground" aria-label={t('debug.loading')} />
  if (q.error) return <p className="p-4 text-destructive">{apiErrorMessage(q.error)}</p>
  const list = q.data ?? []
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.9em] text-muted-foreground">{t('debug.issues.explain')}</p>
      {list.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl bg-success-soft p-4 text-success">
          <CheckCircle2 className="h-5 w-5" aria-hidden />
          {t('debug.issues.none')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((i) => (
            <IssueRow key={i.id} issue={i} ai={ai} />
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Logs tab ─────────────────────────────────────────────────────────────────
function logLine(e: DebugLogEntry): string {
  const extra = Object.entries(e)
    .filter(([k]) => !['ts', 'level', 'logger', 'msg', 'exc'].includes(k))
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ')
  return `${e.ts ?? ''} ${e.level} ${e.logger}: ${e.msg}${extra ? `  ${extra}` : ''}${e.exc ? `\n${e.exc}` : ''}`
}

function LogsTab(): React.JSX.Element {
  const { t } = useTranslation()
  const [source, setSource] = useState<DebugLogSource>('app')
  const [level, setLevel] = useState('INFO')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [live, setLive] = useState(true)
  const boxRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const id = setTimeout(() => setQ(search), 300)
    return () => clearTimeout(id)
  }, [search])

  const logs = useQuery({
    queryKey: ['debug', 'logs', source, level, q],
    queryFn: () => debugApi.logs({ source, level, q, limit: 1000 }),
    refetchInterval: live ? 3000 : false,
  })

  useEffect(() => {
    const box = boxRef.current
    if (box && stick.current) box.scrollTop = box.scrollHeight
  }, [logs.data])

  const text = useMemo(() => (logs.data?.entries ?? []).map(logLine).join('\n'), [logs.data])
  const sel = 'h-8 rounded-lg border border-border bg-surface px-2 text-[0.85em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={t('debug.logs.source')} className={sel} value={source} onChange={(e) => setSource(e.target.value as DebugLogSource)}>
          <option value="app">{t('debug.logs.app')}</option>
          <option value="stderr">stderr</option>
          <option value="stdout">stdout</option>
        </select>
        <select aria-label={t('debug.logs.level')} className={sel} value={level} onChange={(e) => setLevel(e.target.value)}>
          {['DEBUG', 'INFO', 'WARNING', 'ERROR'].map((l) => (
            <option key={l} value={l}>{l}+</option>
          ))}
        </select>
        <label className="relative min-w-48 flex-1">
          <span className="sr-only">{t('debug.logs.search')}</span>
          <Search className="pointer-events-none absolute start-2 top-2 h-4 w-4 text-muted-foreground" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('debug.logs.search')}
            className={`${sel} w-full ps-8`}
          />
        </label>
        <Button size="sm" variant={live ? 'default' : 'outline'} onClick={() => setLive((l) => !l)} aria-pressed={live}>
          {live ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
          {live ? t('debug.logs.live') : t('debug.logs.paused')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void copy(text, t('debug.copied'))}>
          <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
          {t('debug.logs.copyVisible')}
        </Button>
      </div>
      <p className="text-[0.8em] text-muted-foreground" dir="ltr">
        {logs.data ? `${logs.data.path} · ${fmtBytes(logs.data.size_bytes)} · ${logs.data.entries.length} lines` : ' '}
      </p>
      <div
        ref={boxRef}
        onScroll={(e) => {
          const b = e.currentTarget
          stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 40
        }}
        className={`h-[65vh] overflow-auto rounded-xl border border-border bg-background p-3 ${mono}`}
        dir="ltr"
        role="log"
        aria-live="off"
      >
        {logs.error ? <p className="text-destructive">{apiErrorMessage(logs.error)}</p> : null}
        {logs.data?.entries.length === 0 ? <p className="text-muted-foreground">{t('debug.logs.empty')}</p> : null}
        {logs.data?.entries.map((e, i) => (
          <div key={i} className="whitespace-pre-wrap break-words border-b border-hairline/50 py-0.5 hover:bg-surface-tinted">
            <span className="text-faint">{e.ts?.slice(5, 19).replace('T', ' ') ?? ''} </span>
            <span className={LEVEL_CLS[e.level] ?? ''}>{e.level.padEnd(7)} </span>
            <span className="text-primary">{e.logger} </span>
            {logLine({ ...e, ts: null, level: '', logger: '' }).replace(/^\s*:\s*/, '')}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Requests tab ─────────────────────────────────────────────────────────────
function RequestsTab(): React.JSX.Element {
  const { t } = useTranslation()
  const [onlyBad, setOnlyBad] = useState(false)
  const q = useQuery({ queryKey: ['debug', 'requests'], queryFn: debugApi.requests, refetchInterval: 5000 })
  const rows = (q.data ?? []).filter((r) => !onlyBad || r.status >= 400 || r.ms > 3000)
  const all = q.data ?? []
  const avg = all.length ? all.reduce((s, r) => s + r.ms, 0) / all.length : 0
  const p95 = all.length ? [...all].sort((a, b) => a.ms - b.ms)[Math.floor(all.length * 0.95)]?.ms ?? 0 : 0
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-[0.9em]">
        <span className="rounded-lg bg-surface px-3 py-1.5" dir="ltr">n={all.length} · avg {avg.toFixed(0)} ms · p95 {p95.toFixed(0)} ms · 5xx {all.filter((r) => r.status >= 500).length}</span>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} />
          {t('debug.requests.onlyBad')}
        </label>
      </div>
      <p className="text-[0.85em] text-muted-foreground">{t('debug.requests.explain')}</p>
      <div className="max-h-[65vh] overflow-auto rounded-xl border border-border bg-surface">
        <table className={`w-full ${mono}`} dir="ltr">
          <thead className="sticky top-0 bg-surface text-start text-muted-foreground">
            <tr>
              <th className="p-2 text-start">time</th>
              <th className="p-2 text-start">method</th>
              <th className="p-2 text-start">path</th>
              <th className="p-2 text-end">status</th>
              <th className="p-2 text-end">ms</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-hairline">
                <td className="p-2 text-muted-foreground">{r.ts.slice(11, 19)}</td>
                <td className="p-2">{r.method}</td>
                <td className="max-w-md truncate p-2" title={r.path}>{r.path}</td>
                <td className={`p-2 text-end ${r.status >= 500 ? 'text-destructive font-bold' : r.status >= 400 ? 'text-caution' : 'text-success'}`}>{r.status}</td>
                <td className={`p-2 text-end ${r.ms > 3000 ? 'text-destructive' : r.ms > 800 ? 'text-caution' : ''}`}>{r.ms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function DebugConsolePage(): React.JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState('health')
  const ai = useAi()
  const issues = useQuery({ queryKey: ['debug', 'issues'], queryFn: debugApi.issues, refetchInterval: 30_000 })
  const errCount = (issues.data ?? []).filter((i) => i.level === 'ERROR' || i.level === 'CRITICAL').length

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:p-6">
        <header className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-primary" aria-hidden />
          <div>
            <h1 className="text-[1.4em] font-bold">{t('debug.title')}</h1>
            <p className="text-[0.9em] text-muted-foreground">{t('debug.subtitle')}</p>
          </div>
        </header>
        <DiagnosisPanel ai={ai} />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="health">{t('debug.tabs.health')}</TabsTrigger>
            <TabsTrigger value="issues">
              {t('debug.tabs.issues')}
              {errCount ? <span className="ms-1.5 rounded-full bg-destructive px-1.5 text-[0.75em] text-destructive-foreground">{errCount}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="logs">{t('debug.tabs.logs')}</TabsTrigger>
            <TabsTrigger value="requests">{t('debug.tabs.requests')}</TabsTrigger>
          </TabsList>
          <TabsContent value="health" className="pt-4"><HealthTab ai={ai} /></TabsContent>
          <TabsContent value="issues" className="pt-4"><IssuesTab ai={ai} /></TabsContent>
          <TabsContent value="logs" className="pt-4"><LogsTab /></TabsContent>
          <TabsContent value="requests" className="pt-4"><RequestsTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
