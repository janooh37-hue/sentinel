import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'

const ERROR_KEYS: Record<string, string | undefined> = {
  FOLDER_NOT_FOUND: 'ledger.booksDesk.folders.errorNotFound',
  FORBIDDEN: 'ledger.booksDesk.folders.errorForbidden',
  FOLDER_NOT_TEAM: 'ledger.booksDesk.folders.errorNotTeam',
  FOLDER_SHARES_EMPTY: 'ledger.booksDesk.folders.errorSharesEmpty',
  FOLDER_SHARE_USER_INVALID: 'ledger.booksDesk.folders.errorShareUserInvalid',
  FOLDER_SHARE_LEGACY_INVALID: 'ledger.booksDesk.folders.errorShareLegacyInvalid',
  DEPARTMENT_NOT_FOUND: 'departments.errors.notFound',
}

/** dataTransfer type for a Books desk row dragged onto a rail folder. */
export const BOOK_DRAG_TYPE = 'application/x-gssg-book'

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
