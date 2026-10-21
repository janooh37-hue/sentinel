import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Arabic-Indic (٠١٢) and Extended-Arabic (۰۱۲) digits → ASCII. Typed input
 *  validates, and Arabic display keeps Western digits (DESIGN.md). */
export function normalizeDigits(input: string): string {
  return input.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (char) => {
    const code = char.charCodeAt(0)
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660))
  })
}
