import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { toast } from '@/lib/toast'
import { api, ApiError } from '@/lib/api'
import type { BookFolderBox, BookFolderRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { pickEmployeeName } from '@/lib/employeeName'

const KEY = 'ledger.booksDesk.folders'
const ERROR_KEYS: Record<string, string | undefined> = {
  FOLDER_NOT_FOUND: `${KEY}.errorNotFound`,
  FORBIDDEN: `${KEY}.errorForbidden`,
  FOLDER_NOT_TEAM: `${KEY}.errorNotTeam`,
  FOLDER_SHARES_EMPTY: `${KEY}.errorSharesEmpty`,
  FOLDER_SHARE_USER_INVALID: `${KEY}.errorShareUserInvalid`,
  FOLDER_BOX_MISMATCH: `${KEY}.errorBoxMismatch`,
}

/** The desk boxes in rail order; every folder sits in one of them. */
export const FOLDER_BOXES: readonly BookFolderBox[] = ['incoming', 'done', 'outgoing', 'archived']

/** dataTransfer type for a Books desk row dragged onto a rail folder. */
export const BOOK_DRAG_TYPE = 'application/x-gssg-book'
const BOX_DRAG_PREFIX = 'application/x-gssg-book-box-'

/** Names the box a dragged book came from; only types are readable during dragover. */
export function bookBoxDragType(box: BookFolderBox): string {
  return `${BOX_DRAG_PREFIX}${box}`
}

/** The box a dragged book came from, or null when the drag is not a book row. */
export function draggedBookBox(types: readonly string[]): BookFolderBox | null {
  if (!types.includes(BOOK_DRAG_TYPE)) return null
  const type = types.find((value) => value.startsWith(BOX_DRAG_PREFIX))
  return (FOLDER_BOXES.find((box) => type === bookBoxDragType(box)) ?? null)
}

/** Who a shared folder is shared with, as one sentence for its tooltip. */
export function sharedAudience(t: TFunction, language: string, folder: BookFolderRead): string {
  if (folder.everyone) return t(`${KEY}.sharedWithEveryone`)
  const people = folder.shared_users.map((user) => bidi(pickEmployeeName({ name_en: user.name, name_ar: user.name_ar }, language)))
  const departments = folder.shared_departments.map((department) => t(`${KEY}.departmentAudience`, { name: bidi(department) }))
  return t(`${KEY}.restrictedAudience`, { audience: [...people, ...departments].join(language.startsWith('ar') ? '، ' : ', ') })
}

/** Folder failures in the reader's language; raw API text is English-only. */
export function toastFolderError(t: TFunction, error: unknown, titleKey: string): void {
  const key = error instanceof ApiError ? ERROR_KEYS[error.code] : undefined
  toast.error(t(titleKey), key ? { description: t(key) } : undefined)
}

export function useBookFolders() {
  return useQuery({
    queryKey: ['books', 'folders'],
    queryFn: () => api.listBookFolders(),
  })
}
