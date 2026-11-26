export const MAX_COUNT = 2_147_483_647

export function parseAuditQuantity(raw: string): number | null {
  const value = raw.trim()
  if (!/^[0-9]+$/.test(value)) return null
  const qty = Number(value)
  return qty <= MAX_COUNT ? qty : null
}
