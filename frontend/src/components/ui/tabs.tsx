/**
 * Underline tabs — ERP-style.
 *
 * Drop-in replacement for the previous in-house Tabs component. API matches
 * shadcn/ui Tabs (`value`, `onValueChange`, `TabsList`, `TabsTrigger`,
 * `TabsContent`) but uses a plain context + buttons rather than Radix Tabs.
 * That keeps the surface tiny and avoids one more peer-dep.
 */

import * as React from 'react'

import { cn } from '@/lib/utils'

interface TabsContextValue {
  value: string
  onChange: (v: string) => void
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

function useTabs(): TabsContextValue {
  const ctx = React.useContext(TabsContext)
  if (!ctx) throw new Error('Tabs primitives must be wrapped in <Tabs>')
  return ctx
}

interface TabsProps {
  value: string
  onValueChange: (v: string) => void
  className?: string
  children: React.ReactNode
}

export function Tabs({ value, onValueChange, className, children }: TabsProps): React.JSX.Element {
  const ctx = React.useMemo<TabsContextValue>(
    () => ({ value, onChange: onValueChange }),
    [value, onValueChange],
  )
  return (
    <TabsContext.Provider value={ctx}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}

export function TabsList({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      role="tablist"
      className={cn(
        'flex items-center gap-6 border-b border-border',
        className,
      )}
    >
      {children}
    </div>
  )
}

interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string
}

export function TabsTrigger({ value, className, ...props }: TabsTriggerProps): React.JSX.Element {
  const { value: current, onChange } = useTabs()
  const active = current === value
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-state={active ? 'active' : 'inactive'}
      onClick={() => onChange(value)}
      className={cn(
        'relative -mb-px flex h-10 items-center whitespace-nowrap border-b-2 border-transparent text-sm font-medium leading-none text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        active && 'border-primary text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string
  className?: string
  children: React.ReactNode
}): React.JSX.Element | null {
  const { value: current } = useTabs()
  if (current !== value) return null
  return (
    <div role="tabpanel" className={cn('mt-5', className)}>
      {children}
    </div>
  )
}
