import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { NotifyEmployeeToggle } from '@/components/notify/NotifyEmployeeToggle'
import { Button } from '@/components/ui/button'

// Mirrors backend form_policy.SIGN_GATED_LEAVE_FORMS: these notify on approval.
const SIGN_GATED_LEAVE_FORMS: Partial<Record<string, true>> = {
  'Leave Permit Form': true,
  'Administrative Leave Form': true,
}

export interface GeneratedSaveActionsProps {
  templateId: string | null
  showNotify: boolean
  notifyEmployee: boolean
  notifyDisabled: boolean
  saveDisabled: boolean
  saving: boolean
  hint: string
  onNotifyChange: (checked: boolean) => void
  onSave: () => void
}

export function GeneratedSaveActions({
  templateId,
  showNotify,
  notifyEmployee,
  notifyDisabled,
  saveDisabled,
  saving,
  hint,
  onNotifyChange,
  onSave,
}: GeneratedSaveActionsProps): React.JSX.Element {
  const { t } = useTranslation()
  const hintOn =
    templateId !== null && SIGN_GATED_LEAVE_FORMS[templateId]
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
        <div className="min-w-0">
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
