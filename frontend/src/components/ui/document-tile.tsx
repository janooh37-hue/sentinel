/**
 * TAMM-style document tile.
 *
 * Used in the Employee Detail page's Documents tab and (later) the general
 * Documents page (Task 5). Each tile renders a stylized preview of the
 * document type — paper / letter / id-card / folder — with an accent color
 * pulled from the design tokens.
 */

import { ChevronRight } from 'lucide-react'

export type TileVariant = 'paper' | 'letter' | 'id-card' | 'folder'
export type TileAccent = 'primary' | 'accent' | 'success' | 'warning'

interface Props {
  variant?: TileVariant
  accent?: TileAccent
  type: string
  title: string
  meta: string
  pendingDot?: boolean
  statusChip?: React.ReactNode
  onClick?: () => void
  /** Custom preview node; overrides the built-in variant illustration. */
  preview?: React.ReactNode
}

const ACCENT_BG: Record<TileAccent, string> = {
  primary: 'bg-primary',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
}

export function DocumentTile({
  variant = 'paper',
  accent = 'primary',
  type,
  title,
  meta,
  pendingDot,
  statusChip,
  onClick,
  preview,
}: Props): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full overflow-hidden rounded-2xl border border-hairline bg-surface text-start transition-all hover:-translate-y-1 hover:border-transparent hover:shadow-lg"
    >
      <div className="flex h-[170px] items-center justify-center bg-surface-tinted p-4">
        {preview ?? <TilePreview variant={variant} accentBg={ACCENT_BG[accent]} />}
      </div>
      <div className="p-4 pt-3.5">
        <div className="flex items-center gap-1.5 text-[0.75em] text-muted-foreground">
          {pendingDot && <span className="inline-block h-[7px] w-[7px] rounded-full bg-warning" />}
          <span>{type}</span>
          {statusChip && <span className="ms-auto">{statusChip}</span>}
        </div>
        <div className="mt-1 truncate text-[0.95em] font-bold tracking-tight text-foreground">{title}</div>
        <div className="mt-0.5 truncate font-mono text-[0.75em] text-muted-foreground">{meta}</div>
      </div>
      <ChevronRight className="absolute bottom-4 end-4 h-4 w-4 text-faint" aria-hidden />
    </button>
  )
}

function TilePreview({ variant, accentBg }: { variant: TileVariant; accentBg: string }): React.JSX.Element {
  if (variant === 'paper') return <PaperPreview accentBg={accentBg} />
  if (variant === 'letter') return <LetterPreview accentBg={accentBg} />
  if (variant === 'id-card') return <IdCardPreview />
  return <FolderPreview accentBg={accentBg} />
}

function PaperPreview({ accentBg }: { accentBg: string }): React.JSX.Element {
  return (
    <div className="relative h-[150px] w-[110px] rounded bg-white p-2 shadow">
      <div className={`mb-2 h-[14px] rounded-sm ${accentBg}`} />
      <Lines />
      <div className="mt-2 h-[18px] rounded-sm bg-stone-200" />
      <div className="absolute bottom-2 end-2 h-6 w-6 rounded-full border-[1.5px] border-accent opacity-50" />
    </div>
  )
}

function LetterPreview({ accentBg }: { accentBg: string }): React.JSX.Element {
  return (
    <div className="h-[100px] w-[140px] rounded bg-white p-2.5 shadow">
      <div className={`mb-2 h-2 w-[30%] rounded-sm ${accentBg}`} />
      <Lines compact />
    </div>
  )
}

function IdCardPreview(): React.JSX.Element {
  return (
    <div
      className="relative h-20 w-[130px] rounded-md p-2 shadow"
      style={{ background: 'linear-gradient(135deg, #f8f6f1, #e8e3d6)' }}
    >
      <div className="absolute left-2 top-2 h-9 w-[30px] rounded-sm bg-stone-400" />
      <div className="ms-10 space-y-1 pt-1">
        <div className="h-0.5 w-[60%] rounded bg-stone-600" />
        <div className="h-0.5 w-[90%] rounded bg-stone-600" />
        <div className="h-0.5 w-[40%] rounded bg-stone-600" />
        <div className="h-0.5 w-[90%] rounded bg-stone-600" />
      </div>
      <div className="absolute bottom-1.5 end-1.5 h-3.5 w-3.5 rounded-full bg-accent opacity-70" />
    </div>
  )
}

function FolderPreview({ accentBg }: { accentBg: string }): React.JSX.Element {
  return (
    <div className="relative h-[150px] w-[130px]">
      <SmallPaper accentBg={accentBg} className="absolute left-5 top-4 rotate-6 bg-stone-100" />
      <SmallPaper accentBg={accentBg} className="absolute left-3 top-2 -rotate-3 bg-stone-50" />
      <SmallPaper accentBg={accentBg} className="absolute left-0.5 top-0 bg-white" />
    </div>
  )
}

function SmallPaper({
  accentBg,
  className = '',
}: {
  accentBg: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={`h-[130px] w-[100px] rounded-md p-2 shadow ${className}`}>
      <div className={`mb-1.5 h-2 w-[60%] rounded-sm opacity-85 ${accentBg}`} />
      <div className="space-y-1">
        <div className="h-0.5 w-[90%] rounded bg-stone-300" />
        <div className="h-0.5 w-[60%] rounded bg-stone-300" />
        <div className="h-0.5 w-[40%] rounded bg-stone-300" />
      </div>
    </div>
  )
}

function Lines({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const widths = compact
    ? ['w-[90%]', 'w-[70%]', 'w-[50%]', 'w-[90%]', 'w-[30%]']
    : ['w-[90%]', 'w-[70%]', 'w-[90%]', 'w-[50%]', 'w-[70%]', 'w-[30%]']
  return (
    <div className="space-y-1">
      {widths.map((w, i) => (
        <div key={i} className={`h-0.5 rounded bg-stone-300 ${w}`} />
      ))}
    </div>
  )
}
