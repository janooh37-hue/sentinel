/**
 * ClassificationField — Radix Select fed by the classifications endpoint.
 *
 * Used exclusively on the General Book form. The first option is "بدون تبويب"
 * (null / no classification). Other options show "{code} — {name_ar}" with
 * unit_ar as secondary text. Calls `onChange(code | null)` on selection.
 *
 * This component is NOT wired into the RHF form — it is controlled externally
 * by the TemplateForm/ApplicationPage parent so they can react to the selection
 * (e.g. hide the body editor, branch the submit path). It is still styled to
 * match the other field components.
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

const NO_CLASSIFICATION = '__none__'

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

  function handleChange(v: string): void {
    onChange(v === NO_CLASSIFICATION ? null : v)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>
        {label}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </Label>
      <Select
        value={value ?? NO_CLASSIFICATION}
        onValueChange={handleChange}
      >
        <SelectTrigger id={name}>
          <SelectValue placeholder={t('books.word.noClassification')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_CLASSIFICATION}>
            {t('books.word.noClassification')}
          </SelectItem>
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
