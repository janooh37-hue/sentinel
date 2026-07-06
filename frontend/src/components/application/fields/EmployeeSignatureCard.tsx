/**
 * EmployeeSignatureCard — the on-form employee signature card.
 *
 * Locked design: docs/prototypes/employee-signature-form-final.html (combined
 * variant 4 + 2). Replaces SignatureField for the `employee_sig_path` field
 * whenever an employee is selected; SignatureField stays as the fallback for
 * admin-category forms with no employee.
 *
 * Behavior:
 *  - On mount / employee switch the card checks the vault for the employee's
 *    saved signature and renders the matching state instantly:
 *      • Loaded — ✓ green pill, "as it prints" document-cell preview, an
 *        "Embed in this form" checkbox (auto-ticked when a signature exists),
 *        a Replace… affordance and an info line (whose profile + when).
 *      • None — amber pill + the draw/upload panel directly; saving flips the
 *        card to Loaded and (by default) stores the signature on the profile.
 *  - A freshly drawn/uploaded signature is bound to the RHF `name` field as a
 *    PNG data URL; at generate time the backend lets a drawn data-URL win over
 *    the saved vault signature.
 *  - The printed-cell preview is a document facsimile: white paper, serif,
 *    bilingual labels hardcoded in BOTH languages exactly like the DOCX —
 *    it never translates and never mirrors (dir="ltr").
 */

import { useEffect, useState } from 'react'
import { Controller, useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SignatureDrawPanel } from '@/components/signature/SignatureDrawPanel'
import { api, type SubmitterRead, apiErrorMessage } from '@/lib/api'

export interface EmployeeSignatureCardProps {
  /** RHF field carrying a drawn/uploaded PNG data URL (`employee_sig_path`). */
  name: string
  /** RHF boolean mapping to `embed_signature.employee` (`hand_sign_employee`). */
  embedName: string
  employeeId: string
  /** True for forms with a companion page that keeps the applicant's own
   *  signature (Leave Application Form → page-2 undertaking). Drives the
   *  "applicant still signs page 2" note in the submitter-swap notice. */
  hasCompanion?: boolean
}

export function EmployeeSignatureCard({
  name,
  embedName,
  employeeId,
  hasCompanion = false,
}: EmployeeSignatureCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { control, setValue } = useFormContext()
  const [replaceMode, setReplaceMode] = useState(false)

  const query = useQuery({
    queryKey: ['employee-signature', employeeId],
    queryFn: () => api.getEmployeeSignature(employeeId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const drawn = useWatch({ control, name }) as string | undefined
  const embedOn = !!(useWatch({ control, name: embedName }) as
    | boolean
    | undefined)

  // Submitter swap (Leave Application Form, page 1): when a submitter is picked,
  // their signature (their linked employee's saved signature) replaces the
  // applicant's in the page-1 employee cell. This card keeps managing the
  // APPLICANT's signature (page 2 / the undertaking + the no-submitter case);
  // here we only surface a notice so the operator knows what page 1 will print.
  const submitterId = useWatch({ control, name: 'submitter_id' }) as
    | string
    | undefined
  const { data: submitters = [] } = useQuery<SubmitterRead[]>({
    queryKey: ['submitters'],
    queryFn: () => api.listSubmitters(),
    enabled: !!submitterId,
    staleTime: 5 * 60 * 1000,
  })
  const chosenSubmitter = submitterId
    ? submitters.find((s) => String(s.id) === submitterId)
    : undefined
  const submitterEmpId = chosenSubmitter?.employee_id ?? null
  // Active only when the submitter changes who signs page 1: a different linked
  // employee, or none at all (→ blank). Self-submit (same employee) is a no-op.
  const submitterActive =
    embedOn &&
    !!chosenSubmitter &&
    (submitterEmpId === null || submitterEmpId !== employeeId)

  const submitterSigQuery = useQuery({
    queryKey: ['employee-signature', submitterEmpId],
    queryFn: () => api.getEmployeeSignature(submitterEmpId as string),
    enabled: submitterActive && !!submitterEmpId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  const submitterSig = submitterSigQuery.data?.dataUrl ?? null

  // Embed default — re-evaluated when the employee or the existence answer
  // changes (NOT on every render): saved signature on file → embed pre-ticked;
  // none → unticked. A drawn sig never survives an employee switch.
  const hasSaved = query.data !== undefined ? query.data !== null : undefined
  useEffect(() => {
    if (hasSaved === undefined) return // still loading
    setValue(embedName, hasSaved, { shouldDirty: false })
    setValue(name, undefined)
    // Spec'd reset: the draw pad never stays open across an employee switch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReplaceMode(false)
  }, [employeeId, hasSaved]) // eslint-disable-line react-hooks/exhaustive-deps

  const onUse = async (
    dataUrl: string,
    saveToProfile: boolean,
  ): Promise<void> => {
    setValue(name, dataUrl, { shouldDirty: true })
    setValue(embedName, true, { shouldDirty: true })
    setReplaceMode(false)
    if (saveToProfile) {
      try {
        const blob = await (await fetch(dataUrl)).blob()
        await api.uploadSignature(employeeId, blob)
        toast.success(t('empSig.saved'))
        void qc.invalidateQueries({
          queryKey: ['employee-signature', employeeId],
        })
      } catch (err) {
        toast.error(apiErrorMessage(err))
      }
    }
  }

  const shownSig = drawn ?? query.data?.dataUrl ?? null
  const isLoaded = query.data != null || !!drawn
  const updatedAt = query.data?.updatedAt ?? null

  return (
    <Card className="col-span-1 sm:col-span-2">
      <CardHeader>
        <CardTitle>{t('empSig.title')}</CardTitle>
        {!query.isLoading &&
          (isLoaded ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success">
              ✓ {t('empSig.loaded')}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-semibold text-warning">
              {t('empSig.none')}
            </span>
          ))}
      </CardHeader>
      <CardContent>
        {submitterActive && (
          <div
            className="mb-3 space-y-1.5 rounded-md border border-info/30 bg-info-soft px-3 py-2.5 text-xs text-foreground"
            role="note"
          >
            <p className="font-semibold text-info">
              {t('empSig.submitterTitle')}
            </p>
            {submitterEmpId === null ? (
              <p className="text-warning">
                {t('empSig.submitterNotLinked', {
                  name: chosenSubmitter?.name ?? '',
                })}
              </p>
            ) : submitterSigQuery.isLoading ? (
              <div
                className="h-6 w-24 animate-pulse rounded bg-surface-tinted"
                aria-hidden
              />
            ) : submitterSig ? (
              <div className="space-y-1.5">
                <p>
                  {t('empSig.submitterSigns', {
                    name: chosenSubmitter?.name ?? '',
                  })}
                </p>
                <span className="inline-flex items-center rounded-sm border border-border-strong bg-white px-2 py-1">
                  <img
                    src={submitterSig}
                    alt={t('empSig.submitterTitle')}
                    className="max-h-8 max-w-[150px]"
                    dir="ltr"
                  />
                </span>
              </div>
            ) : (
              <p className="text-warning">
                {t('empSig.submitterNoSig', {
                  name: chosenSubmitter?.name ?? '',
                })}
              </p>
            )}
            {hasCompanion && (
              <p className="text-muted-foreground">
                {t('empSig.submitterAppliesP2')}
              </p>
            )}
          </div>
        )}
        {query.isLoading ? (
          <div
            className="h-16 animate-pulse rounded-md bg-surface-tinted"
            data-testid="emp-sig-loading"
            role="status"
            aria-label={t('common.loading')}
          />
        ) : isLoaded ? (
          <div className="space-y-3">
            {/* Printed-cell preview — document facsimile. Intentionally white
                paper with hardcoded bilingual labels (like the DOCX itself);
                never translates, never mirrors. */}
            <div className="rounded-sm border border-border-strong bg-white shadow-sm">
              <table
                className="w-full border-collapse font-serif text-xs"
                dir="ltr"
              >
                <tbody>
                  <tr>
                    <td className="w-[46%] border border-border-strong bg-surface-tinted px-2.5 py-1.5 font-semibold text-foreground">
                      Employee signature
                      <br />
                      <span dir="rtl">توقيع الموظف</span>
                    </td>
                    <td className="border border-border-strong px-2.5 py-1.5">
                      {embedOn && shownSig ? (
                        <div
                          className="flex h-11 items-center justify-center"
                          data-testid="printed-cell-sig"
                        >
                          <img
                            src={shownSig}
                            alt={t('empSig.title')}
                            className="max-h-10 max-w-[170px]"
                          />
                        </div>
                      ) : (
                        <div
                          className="mx-3 h-8 border-b border-dotted border-border-strong"
                          data-testid="printed-cell-blank"
                        />
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-border-strong bg-surface-tinted px-2.5 py-1.5 font-semibold text-foreground">
                      Date
                      <br />
                      <span dir="rtl">التاريخ</span>
                    </td>
                    <td className="border border-border-strong px-2.5 py-1.5 text-center text-foreground">
                      {new Date().toLocaleDateString('en-GB')}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                <Controller
                  control={control}
                  name={embedName}
                  render={({ field }) => (
                    <input
                      type="checkbox"
                      checked={!!field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                  )}
                />
                {t('empSig.embed')}
              </label>
              {!replaceMode && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ms-auto"
                  onClick={() => setReplaceMode(true)}
                >
                  {t('empSig.replace')}
                </Button>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {embedOn
                ? query.data != null
                  ? `${t('empSig.savedOn', { id: employeeId })} · ${
                      updatedAt
                        ? t('empSig.updatedAt', {
                            date: new Date(updatedAt).toLocaleDateString(),
                          })
                        : t('empSig.justNow')
                    }`
                  : t('empSig.thisFormOnly')
                : t('empSig.blankHint')}
            </p>

            {replaceMode && (
              <SignatureDrawPanel
                onUse={(dataUrl, saveToProfile) =>
                  void onUse(dataUrl, saveToProfile)
                }
                onCancel={() => setReplaceMode(false)}
              />
            )}
          </div>
        ) : (
          <SignatureDrawPanel
            onUse={(dataUrl, saveToProfile) =>
              void onUse(dataUrl, saveToProfile)
            }
          />
        )}
      </CardContent>
    </Card>
  )
}
