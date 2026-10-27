import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { GradeSelect } from '@/components/books/GradeSelect'
import { NotifyEmployeeToggle } from '@/components/notify/NotifyEmployeeToggle'
import { NotifyMessagePreview } from '@/components/notify/NotifyMessagePreview'
import { Button } from '@/components/ui/button'
import type { Grade, SigningPath } from '@/lib/api'
import type { NotifyPreviewRequest } from '@/lib/messageTemplates'

export interface GeneratedSaveActionsProps {
  signingPath: SigningPath | undefined
  showNotify: boolean
  notifyEmployee: boolean
  notifyDisabled: boolean
  saveDisabled: boolean
  saving: boolean
  hint: string
  previewBody: NotifyPreviewRequest | null
  onNotifyChange: (checked: boolean) => void
  onSave: () => void
  /** Record grade picker; omitted (e.g. revise mode) when the grade is fixed. */
  grade?: Grade
  onGradeChange?: (grade: Grade) => void
}

export function GeneratedSaveActions({
  signingPath,
  showNotify,
  notifyEmployee,
  notifyDisabled,
  saveDisabled,
  saving,
  hint,
  previewBody,
  onNotifyChange,
  onSave,
  grade,
  onGradeChange,
}: GeneratedSaveActionsProps): React.JSX.Element {
  const { t } = useTranslation()
  const hintOn =
    signingPath === 'chain'
      ? 'application.notify.hintOnAtApproval'
      : 'application.notify.hintOn'
  const notificationHint = notifyEmployee
    ? `${t(hintOn)} ${t('application.actions.notificationChannel')}`
    : t('application.notify.hintOff')

  return (
    <section
      className="mb-5 rounded-xl border border-hairline bg-surface-tinted p-4 sm:p-5"
      dir="auto"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-foreground">
            {t('application.actions.readyToSave')}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
          {showNotify && (
            <NotifyEmployeeToggle
              className="mt-3"
              checked={notifyEmployee}
              disabled={notifyDisabled || saving}
              onChange={onNotifyChange}
              label={t('application.notify.label')}
              hint={notificationHint}
            />
          )}
          {previewBody && (
            <NotifyMessagePreview
              key={`${previewBody.template_id}:${previewBody.employee_id}`}
              body={previewBody}
              notifyEmployee={notifyEmployee}
            />
          )}
          {grade && onGradeChange && (
            <div className="mt-3">
              <GradeSelect value={grade} onChange={onGradeChange} />
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="commit"
          size="commit"
          disabled={saveDisabled || saving}
          onClick={onSave}
          aria-busy={saving}
          className="min-h-11 w-full shrink-0 disabled:cursor-not-allowed disabled:opacity-50 sm:ms-auto sm:w-auto"
        >
          <FileText className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          {t('application.actions.saveToRecords')}
        </Button>
      </div>
    </section>
  )
}
