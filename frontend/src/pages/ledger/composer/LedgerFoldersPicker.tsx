import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api, apiErrorMessage } from '@/lib/api'

export function LedgerFoldersPicker({ id, value, onChange, error }: {
  id: string; value: number[]; onChange: (value: number[]) => void; error?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  // The endpoint already scopes visibility to own folders and shared team folders.
  const query = useQuery({ queryKey: ['books', 'folders'], queryFn: () => api.listBookFolders(), staleTime: 30_000 })
  const folders = query.data?.filter((folder) => folder.box === 'outgoing') ?? []
  const unavailable = query.data ? value.filter((selected) => !folders.some((folder) => folder.id === selected)) : []
  return <fieldset id={id} tabIndex={-1} aria-invalid={Boolean(error)} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} className="flex min-w-0 flex-col gap-2">
    <legend className="mb-1 text-[0.78em] font-semibold text-muted-foreground">{t('ledgerBook.composer.folders.label')}</legend>
    <p id={`${id}-hint`} className="text-xs text-muted-foreground">{t('ledgerBook.composer.folders.limit', { count: value.length, max: 10 })}</p>
    {query.isPending && <p role="status" className="text-sm text-muted-foreground">{t('ledgerBook.composer.loading')}</p>}
    {query.isError && <p role="alert" className="text-sm text-destructive">{apiErrorMessage(query.error)}</p>}
    {query.data && folders.length === 0 && <p className="text-sm text-muted-foreground">{t('ledgerBook.composer.folders.empty')}</p>}
    <div className="flex max-h-56 flex-col overflow-y-auto">
      {folders.map((folder) => <label key={folder.id} className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 text-sm hover:bg-surface-tinted">
        <input type="checkbox" checked={value.includes(folder.id)} disabled={value.length >= 10 && !value.includes(folder.id)} onChange={(e) => onChange(e.target.checked ? [...value, folder.id] : value.filter((v) => v !== folder.id))} />
        <bdi className="min-w-0 break-words">{folder.name}</bdi>
      </label>)}
      {unavailable.map((folderId) => <label key={folderId} className="inline-flex min-h-11 items-center gap-2 px-2 text-sm text-destructive">
        <input type="checkbox" checked onChange={() => onChange(value.filter((v) => v !== folderId))} />
        {t('ledgerBook.composer.folders.unavailable', { id: folderId })}
      </label>)}
    </div>
    {error && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error}</p>}
  </fieldset>
}
