import { useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { departmentErrorMessage, departmentName, orderDepartments } from '@/lib/departments'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type DepartmentPickerProps = {
  value: number | null
  onChange: (id: number | null) => void
  allowNone?: boolean
  noneLabel?: string
  allowedDepartmentIds?: ReadonlySet<number>
  label?: string
  disabled?: boolean
  id?: string
}

export function DepartmentPicker({
  value,
  onChange,
  allowNone = true,
  noneLabel,
  allowedDepartmentIds,
  label,
  disabled = false,
  id,
}: DepartmentPickerProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const generatedId = useId()
  const pickerId = id ?? generatedId
  const query = useQuery({ queryKey: ['departments'], queryFn: api.departments.list })
  const departments = query.data ?? []
  const options = orderDepartments(departments).filter(
    ({ department }) => (department.active || department.id === value)
      && (!allowedDepartmentIds || allowedDepartmentIds.has(department.id)),
  )

  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={pickerId} className="block text-sm font-medium text-foreground">
        {label ?? t('departments.label')}
      </label>
      <Select
        value={value === null ? (allowNone ? 'none' : '') : String(value)}
        onValueChange={(next) => onChange(next === 'none' ? null : Number(next))}
        disabled={disabled || query.isPending || query.isError}
        dir={i18n.dir()}
      >
        <SelectTrigger id={pickerId} aria-invalid={query.isError || undefined}>
          <SelectValue placeholder={t(query.isPending ? 'departments.loading' : 'departments.choose')} />
        </SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value="none">{noneLabel ?? t('departments.none')}</SelectItem>}
          {options.map(({ department, depth }) => (
            <SelectItem key={department.id} value={String(department.id)}>
              <span style={{ paddingInlineStart: `${depth}rem` }}>
                {departmentName(department, i18n.language)}
                {!department.active && ` (${t('departments.inactive')})`}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {query.isError ? (
        <div role="alert" className="text-sm text-accent">
          <p>{departmentErrorMessage(query.error, t)}</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="rounded text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('departments.retry')}
          </button>
        </div>
      ) : !query.isPending && options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('departments.empty')}</p>
      ) : null}
    </div>
  )
}
