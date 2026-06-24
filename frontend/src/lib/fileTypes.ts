/**
 * File-type helpers for ledger attachment cards.
 *
 * Maps a filename extension to a `FileKind`, a conventional accent colour, and
 * a short uppercase label (PDF / DOCX / IMG …). The colours are file-type
 * conventions — not theme tokens — so they stay constant across light/dark.
 */

export type FileKind = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'image' | 'zip' | 'file'

export interface FileMeta {
  /** Solid accent colour (icon stroke + label badge). */
  color: string
  /** Short uppercase label shown in the card meta line. */
  label: string
}

const META: Record<FileKind, FileMeta> = {
  pdf: { color: '#d04848', label: 'PDF' },
  docx: { color: '#2a6fdb', label: 'DOCX' },
  xlsx: { color: '#1f8a5b', label: 'XLSX' },
  csv: { color: '#1f8a5b', label: 'CSV' },
  image: { color: '#a05bd6', label: 'IMG' },
  zip: { color: '#b07a2e', label: 'ZIP' },
  file: { color: '#6b7280', label: 'FILE' },
}

export function fileMeta(kind: FileKind): FileMeta {
  return META[kind]
}

export function fileKindFromName(name: string): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'pdf':
      return 'pdf'
    case 'doc':
    case 'docx':
      return 'docx'
    case 'xls':
    case 'xlsx':
      return 'xlsx'
    case 'csv':
      return 'csv'
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'webp':
    case 'bmp':
    case 'svg':
    case 'heic':
      return 'image'
    case 'zip':
    case 'rar':
    case '7z':
      return 'zip'
    default:
      return 'file'
  }
}

/** True when we can render the file in the in-app preview (image, PDF, or
 * Excel). Other kinds open the preview to a "can't preview" note. */
export function isViewable(kind: FileKind): boolean {
  return kind === 'image' || kind === 'pdf' || kind === 'xlsx'
}

/** Human-readable byte size: `B` under 1 KiB, `KB` under 1 MiB, else `MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const KB = 1024
  const MB = KB * 1024
  if (bytes < KB) return `${bytes} B`
  if (bytes < MB) return `${Math.round(bytes / KB)} KB`
  return `${(bytes / MB).toFixed(1)} MB`
}
