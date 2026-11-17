/**
 * AddresseePickerField — a fleet reporter's General Book addressee.
 *
 * Takes the place of the recipient list: the paper is addressed to the
 * author's line manager (the default) or the default manager, as offered by
 * GET /api/v1/books/addressees. Stores the option key; the server writes the
 * printed name after «السيد».
 */

import { Controller, useFormContext } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api, apiErrorMessage } from '@/lib/api'
import type { ChainAddressee } from '@/lib/api'
import type { FieldProps } from '../types'

const DEFAULT_ADDRESSEE: ChainAddressee = 'line_manager'

export function AddresseePickerField({ name, label_en, label_ar }: FieldProps): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const label = i18n.language.startsWith('ar') ? label_ar : label_en
  const { control } = useFormContext()
  const addressees = useQuery({
    queryKey: ['chain-addressees'],
    queryFn: api.listChainAddressees,
    staleTime: 60_000,
  })

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {addressees.isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : addressees.isError ? (
        <p role="alert" className="text-[0.86em] text-destructive">
          {apiErrorMessage(addressees.error)}
        </p>
      ) : (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <Select
              dir={i18n.dir()}
              value={(field.value as ChainAddressee | undefined) ?? DEFAULT_ADDRESSEE}
              onValueChange={field.onChange}
            >
              <SelectTrigger id={name}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(addressees.data ?? []).map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    <bdi dir="auto">{option.label}</bdi>
                    {option.key === 'line_manager' && ` · ${t('application.addressee.lineManager')}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      )}
    </div>
  )
}
