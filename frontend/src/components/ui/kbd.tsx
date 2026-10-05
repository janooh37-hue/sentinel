import { cn } from '@/lib/utils'

/**
 * Keyboard-key glyph. Always LTR (`Ctrl+K`, `J`, `?` must not reorder inside an
 * RTL page), so the `<kbd>` sits in a `<bdi dir="ltr">`.
 */
export function Kbd({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <bdi dir="ltr">
      <kbd
        className={cn(
          'inline-flex min-w-[1.5em] items-center justify-center rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[0.85em] leading-none text-foreground shadow-sm',
          className,
        )}
      >
        {children}
      </kbd>
    </bdi>
  )
}
