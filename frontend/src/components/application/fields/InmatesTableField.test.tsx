import { zodResolver } from '@hookform/resolvers/zod'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm, useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type InmateNationalityList } from '@/lib/api'
import i18n from '@/lib/i18n'
import { buildZodSchema } from '@/lib/applicationFormSchema'
import type { TemplateField } from '../types'
import { InmatesTableField } from './InmatesTableField'

vi.mock('@/lib/api', () => ({
  api: {
    listInmateNationalities: vi.fn(),
  },
}))

const NATIONALITIES: InmateNationalityList = {
  items: [
    {
      code: 'AE',
      label_ar: 'الإمارات',
      label_en: 'United Arab Emirates',
      selectable: true,
    },
    { code: 'JO', label_ar: 'الأردن', label_en: 'Jordan', selectable: true },
    { code: 'XB', label_ar: 'بدون', label_en: 'Stateless', selectable: true },
    { code: 'XX', label_ar: 'غير محدد', label_en: 'Unspecified', selectable: false },
  ],
  aliases: {
    الامارات: 'AE',
    الاردن: 'JO',
    ال: 'XX',
  },
}

interface InmateRowValue {
  name: string
  nationality: string
  wing: string
  uid: string
  holding_no: string
}

const VALIDATED_FIELDS: TemplateField[] = [
  {
    id: 'inmates',
    label_en: 'Inmates',
    label_ar: 'النزلاء',
    type: 'inmates_table',
    required: true,
  },
]

interface HarnessProps {
  defaultRows?: InmateRowValue[]
  validated?: boolean
  onValid?: (values: Record<string, unknown>) => void
  onInvalid?: () => void
}

function ValuesProbe(): React.JSX.Element {
  const { control } = useFormContext()
  const values = useWatch({ control, name: 'inmates' })
  return <output data-testid="values">{JSON.stringify(values)}</output>
}

function Harness({
  defaultRows = [],
  validated = false,
  onValid,
  onInvalid,
}: HarnessProps): React.JSX.Element {
  const { t } = useTranslation()
  const form = useForm({
    resolver: validated ? zodResolver(buildZodSchema(VALIDATED_FIELDS, t)) : undefined,
    defaultValues: { inmates: defaultRows },
  })


  return (
    <FormProvider {...form}>
      <InmatesTableField name="inmates" label_en="Inmates" label_ar="النزلاء" required />
      {validated && (
        <button
          type="button"
          onClick={() =>
            void form.handleSubmit(
              (submitted) => onValid?.(submitted),
              () => onInvalid?.(),
            )()
          }
        >
          submit
        </button>
      )}
      <ValuesProbe />
      <output data-testid="dirty">{String(form.formState.isDirty)}</output>
    </FormProvider>
  )
}

function makeQc(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['inmate-nationalities'], NATIONALITIES)
  return client
}

function renderHarness(props: HarnessProps = {}): void {
  render(
    <QueryClientProvider client={makeQc()}>
      <Harness {...props} />
    </QueryClientProvider>,
  )
}

describe('InmatesTableField', () => {
  beforeEach(async () => {
    vi.mocked(api.listInmateNationalities).mockResolvedValue(NATIONALITIES)
    await i18n.changeLanguage('en')
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('en')
  })

  it('starts empty and adds a row on demand', async () => {
    renderHarness()
    expect(screen.getByText(/no rows yet/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /add inmate/i }))
    expect(screen.getAllByRole('textbox')).toHaveLength(3)
    expect(screen.getByRole('combobox', { name: 'Nationality' })).toBeInTheDocument()
  })

  it('offers the 12 wings 1A…6B and nothing else', async () => {
    renderHarness()
    await userEvent.click(screen.getByRole('button', { name: /add inmate/i }))
    const wing = screen.getByRole('combobox', { name: /wing/i })
    const values = Array.from(wing.querySelectorAll('option'))
      .map((option) => option.value)
      .filter(Boolean)
    expect(values).toEqual([
      '1A',
      '1B',
      '2A',
      '2B',
      '3A',
      '3B',
      '4A',
      '4B',
      '5A',
      '5B',
      '6A',
      '6B',
    ])
  })

  it('offers only selectable nationalities and filters both labels with keyboard selection', async () => {
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: /add inmate/i }))
    const nationality = screen.getByRole('combobox', { name: 'Nationality' })

    await user.click(nationality)
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getAllByRole('option')).toHaveLength(3)
    expect(screen.queryByRole('option', { name: 'Unspecified' })).not.toBeInTheDocument()

    await user.type(nationality, 'Jordan')
    expect(within(listbox).getAllByRole('option')).toHaveLength(1)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(nationality).toHaveValue('Jordan')
    expect(screen.getByTestId('values')).toHaveTextContent('"nationality":"الأردن"')

    await user.click(screen.getByRole('button', { name: 'Clear the selection' }))
    await user.click(nationality)
    await user.type(nationality, 'الإم')
    expect(screen.getByRole('option', { name: 'United Arab Emirates' })).toBeInTheDocument()
  })

  it('renumbers the ت column after a row is removed', async () => {
    renderHarness()
    const add = screen.getByRole('button', { name: /add inmate/i })
    await userEvent.click(add)
    await userEvent.click(add)
    await userEvent.click(screen.getAllByRole('button', { name: /remove/i })[0])
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('2')).not.toBeInTheDocument()
  })

  it('renders Arabic column headers under lng=ar', async () => {
    await i18n.changeLanguage('ar')
    renderHarness()
    expect(screen.getByText('اسم النزيل')).toBeInTheDocument()
    expect(screen.getByText('الرقم الموحد')).toBeInTheDocument()
    expect(screen.getByText('ت')).toBeInTheDocument()
  })

  it('surfaces a visible error when a required cell (name) is left blank', async () => {
    renderHarness({ validated: true })
    await userEvent.click(screen.getByRole('button', { name: /add inmate/i }))
    await userEvent.click(screen.getByRole('button', { name: 'submit' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Required')
  })

  it('rejects a whitespace-only name', async () => {
    renderHarness({ validated: true })
    await userEvent.click(screen.getByRole('button', { name: /add inmate/i }))
    await userEvent.type(screen.getByLabelText('Inmate name'), '   ')
    await userEvent.click(screen.getByRole('button', { name: 'submit' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Required')
  })

  it.each([
    ['الامارات ', 'United Arab Emirates', 'الإمارات'],
    ['الاردن ', 'Jordan', 'الأردن'],
  ])(
    'preselects the canonical nationality for filed spelling %s without marking the form dirty',
    async (filedValue, displayLabel, canonicalLabel) => {
      const onValid = vi.fn()
      renderHarness({
        validated: true,
        onValid,
        defaultRows: [
          { name: 'Filed inmate', nationality: filedValue, wing: '', uid: '', holding_no: '' },
        ],
      })

      await waitFor(() =>
        expect(screen.getByRole('combobox', { name: 'Nationality' })).toHaveValue(displayLabel),
      )
      await waitFor(() =>
        expect(screen.getByTestId('values')).toHaveTextContent(
          `"nationality":"${canonicalLabel}"`,
        ),
      )
      expect(screen.getByTestId('dirty')).toHaveTextContent('false')

      await userEvent.click(screen.getByRole('button', { name: 'submit' }))
      await waitFor(() => expect(onValid).toHaveBeenCalledTimes(1))
      expect(onValid).toHaveBeenCalledWith(
        expect.objectContaining({
          inmates: [
            expect.objectContaining({
              nationality: canonicalLabel,
            }),
          ],
        }),
      )
    },
  )

  it('empties an unresolvable filed nationality and requires the reviser to pick one', async () => {
    const onValid = vi.fn()
    const onInvalid = vi.fn()
    renderHarness({
      validated: true,
      onValid,
      onInvalid,
      defaultRows: [
        { name: 'Filed inmate', nationality: 'الإ', wing: '', uid: '', holding_no: '' },
      ],
    })

    expect(
      await screen.findByText(
        'The filed nationality does not match the list — pick the correct value.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Nationality' })).toHaveValue('')
    expect(screen.getByTestId('dirty')).toHaveTextContent('false')

    await userEvent.click(screen.getByRole('button', { name: 'submit' }))
    await waitFor(() => expect(onInvalid).toHaveBeenCalledTimes(1))
    expect(onValid).not.toHaveBeenCalled()
    expect(screen.getByText('Required')).toBeInTheDocument()
  })

  it('rejects submit when a named inmate has no nationality selection', async () => {
    const onValid = vi.fn()
    const onInvalid = vi.fn()
    renderHarness({ validated: true, onValid, onInvalid })
    await userEvent.click(screen.getByRole('button', { name: /add inmate/i }))
    await userEvent.type(screen.getByLabelText('Inmate name'), 'Named inmate')

    await userEvent.click(screen.getByRole('button', { name: 'submit' }))
    await waitFor(() => expect(onInvalid).toHaveBeenCalledTimes(1))
    expect(onValid).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Required')
  })
})
