import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api, SEND_PURPOSES, type BookDepartmentSendRead, type BookDistributeRequest, type BookRead, type SendPurpose } from '@/lib/api'
import { departmentErrorMessage, departmentName } from '@/lib/departments'
import { distributionPayload } from '@/lib/departmentInbox'
import { pickEmployeeName } from '@/lib/employeeName'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Props {
  book: BookRead
  send: BookDepartmentSendRead
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DistributeDialog({ book, send, open, onOpenChange }: Props): React.JSX.Element | null {
  if (!send.can_distribute) return null
  return <DialogRoot open={open} onOpenChange={onOpenChange}>{open && <Body key={`${book.id}-${send.id}`} book={book} send={send} close={() => onOpenChange(false)} />}</DialogRoot>
}

function Body({ book, send, close }: Pick<Props, 'book' | 'send'> & { close: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const qc = useQueryClient()
  const [mode, setMode] = useState<BookDistributeRequest['mode'] | 'keep'>('all')
  const [members, setMembers] = useState<number[]>([])
  const [subdepartment, setSubdepartment] = useState<number | null>(null)
  const [purpose, setPurpose] = useState<SendPurpose>(send.purpose)
  const [note, setNote] = useState('')
  const options = useQuery({
    queryKey: ['books', 'distribution-options', book.id, send.id],
    queryFn: () => api.getBookDistributionOptions(book.id, send.id),
  })
  const mutation = useMutation({
    mutationFn: (body: BookDistributeRequest) => api.distributeBookDepartmentSend(book.id, send.id, body),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['notifications', 'counts'] })
      toast.success(t('books.distribute.result', { sent: result.sent.length, skipped: result.skipped.length }))
      close()
    },
    onError: (error) => toast.error(departmentErrorMessage(error, t)),
  })
  const canSubmit = mode === 'keep' || (options.isSuccess && !mutation.isPending && (mode === 'all' || (mode === 'members' ? members.length > 0 : subdepartment !== null)))
  return (
    <DialogContent data-print-hide className="bottom-sheet !inset-x-0 !bottom-0 !top-auto !max-h-[92dvh] !translate-x-0 !translate-y-0 rounded-b-none md:!inset-x-auto md:!start-1/2 md:!bottom-auto md:!top-1/2 md:!max-h-[80dvh] md:!-translate-x-1/2 md:!-translate-y-1/2 md:rounded-b-2xl rtl:md:!translate-x-1/2">
      <DialogHeader className="pe-12">
        <DialogTitle>{t('books.distribute.title')}</DialogTitle>
        <DialogDescription><bdi>{departmentName({ name_en: send.department_name_en, name_ar: send.department_name_ar }, i18n.language)}</bdi> · <bdi dir="ltr">{book.ref_number}</bdi></DialogDescription>
      </DialogHeader>
      <div className="space-y-4 overflow-y-auto px-4 py-4 text-sm">
        <fieldset disabled={mutation.isPending}>
          <legend className="mb-1 font-semibold">{t('books.distribute.audience')}</legend>
          {(['all', 'members', 'subdepartment', 'keep'] as const).map((value) => (
            <label key={value} className="flex min-h-11 items-center gap-2">
              <input type="radio" name={`${id}-mode`} checked={mode === value} onChange={() => setMode(value)} className="h-4 w-4 accent-primary" />
              {t(`books.distribute.modes.${value}`)}
            </label>
          ))}
        </fieldset>
        {options.isPending && mode !== 'keep' && <p role="status" className="text-muted-foreground">{t('common.loading')}</p>}
        {options.isError && mode !== 'keep' && <p role="alert" className="text-destructive">{departmentErrorMessage(options.error, t)}</p>}
        {mode === 'members' && options.data && (
          <fieldset disabled={mutation.isPending} className="max-h-56 overflow-y-auto rounded-lg border border-hairline">
            <legend className="sr-only">{t('books.distribute.modes.members')}</legend>
            {options.data.members.map((member) => {
              const disabled = member.already_recipient || (book.confidentiality === 'secret' && !member.cleared)
              return <label key={member.user_id} className="flex min-h-11 items-center gap-2 border-b border-hairline px-3 py-2 last:border-0 has-[:disabled]:text-muted-foreground">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={member.already_recipient || members.includes(member.user_id)} disabled={disabled} onChange={(event) => setMembers((prev) => event.target.checked ? [...prev, member.user_id] : prev.filter((value) => value !== member.user_id))} />
                <bdi>{pickEmployeeName({ name_en: member.name, name_ar: member.name_ar }, i18n.language)}</bdi>
                {disabled && <span className="ms-auto text-xs">{t(member.already_recipient ? 'books.distribute.alreadyRecipient' : 'books.distribute.notCleared')}</span>}
              </label>
            })}
            {options.data.members.length === 0 && <p className="p-3 text-muted-foreground">{t('books.distribute.noMembers')}</p>}
          </fieldset>
        )}
        {mode === 'subdepartment' && options.data && (
          <fieldset disabled={mutation.isPending} className="max-h-56 overflow-y-auto rounded-lg border border-hairline">
            <legend className="sr-only">{t('books.distribute.modes.subdepartment')}</legend>
            {options.data.subdepartments.map((department) => <label key={department.id} className="flex min-h-11 items-center gap-2 border-b border-hairline px-3 py-2 last:border-0 has-[:disabled]:text-muted-foreground">
              <input type="radio" name={`${id}-department`} className="h-4 w-4 accent-primary" checked={subdepartment === department.id} disabled={!department.has_head} onChange={() => setSubdepartment(department.id)} />
              <bdi>{departmentName(department, i18n.language)}</bdi>
              {!department.has_head && <span className="ms-auto text-xs">{t('books.send.noHead')}</span>}
            </label>)}
            {options.data.subdepartments.length === 0 && <p className="p-3 text-muted-foreground">{t('books.distribute.noSubdepartments')}</p>}
          </fieldset>
        )}
        {mode !== 'keep' && <>
          <label className="block font-semibold" htmlFor={`${id}-purpose`}>{t('books.send.purpose')}</label>
          <select id={`${id}-purpose`} value={purpose} disabled={mutation.isPending} onChange={(event) => setPurpose(event.target.value as SendPurpose)} className="min-h-11 w-full rounded-lg border border-hairline bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {SEND_PURPOSES.map((value) => <option key={value} value={value}>{t(`books.send.purposes.${value}`)}</option>)}
          </select>
          <label className="block font-semibold" htmlFor={`${id}-note`}>{t('books.send.note')}</label>
          <textarea id={`${id}-note`} dir="auto" value={note} disabled={mutation.isPending} maxLength={500} rows={3} onChange={(event) => setNote(event.target.value)} className="w-full rounded-lg border border-hairline bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </>}
      </div>
      <footer className="flex flex-wrap justify-end gap-2 border-t border-hairline px-4 py-3">
        <Button variant="outline" onClick={close}>{t('common.cancel')}</Button>
        <Button disabled={!canSubmit || mutation.isPending} aria-busy={mutation.isPending || undefined} onClick={() => {
          if (mode === 'keep') close()
          else mutation.mutate(distributionPayload(mode, members, subdepartment, purpose, note))
        }}>{t(mode === 'keep' ? 'common.close' : 'books.distribute.title')}</Button>
      </footer>
    </DialogContent>
  )
}
