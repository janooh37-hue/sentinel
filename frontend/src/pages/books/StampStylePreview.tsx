/**
 * Visual mock of the three stamp styles.
 * ~200×260px "paper" card with the ref text rendered per-style.
 * Pure CSS — no DOCX rendering.
 *
 * TAMM: paper sits on a hairline-bordered rounded card with subtle shadow;
 * watermark text uses muted-foreground for friendlier dark-mode contrast.
 */

import { cn } from '@/lib/utils'

type StampStyle =
  | 'Header Text (Ref: XX-0000)'
  | 'Bold Top-Right Corner'
  | 'Watermark Style'

interface StampStylePreviewProps {
  style: StampStyle
  refSample?: string
}

export function StampStylePreview({
  style,
  refSample = '1-0042',
}: StampStylePreviewProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-[260px] w-[200px] overflow-hidden rounded-xl border border-hairline bg-surface shadow-sm">
        {/* Lined-paper effect */}
        <div className="absolute inset-x-0 top-8 space-y-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="mx-4 border-b border-hairline" />
          ))}
        </div>

        {style === 'Header Text (Ref: XX-0000)' && (
          <div className="absolute left-3 top-2 font-mono text-xs text-foreground/70">
            Ref: {refSample}
          </div>
        )}

        {style === 'Bold Top-Right Corner' && (
          <div className="absolute right-3 top-2 font-mono text-xs font-bold text-primary">
            {refSample}
          </div>
        )}

        {style === 'Watermark Style' && (
          <div
            className={cn(
              'absolute inset-0 flex items-center justify-center',
              'font-mono text-3xl font-bold text-muted-foreground/30',
              'select-none',
            )}
            style={{ transform: 'rotate(-25deg)' }}
          >
            {refSample}
          </div>
        )}
      </div>
      <span className="text-[0.7em] uppercase tracking-[0.1em] text-muted-foreground">
        Preview
      </span>
    </div>
  )
}
