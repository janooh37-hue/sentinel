/** Serial/code/G-number/date isolation: always LTR inside either UI direction. */
export function Ltr({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <bdi dir="ltr" className={className}>{children}</bdi>
}
