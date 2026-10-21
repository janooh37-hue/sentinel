import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'

const ERROR_KEYS: Record<string, string | undefined> = {
  FOLDER_NOT_FOUND: 'ledger.booksDesk.folders.errorNotFound',
  FORBIDDEN: 'ledger.booksDesk.folders.errorForbidden',
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
