import { Controller, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { FieldProps } from '../types'
import { SavedRecipientPicker } from './SavedRecipientPicker'

export function RecipientPickerField({ name, label_en, label_ar, required }: FieldProps): React.JSX.Element {
  const { control, formState: { errors } } = useFormContext()
  const { i18n } = useTranslation()
  return <Controller control={control} name={name} render={({ field }) => <SavedRecipientPicker inputRef={field.ref} onBlur={field.onBlur} id={`${name}-input`} mode="id" label={i18n.language.startsWith('ar') ? label_ar : label_en} required={required} value={field.value ?? null} onChange={field.onChange} error={errors[name]?.message as string | undefined} />} />
}
