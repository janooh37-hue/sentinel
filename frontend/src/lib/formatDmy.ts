/** ISO (`YYYY-MM-DD`) → `DD/MM/YYYY`, the format every GSSG paper uses. */
export function formatDmy(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}
