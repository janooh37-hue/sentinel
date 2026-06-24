/**
 * RosterTable — the right detail pane: the active unit's employees grouped by
 * post in a GSSG-style table (columns الرقم / الاسم / المسمى الوظيفي), each row
 * a checkbox for multi-select transfer and an Assign/edit action.
 *
 * Selection state is owned by the parent page; this component renders it and
 * reports toggles. `groupedByPost` is a Map<post, employees[]> for the active
 * unit (empty-string post key = "no post").
 */

import { useTranslation } from 'react-i18next'
import { Pencil } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { EmployeeListItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'

export interface RosterTableProps {
  /** Active unit's employees, grouped by post (already filtered by search). */
  groupedByPost: ReadonlyMap<string, EmployeeListItem[]>
  selected: ReadonlySet<string>
  onToggle: (id: string, on: boolean) => void
  onAssign: (employee: EmployeeListItem) => void
}

export function RosterTable({
  groupedByPost,
  selected,
  onToggle,
  onAssign,
}: RosterTableProps): React.JSX.Element {
  const { t, i18n } = useTranslation()

  const posts = [...groupedByPost.keys()]
  const isEmpty = posts.every((p) => (groupedByPost.get(p)?.length ?? 0) === 0)

  if (isEmpty) {
    return (
      <p className="px-5 py-12 text-center text-sm text-muted-foreground">
        {t('dutyLocations.roster.empty')}
      </p>
    )
  }

  return (
    <div className="py-1.5">
      {posts.map((post) => {
        const rows = groupedByPost.get(post) ?? []
        if (rows.length === 0) return null
        return (
          <div key={post || '__none__'} className="pb-1">
            <div className="flex items-center gap-2.5 px-5 pb-1.5 pt-2.5">
              <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-accent" aria-hidden />
              <span className="text-[0.84em] font-bold" dir="auto">
                {post || t('dutyLocations.roster.noPost')}
              </span>
              <span className="font-mono text-[0.72em] text-faint">{rows.length}</span>
            </div>

            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-9 px-5 py-1.5" />
                  <th className="px-5 py-1.5 text-start text-[0.68em] font-bold uppercase tracking-[0.05em] text-faint">
                    {t('dutyLocations.column.id')}
                  </th>
                  <th className="px-5 py-1.5 text-start text-[0.68em] font-bold uppercase tracking-[0.05em] text-faint">
                    {t('dutyLocations.column.name')}
                  </th>
                  <th className="px-5 py-1.5 text-start text-[0.68em] font-bold uppercase tracking-[0.05em] text-faint">
                    {t('dutyLocations.column.position')}
                  </th>
                  <th className="w-9 px-5 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const isSel = selected.has(e.id)
                  return (
                    <tr
                      key={e.id}
                      className={cn(
                        'group border-t border-hairline transition-colors',
                        isSel ? 'bg-primary-soft' : 'hover:bg-surface-raised',
                      )}
                    >
                      <td className="px-5 py-2">
                        <input
                          type="checkbox"
                          checked={isSel}
                          aria-label={t('dutyLocations.roster.selectRow', {
                            name: pickEmployeeName(e, i18n.language),
                          })}
                          onChange={(ev) => onToggle(e.id, ev.target.checked)}
                          className="h-4 w-4 cursor-pointer accent-primary"
                        />
                      </td>
                      <td className="px-5 py-2 font-mono font-semibold text-primary">{e.id}</td>
                      <td className="px-5 py-2" dir="auto">
                        {pickEmployeeName(e, i18n.language)}
                      </td>
                      <td className="px-5 py-2 text-[0.92em] text-muted-foreground" dir="auto">
                        {(i18n.language === 'ar' && e.position_ar) || e.position || '—'}
                      </td>
                      <td className="px-5 py-2">
                        <button
                          type="button"
                          onClick={() => onAssign(e)}
                          aria-label={t('dutyLocations.assign.edit')}
                          title={t('dutyLocations.assign.edit')}
                          className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-surface-tinted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 group-hover:opacity-100"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
