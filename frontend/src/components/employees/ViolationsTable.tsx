/**
 * Violations list inside the Employees detail pane.
 *
 * Display as a real ERP-style data table; clicking Edit swaps the row for an
 * inline editor instead of opening a modal. Inline editing keeps the surface
 * a single keyboard tab-path and matches how Workday handles per-row
 * "transactions" on a person record.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ViolationCreate, ViolationRead, ViolationUpdate } from '@/lib/api'
import { SendButton } from '@/components/notify/SendButton'

interface Props {
  rows: ViolationRead[]
  employeeId: string
  onCreate: (v: ViolationCreate) => Promise<void>
  onUpdate: (id: number, v: ViolationUpdate) => Promise<void>
  onDelete: (id: number) => Promise<void>
}

export function ViolationsTable({
  rows,
  employeeId,
  onCreate,
  onUpdate,
  onDelete,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('violations.title')}</CardTitle>
        <Button size="sm" onClick={() => setAdding((v) => !v)}>
          {adding ? t('common.cancel') : t('violations.add')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        {adding && (
          <div className="border-b border-border p-4">
            <ViolationEditor
              mode="create"
              employeeId={employeeId}
              onCancel={() => setAdding(false)}
              onSubmit={async (v) => {
                await onCreate(v as ViolationCreate)
                setAdding(false)
              }}
            />
          </div>
        )}

        {rows.length === 0 && !adding ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {t('violations.empty')}
          </p>
        ) : (
          <Table className="border-0">
            <TableHeader>
              <TableRow>
                <TableHead>{t('violations.fields.violation_type')}</TableHead>
                <TableHead className="w-[110px]">{t('violations.fields.date')}</TableHead>
                <TableHead className="w-[90px]">
                  {t('violations.fields.deduction_days')}
                </TableHead>
                <TableHead className="w-[110px]">{t('violations.fields.status')}</TableHead>
                <TableHead className="w-[140px] text-end">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) =>
                editingId === row.id ? (
                  <TableRow key={row.id}>
                    <TableCell colSpan={5} className="bg-surface-raised">
                      <ViolationEditor
                        mode="edit"
                        employeeId={employeeId}
                        initial={row}
                        onCancel={() => setEditingId(null)}
                        onSubmit={async (v) => {
                          await onUpdate(row.id, v as ViolationUpdate)
                          setEditingId(null)
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-[260px]">
                      <div className="truncate font-medium text-foreground" title={row.violation_type}>
                        {row.violation_type}
                      </div>
                      {row.description && (
                        <div
                          className="break-words text-xs text-muted-foreground"
                          title={row.description}
                        >
                          {row.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono">{row.date}</TableCell>
                    <TableCell className="font-mono">{row.deduction_days}</TableCell>
                    <TableCell>
                      <Badge tone={row.status === 'Closed' ? 'neutral' : 'warning'} withDot>
                        {t(`violations.status.${row.status}`, { defaultValue: row.status })}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1.5">
                        <SendButton eventType="violation" recordId={row.id} />
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => setEditingId(row.id)}
                        >
                          {t('common.edit')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setDeletingId(row.id)}
                        >
                          {t('common.delete')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <ConfirmDialog
        open={deletingId !== null}
        onOpenChange={(o) => { if (!o) setDeletingId(null) }}
        title={t('violations.confirmDelete')}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          if (deletingId !== null) await onDelete(deletingId)
        }}
        destructive
      />
    </Card>
  )
}

interface EditorProps {
  mode: 'create' | 'edit'
  employeeId: string
  initial?: ViolationRead
  onSubmit: (v: ViolationCreate | ViolationUpdate) => Promise<void>
  onCancel: () => void
}

function ViolationEditor({
  mode,
  employeeId,
  initial,
  onSubmit,
  onCancel,
}: EditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const [violationType, setViolationType] = useState(initial?.violation_type ?? '')
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().slice(0, 10))
  const [description, setDescription] = useState(initial?.description ?? '')
  const [actionTaken, setActionTaken] = useState(initial?.action_taken ?? '')
  const [deductionDays, setDeductionDays] = useState(initial?.deduction_days ?? 0)
  const [status, setStatus] = useState(initial?.status ?? 'Open')
  const [busy, setBusy] = useState(false)

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          if (mode === 'create') {
            await onSubmit({
              employee_id: employeeId,
              violation_type: violationType,
              date,
              description: description || null,
              action_taken: actionTaken || null,
              deduction_days: deductionDays,
              status,
            } satisfies ViolationCreate)
          } else {
            await onSubmit({
              violation_type: violationType,
              date,
              description: description || null,
              action_taken: actionTaken || null,
              deduction_days: deductionDays,
              status,
            } satisfies ViolationUpdate)
          }
        } finally {
          setBusy(false)
        }
      }}
      className="grid grid-cols-1 gap-3 sm:grid-cols-12"
    >
      <div className="flex flex-col gap-1.5 sm:col-span-12">
        <Label>{t('violations.fields.violation_type')}</Label>
        <Input
          value={violationType}
          onChange={(e) => setViolationType(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-4">
        <Label>{t('violations.fields.date')}</Label>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          className="font-mono"
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-4">
        <Label>{t('violations.fields.deduction_days')}</Label>
        <Input
          type="number"
          min={0}
          value={deductionDays}
          onChange={(e) => setDeductionDays(Number(e.target.value) || 0)}
          className="font-mono"
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-4">
        <Label>{t('violations.fields.status')}</Label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Open">{t('violations.status.Open')}</SelectItem>
            <SelectItem value="Closed">{t('violations.status.Closed')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-6">
        <Label>{t('violations.fields.action_taken')}</Label>
        <Input value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-6">
        <Label>{t('violations.fields.description')}</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="flex items-center justify-end gap-2 sm:col-span-12">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </form>
  )
}
