import { useState } from 'react'
import { Folder, Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { DialogRoot, DialogTrigger } from '@/components/ui/dialog'
import type { BookFolderRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { pickEmployeeName } from '@/lib/employeeName'
import { departmentName } from '@/lib/departments'
import { ShareFolderDialog } from './ShareFolderDialog'

const KEY = 'ledger.booksDesk.folders'

export function BookFolderHeader({ folder }: { folder: BookFolderRead }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [sharing, setSharing] = useState(false)
  const isAr = i18n.language.startsWith('ar')
  const creator = pickEmployeeName({ name_en: folder.created_by_name ?? '', name_ar: folder.created_by_name_ar }, i18n.language)
  // Names, not titles: several people can share one designation, and a bare title reads like a whole group.
  const people = folder.shared_users.map((user) => {
    const name = pickEmployeeName({ name_en: user.name, name_ar: user.name_ar }, i18n.language)
    const title = isAr ? user.title_ar || user.title : user.title || user.title_ar
    return { short: name, full: title ? `${bidi(name)} (${bidi(title)})` : bidi(name) }
  })
  const departments = folder.shared_departments.map((department) => t(`${KEY}.departmentAudience`, { name: bidi(departmentName(department, i18n.language)) }))
  const legacyDepartments = folder.legacy_departments.map((department) => `${isAr ? 'اسم قسم قديم' : 'Old department name'}: ${bidi(department)}`)
  const audience = [...people.map((person) => bidi(person.short)), ...departments, ...legacyDepartments]
  const separator = isAr ? '، ' : ', '
  const audienceSentence = (items: string[]): string => t(`${KEY}.restrictedAudience`, { audience: items.join(separator) })
  const fullAudience = audienceSentence([...people.map((person) => person.full), ...departments, ...legacyDepartments])
  const visibleAudience = audienceSentence(audience.slice(0, 3))

  return (
    <DialogRoot open={sharing} onOpenChange={setSharing}>
      <header className="shrink-0 space-y-2 border-b border-hairline px-4 py-3 lg:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden />
              <h2 className="min-w-0 break-words text-base font-semibold"><bdi>{folder.name}</bdi></h2>
              <span className="text-xs text-muted-foreground">{t(`${KEY}.${folder.team ? 'teamLabel' : 'personalLabel'}`)}</span>
              <span className="text-xs text-muted-foreground">{t(`${KEY}.bookCount`, { count: folder.count })}</span>
            </div>
            {folder.team && creator && <p className="mt-1 text-xs text-muted-foreground">{t(`${KEY}.createdBy`, { name: bidi(creator) })}</p>}
          </div>
          {folder.team && folder.can_manage && (
            <DialogTrigger asChild><Button variant="outline" size="sm"><Share2 className="h-3.5 w-3.5" aria-hidden />{t(`${KEY}.share`)}</Button></DialogTrigger>
          )}
        </div>
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          {!folder.team ? t(`${KEY}.personalAudience`) : folder.everyone ? t(`${KEY}.everyoneAudience`) : <>
            <span title={fullAudience}>
              <span aria-hidden={audience.length > 3 || undefined}>{visibleAudience}{audience.length > 3 && <> <bdi dir="ltr">+{audience.length - 3}</bdi></>}</span>
              {audience.length > 3 && <span className="sr-only">{fullAudience}</span>}
            </span>{' '}{t(`${KEY}.bookVisibility`)}
          </>}
        </p>
      </header>
      {sharing && <ShareFolderDialog folder={folder} close={() => setSharing(false)} />}
    </DialogRoot>
  )
}
