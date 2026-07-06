/**
 * AssignPopover — set/edit a single employee's duty unit + post.
 *
 * Rendered as a small modal dialog (portals past any table clip). Unit and post
 * are free-form comboboxes backed by a native <datalist>: pick an existing
 * suggestion or type a new value. On save it PATCHes the employee and
 * invalidates `['employees']`.
 */

import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, type EmployeeListItem, apiErrorMessage } from '@/lib/api'
import { unitOptions, postsForUnit } from '@/lib/dutyUnits'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { pickEmployeeName } from '@/lib/employeeName'

export interface AssignPopoverProps {
  open: boolean
  employee: EmployeeListItem
  /** All roster employees — used to derive unit/post suggestions. */
  allEmployees: readonly EmployeeListItem[]
  onOpenChange: (open: boolean) => void
}

export function AssignPopover({
  open,
  employee,
  allEmployees,
  onOpenChange,
}: AssignPopoverProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const unitListId = useId()
  const postListId = useId()

  const [unit, setUnit] = useState(employee.duty_unit ?? '')
  const [post, setPost] = useState(employee.duty_post ?? '')

  const units = unitOptions(allEmployees)
  const posts = postsForUnit(allEmployees, unit.trim())

  const mutation = useMutation({
    mutationFn: () =>
      api.updateEmployee(employee.id, {
        duty_unit: unit.trim() || null,
        duty_post: post.trim() || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employees'] })
      toast.success(t('dutyLocations.assign.saved'))
      onOpenChange(false)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dutyLocations.assign.title')}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{employee.id}</span>
            {' · '}
            <span dir="auto">{pickEmployeeName(employee, i18n.language)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-4 py-4 text-sm">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${unitListId}-input`} className="text-xs font-semibold text-muted-foreground">
              {t('dutyLocations.field.unit')}
            </label>
            <input
              id={`${unitListId}-input`}
              list={unitListId}
              value={unit}
              dir="auto"
              autoComplete="off"
              placeholder={t('dutyLocations.field.unitPlaceholder')}
              onChange={(e) => setUnit(e.target.value)}
              className="h-9 rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <datalist id={unitListId}>
              {units.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${postListId}-input`} className="text-xs font-semibold text-muted-foreground">
              {t('dutyLocations.field.post')}
            </label>
            <input
              id={`${postListId}-input`}
              list={postListId}
              value={post}
              dir="auto"
              autoComplete="off"
              placeholder={t('dutyLocations.field.postPlaceholder')}
              onChange={(e) => setPost(e.target.value)}
              className="h-9 rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <datalist id={postListId}>
              {posts.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
