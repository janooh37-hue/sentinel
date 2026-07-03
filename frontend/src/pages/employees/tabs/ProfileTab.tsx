/**
 * Profile tab — read-only info grid → Identity documents (ID + passport tiles)
 * → signature pad. Photo upload lives on the hero (top), not here.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { IdentityDocCard } from '@/components/employees/IdentityDocCard'
import { SignaturePad } from '@/components/employees/SignaturePad'
import { PassportField } from './PassportField'
import { api } from '@/lib/api'
import type { EmployeeRead } from '@/lib/api'
import { pickPosition } from '@/lib/employeePosition'
import { useCapabilities } from '@/lib/useCapabilities'

interface Props {
  employee: EmployeeRead
}

export function ProfileTab({ employee }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { has } = useCapabilities()
  const qc = useQueryClient()
  const canEdit = has('employees.edit')

  const { data: tree, isError: vaultError } = useQuery({
    queryKey: ['vault', employee.id],
    queryFn: () => api.getVault(employee.id),
  })

  const invalidateVault = (): void => {
    void qc.invalidateQueries({ queryKey: ['vault', employee.id] })
  }

  const invalidateEmployee = (): void => {
    void qc.invalidateQueries({ queryKey: ['employee-detail', employee.id] })
  }

  const fields: { k: string; v: string | null | undefined }[] = [
    { k: 'employee.profile.idEn', v: employee.id },
    { k: 'employee.profile.nameEn', v: employee.name_en },
    { k: 'employee.profile.nameAr', v: employee.name_ar },
    { k: 'employee.profile.position', v: pickPosition(employee, i18n.language) },
    { k: 'employee.profile.department', v: employee.department },
    { k: 'employee.profile.dutyUnit', v: employee.duty_unit },
    { k: 'employee.profile.dutyPost', v: employee.duty_post },
    { k: 'employee.profile.doj', v: employee.doj },
    { k: 'employee.profile.status', v: t(`employees.status.${employee.status}`, employee.status) },
  ]

  return (
    <div className="space-y-5">
      {/* Info grid */}
      <div className="rounded-2xl bg-surface p-4 md:p-6">
        <div className="grid grid-cols-1 gap-x-8 gap-y-0 md:grid-cols-2">
          {fields.map(({ k, v }) => (
            <div
              key={k}
              className="grid grid-cols-[120px_1fr] items-baseline gap-3 border-b border-hairline pb-3 pt-3 sm:grid-cols-[140px_1fr]"
            >
              <div className="shrink-0 text-[0.78em] font-semibold uppercase tracking-wider text-muted-foreground">
                {t(k)}
              </div>
              <div className="min-w-0 break-words text-[0.95em] text-foreground">
                {v || <span className="text-faint">—</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Identity documents */}
      <section className="space-y-3">
        <h3 className="text-[0.92em] font-semibold">{t('employee.identity.title')}</h3>
        {vaultError ? (
          <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
            {t('common.loadError')}
          </div>
        ) : (
          tree && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <IdentityDocCard
                  employeeId={employee.id}
                  kind="uae_id"
                  docNumber={employee.uae_id_no ?? null}
                  entry={tree.folders.uae_id?.[0] ?? null}
                  canEdit={canEdit}
                  onChanged={invalidateVault}
                />
                <IdentityDocCard
                  employeeId={employee.id}
                  kind="passport"
                  docNumber={employee.passport_no ?? null}
                  entry={tree.folders.passport?.[0] ?? null}
                  canEdit={canEdit}
                  onChanged={invalidateVault}
                />
              </div>
              {/* Passport OCR field — badge + editable number + Read from scan */}
              <PassportField
                employeeId={employee.id}
                passportNo={employee.passport_no ?? null}
                source={employee.passport_no_source ?? null}
                hasScan={employee.has_passport_scan}
                canEdit={canEdit}
                onSaved={invalidateEmployee}
              />
            </>
          )
        )}
      </section>

      {/* Signature (bottom) */}
      <SignaturePad employeeId={employee.id} canEdit={canEdit} />
    </div>
  )
}
