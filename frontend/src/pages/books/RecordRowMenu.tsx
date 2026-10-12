/**
 * Records page — the smart row menu (⋯ on hover/focus, right-click, Shift+F10 /
 * ContextMenu key). Shown only while the preview is collapsed, so its tools never
 * duplicate the pane's. Items are plain descriptors; the page-level hook owns the
 * dialogs so they outlive the closed menu.
 */
import { useRef } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BookRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface RowMenuItem {
  key: string
  label: string
  icon: React.ReactNode
  onSelect: () => void
}

/** The row's ⋯ trigger and its menu; `open` is controlled so right-click can open it too. */
export function RecordRowMenu({
  book,
  itemsFor,
  open,
  onOpenChange,
  returnFocusRef,
}: {
  book: BookRead
  itemsFor: (book: BookRead) => RowMenuItem[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Set by the row before opening; omitted for the trigger's normal Radix restoration. */
  returnFocusRef?: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const escaped = useRef(false)
  return (
    // modal={false}: items open dialogs; a modal menu leaves `pointer-events: none` on <body>.
    <DropdownMenu modal={false} dir={i18n.dir()} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('books.list.rowMenu', { ref: bidi(book.ref_number) })}
          aria-keyshortcuts="Shift+F10 ContextMenu"
          onKeyDown={(event) => {
            if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
            event.preventDefault()
            event.stopPropagation()
            onOpenChange(true)
          }}
          className={cn(
            'relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-sm text-muted-foreground transition-opacity motion-reduce:transition-none',
            'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100',
            'hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onEscapeKeyDown={(event) => {
          event.stopPropagation()
          escaped.current = true
        }}
        onCloseAutoFocus={(event) => {
          // Only override Escape: outside clicks and action dialogs keep Radix's focus handling.
          const target = returnFocusRef?.current
          const restore = escaped.current
          escaped.current = false
          if (!restore || !target?.isConnected) return
          event.preventDefault()
          target.focus()
        }}
      >
        {itemsFor(book).map((item) => (
          <DropdownMenuItem key={item.key} onSelect={item.onSelect}>
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
