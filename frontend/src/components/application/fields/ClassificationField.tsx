/**
 * ClassificationField — Radix Select fed by the classifications endpoint.
 *
 * Used exclusively on the General Book form. Selection is REQUIRED — every
 * General Book takes its ref from the classified register, so there is no
 * "no classification" option; until the user picks, the trigger shows a
 * placeholder. Options show "{code} — {name_ar}" with unit_ar as secondary
 * text. Calls `onChange(code)` on selection.
 *
 * This component is NOT wired into the RHF form — it is controlled externally
 * by the TemplateForm/ApplicationPage parent so they can react to the selection
 * (e.g. branch the submit path). It is still styled to match the other field
 * components.
 */

import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api } from '@/lib/api'

interface ClassificationFieldProps {
  name: string
  label_en: string
  label_ar: string
  required?: boolean
  value?: string | null
  onChange: (code: string | null) => void
}

export function ClassificationField({
  name,
  label_en,
  label_ar,
  required,
  value,
  onChange,
}: ClassificationFieldProps): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const label = isAr ? label_ar : label_en

  const { data } = useQuery({
    queryKey: ['books', 'classifications'],
    queryFn: () => api.listBookClassifications(),
    staleTime: Infinity,
  })

  const classifications = data?.items ?? []

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>
        {label}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </Label>
      <Select
        value={value ?? undefined}
        onValueChange={onChange}
      >
        <SelectTrigger id={name}>
          <SelectValue placeholder={t('books.word.chooseClassification')} />
        </SelectTrigger>
        <SelectContent>
          {classifications.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              <div className="flex flex-col">
                <span>{c.code} — {c.name_ar}</span>
                {c.unit_ar && (
                  <span className="text-xs text-muted-foreground">{c.unit_ar}</span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
