import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api, type BookFolderRead, type BookFolderShareOption } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { bidi } from '@/lib/bidi'
import { departmentName, useDepartmentRollout } from '@/lib/departments'
import { toastFolderError } from './useBookFolders'

const KEY = 'ledger.booksDesk.folders'
const CHECK_ROW = 'flex min-h-11 cursor-pointer items-center gap-2.5 border-b border-hairline px-3 py-2 last:border-b-0 hover:bg-surface-tinted'

export function ShareFolderDialog({ folder, close }: { folder: BookFolderRead; close: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const searchId = useId()
  const modeId = useId()
  const { departmentsUsable } = useDepartmentRollout()
  const [everyone, setEveryone] = useState(folder.everyone)
  const [users, setUsers] = useState(() => folder.shared_users.map((user) => user.id))
  const [departmentIds, setDepartmentIds] = useState(() => folder.shared_departments.map((department) => department.id))
  const [legacyDepartments, setLegacyDepartments] = useState(() => [...folder.legacy_departments])
  const [search, setSearch] = useState('')
  const options = useQuery({
    queryKey: ['books', 'folders', 'share-options'],
    queryFn: () => api.getBookFolderShareOptions(),
  })
  const saving = useMutation({
    mutationFn: () => api.updateBookFolderShares(folder.id, {
      everyone,
      user_ids: everyone ? [] : users,
      department_ids: everyone ? [] : departmentIds,
      legacy_departments: everyone ? [] : legacyDepartments,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books', 'folders'] })
      void qc.invalidateQueries({ queryKey: ['books', 'routing'] })
      toast.success(t(`${KEY}.sharesSaved`))
      close()
    },
    onError: (error) => toastFolderError(t, error, `${KEY}.shareError`),
  })
  const needle = search.trim().toLowerCase()
  const departmentsById = new Map((options.data?.departments ?? []).map((department) => [department.id, department]))
  const textDepartmentOptions = [...new Set([...(options.data?.legacy_departments ?? []), ...folder.legacy_departments])]
  const shown = (options.data?.users ?? []).filter((user) => {
    const department = user.department_id == null ? undefined : departmentsById.get(user.department_id)
    return !needle || [user.name, user.name_ar, user.title, user.title_ar, department?.name_en, department?.name_ar, !departmentsUsable ? user.department : null].some((value) => value?.toLowerCase().includes(needle))
  })
  const departmentOf = (user: BookFolderShareOption): string | undefined => {
    const department = user.department_id == null ? undefined : departmentsById.get(user.department_id)
    return departmentsUsable
      ? department ? departmentName(department, i18n.language) : undefined
      : user.department ?? undefined
  }
  const nameOf = (user: BookFolderShareOption): string => pickEmployeeName({ name_en: user.name, name_ar: user.name_ar }, i18n.language)
  const titleOf = (user: BookFolderShareOption): string | null | undefined => i18n.language.startsWith('ar') ? user.title_ar || user.title : user.title || user.title_ar
  const canSave = !saving.isPending && (everyone || (users.length + departmentIds.length + legacyDepartments.length > 0 && options.isSuccess))

  return (
    <DialogContent dir={i18n.dir()} onEscapeKeyDown={(event) => { if (saving.isPending) event.preventDefault() }} onPointerDownOutside={(event) => { if (saving.isPending) event.preventDefault() }}>
      <DialogHeader className="pe-12">
        <DialogTitle>{t(`${KEY}.shareTitle`)}</DialogTitle>
        <DialogDescription><bdi>{folder.name}</bdi></DialogDescription>
      </DialogHeader>
      <form className="flex min-h-0 flex-1 flex-col" aria-busy={saving.isPending} onSubmit={(event) => { event.preventDefault(); if (canSave) saving.mutate() }}>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <fieldset disabled={saving.isPending} className="space-y-2">
            <legend className="mb-2 text-xs font-semibold">{t(`${KEY}.audience`)}</legend>
            {[true, false].map((value) => <label key={String(value)} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name={modeId} checked={everyone === value} onChange={() => setEveryone(value)} className="h-4 w-4 accent-primary" />
              {t(`${KEY}.${value ? 'everyone' : 'chosenAudience'}`)}
            </label>)}
          </fieldset>
          <p className="text-xs leading-relaxed text-muted-foreground">{t(`${KEY}.managersAlways`)}</p>
          {!everyone && (options.isPending ? <p role="status" className="text-sm text-muted-foreground">{t('common.loading')}</p> : options.isError ? (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>{t(`${KEY}.shareOptionsError`)}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void options.refetch()}>{t('ledger.booksDesk.retry')}</Button>
            </div>
          ) : <>
            <fieldset disabled={saving.isPending}>
              <legend className="mb-2 text-xs font-semibold">{t(`${KEY}.departments`)}</legend>
              {(departmentsUsable ? options.data.departments.length === 0 : textDepartmentOptions.length === 0) ? <p className="text-xs text-muted-foreground">{t(`${KEY}.noDepartments`)}</p> : (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-hairline bg-background">
                  {departmentsUsable ? options.data.departments.map((department) => <label key={department.id} className={CHECK_ROW}>
                    <input type="checkbox" checked={departmentIds.includes(department.id)} onChange={() => setDepartmentIds((previous) => previous.includes(department.id) ? previous.filter((id) => id !== department.id) : [...previous, department.id])} className="h-4 w-4 shrink-0 rounded border-hairline accent-primary" />
                    <bdi className="min-w-0 break-words text-sm">{departmentName(department, i18n.language)}</bdi>
                  </label>) : textDepartmentOptions.map((department) => <label key={department} className={CHECK_ROW}>
                    <input type="checkbox" checked={legacyDepartments.includes(department)} onChange={() => setLegacyDepartments((previous) => previous.includes(department) ? previous.filter((value) => value !== department) : [...previous, department])} className="h-4 w-4 shrink-0 rounded border-hairline accent-primary" />
                    <bdi className="min-w-0 break-words text-sm">{department}</bdi>
                  </label>)}
                </div>
              )}
              {departmentsUsable && legacyDepartments.length > 0 && <div className="mt-2 flex flex-wrap gap-2">
                {legacyDepartments.map((department) => <span key={department} className="inline-flex max-w-full items-center gap-1 rounded-lg border border-hairline bg-surface-tinted ps-2 text-xs">
                  <span className="min-w-0 break-words">{t(`${KEY}.legacyDepartmentName`, { name: bidi(department) })}</span>
                  <button type="button" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t(`${KEY}.removeLegacyDepartment`, { name: department })} onClick={() => setLegacyDepartments((previous) => previous.filter((value) => value !== department))}>
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </span>)}
              </div>}
            </fieldset>
            <fieldset disabled={saving.isPending}>
              <legend className="mb-2 text-xs font-semibold">{t(`${KEY}.people`)}</legend>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <label htmlFor={searchId} className="text-xs text-muted-foreground">{t(`${KEY}.searchPeople`)}</label>
                <span aria-live="polite" className="text-xs text-muted-foreground">{t(`${KEY}.selectedPeople`, { count: users.length })}</span>
              </div>
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input id={searchId} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t(`${KEY}.searchPeoplePlaceholder`)} className="ps-9" />
              </div>
              {shown.length === 0 ? <p className="rounded-lg border border-hairline px-3 py-4 text-center text-xs text-muted-foreground">{t(`${KEY}.${needle ? 'noPeopleMatches' : 'noPeople'}`)}</p> : (
                <div className="max-h-56 overflow-y-auto rounded-lg border border-hairline bg-background">
                  {shown.map((user) => <label key={user.id} className={CHECK_ROW}>
                    <input type="checkbox" checked={users.includes(user.id)} onChange={() => setUsers((previous) => previous.includes(user.id) ? previous.filter((id) => id !== user.id) : [...previous, user.id])} className="h-4 w-4 shrink-0 rounded border-hairline accent-primary" />
                    <span className="min-w-0 text-sm">
                      <bdi className="block break-words">{nameOf(user)}</bdi>
                      {titleOf(user) && <>{' '}<bdi className="block break-words text-xs text-muted-foreground">{titleOf(user)}</bdi></>}
                      {departmentOf(user) && <>{' '}<bdi className="block break-words text-xs text-muted-foreground">{departmentOf(user)}</bdi></>}
                    </span>
                  </label>)}
                </div>
              )}
            </fieldset>
          </>)}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-hairline px-4 py-3">
          <Button type="button" variant="outline" disabled={saving.isPending} onClick={close}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={!canSave}>{t('common.save')}</Button>
        </footer>
      </form>
    </DialogContent>
  )
}
