export function whole(value: string): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(number))) : 0
}
