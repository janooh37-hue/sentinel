import type { ArmoryAssignmentLineRead, ArmoryAssignmentSummary, ArmoryReturnLineInput, ArmoryShortfallInput } from '@/lib/api'

type Condition = NonNullable<ArmoryReturnLineInput['condition']>
export const shortfallReasons: readonly ArmoryShortfallInput['reason'][] = ['training', 'incident', 'lost', 'other']

export interface LineEvidence {
  checked: boolean
  condition: Condition
  fault: string
  rounds: string
  badCount: boolean
  reason: ArmoryShortfallInput['reason'] | ''
  reference: string
  note: string
}
export const emptyEvidence: LineEvidence = { checked: false, condition: 'ok', fault: '', rounds: '', badCount: false, reason: '', reference: '', note: '' }

interface StagedLine {
  assignmentId: number
  line: ArmoryAssignmentLineRead
  evidence: LineEvidence
}
export type StagedLines = ReadonlyMap<number, StagedLine>

function sameLine(draft: StagedLine, assignmentId: number, line: ArmoryAssignmentLineRead) {
  const before = draft.line
  return draft.assignmentId === assignmentId && before.item.id === line.item.id && before.item.kind === line.item.kind &&
    before.serial_id === line.serial_id && before.serial_code === line.serial_code && before.batch?.id === line.batch?.id &&
    before.remaining_qty === line.remaining_qty
}

export function evidenceFor(staged: StagedLines, assignmentId: number, line: ArmoryAssignmentLineRead): LineEvidence {
  const draft = staged.get(line.id)
  return draft && sameLine(draft, assignmentId, line) ? draft.evidence : emptyEvidence
}

export function stageLine(staged: StagedLines, assignmentId: number, line: ArmoryAssignmentLineRead, patch: Partial<LineEvidence>): StagedLines {
  const next = new Map(staged)
  const evidence = { ...evidenceFor(staged, assignmentId, line), ...patch }
  const hasEntry = line.item.kind === 'ammunition' ? evidence.rounds !== '' || evidence.badCount : evidence.checked
  if (hasEntry) next.set(line.id, { assignmentId, line, evidence })
  else next.delete(line.id)
  return next
}

export function retainMatchingLines(staged: StagedLines, records: readonly ArmoryAssignmentSummary[]): StagedLines {
  const next = new Map<number, StagedLine>()
  for (const { id, lines } of records) {
    for (const line of lines) {
      const draft = staged.get(line.id)
      if (draft && line.remaining_qty > 0 && sameLine(draft, id, line)) next.set(line.id, draft)
    }
  }
  return next.size === staged.size ? staged : next
}

export function roundsCount(evidence: LineEvidence, remaining: number): number | null {
  if (evidence.badCount || !/^\d+$/.test(evidence.rounds)) return null
  const qty = Number(evidence.rounds)
  return Number.isSafeInteger(qty) && qty <= remaining ? qty : null
}

function validReference(value: string) {
  const length = [...value].length
  return length >= 3 && length <= 80 && /[\p{L}\p{Nd}][\s\S]*[\p{L}\p{Nd}]/u.test(value)
}

export function planReturn(record: ArmoryAssignmentSummary, staged: StagedLines) {
  const lines: ArmoryReturnLineInput[] = []
  let hasShortfall = false
  let error: 'countRoundsPrecisely' | 'needFault' | 'needShortfall' | 'needReasonDetail' | null = null
  for (const line of record.lines) {
    if (line.remaining_qty <= 0) continue
    const evidence = evidenceFor(staged, record.id, line)
    const ids = { assignment_line_id: line.id, expected_remaining_qty: line.remaining_qty }
    if (line.item.kind === 'ammunition') {
      if (!evidence.rounds && !evidence.badCount) continue
      const qty = roundsCount(evidence, line.remaining_qty)
      if (qty === null) { error ??= 'countRoundsPrecisely'; continue }
      let shortfall: ArmoryShortfallInput | null = null
      if (qty < line.remaining_qty) {
        hasShortfall = true
        const reference = evidence.reference.trim()
        const note = evidence.note.trim()
        if (!evidence.reason || !validReference(reference)) { error ??= 'needShortfall'; continue }
        if (evidence.reason === 'other' && [...note].length < 3) { error ??= 'needReasonDetail'; continue }
        shortfall = { reason: evidence.reason, reference, note: evidence.reason === 'other' ? note : null }
      }
      lines.push({ ...ids, returned_qty: qty, condition: null, shortfall })
    } else if (evidence.checked) {
      const condition = line.serial_id === null ? null : evidence.condition
      const fault = evidence.fault.trim()
      if (condition === 'repair' && [...fault].length < 3) { error ??= 'needFault'; continue }
      lines.push({ ...ids, returned_qty: line.remaining_qty, condition, shortfall: null, ...(condition === 'repair' ? { fault_note: fault } : {}) })
    }
  }
  return { record, lines, hasShortfall, error }
}
