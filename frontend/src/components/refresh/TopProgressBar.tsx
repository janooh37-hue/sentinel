import { useIsRefreshing } from '../../lib/globalRefresh'

/** 2px navy bar pinned to the top of the content pane. Default signal for every
 *  refresh: quick fill + dissolve on fast fetches (via CSS), indeterminate sweep
 *  when the fetch is genuinely slow. Reduced-motion => static line. */
export function TopProgressBar() {
  const refreshing = useIsRefreshing()
  return (
    <div
      aria-hidden
      data-refreshing={refreshing || undefined}
      className={[
        'pointer-events-none absolute inset-x-0 top-0 z-40 h-0.5 overflow-hidden',
        'transition-opacity duration-100',
        refreshing ? 'opacity-100' : 'opacity-0',
      ].join(' ')}
    >
      <div className="absolute inset-0 bg-[color:var(--hairline)] opacity-50" />
      {refreshing && (
        <div className="ptr-sweep absolute inset-y-0 w-[32%] rtl:[transform:scaleX(-1)] motion-reduce:!animate-none motion-reduce:w-[110%]" />
      )}
    </div>
  )
}
