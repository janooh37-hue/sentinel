/**
 * Contract between BookRecordPage (which owns every hook, mutation and piece
 * of shared state) and the presentational record pieces it composes:
 * RecordHeader / RecordToolsMenu / RecordDesk / RecordRail / RecordDock.
 *
 *  - `caps`    — permission booleans, computed once in the page.
 *  - `view`    — derived, read-only record state the pieces render.
 *  - `actions` — handlers, refs and setters the pieces call. Built once per
 *                dependency change in the page (`useMemo`), never per piece.
 */

import type { ComponentProps, Dispatch, RefObject, SetStateAction } from 'react'

import type { BookApprovalStepRead, BookRead, BookVersionRead } from '@/lib/api'
import type { BookAnnotationLayer } from '@/components/books/BookAnnotationLayer'
import type { WordReopenTrigger } from '@/components/books/BookWordActions'
import type { AdjustSignatureTrigger } from '@/components/signature/AdjustSignatureAction'
import type { RecordNavContext } from '../useRecordNavContext'
import type { Station } from './RecordRail'

export interface RecordCaps {
  has: (cap: string) => boolean
  canEdit: boolean
  /** Full access AND the live revision — gates every current-record mutation. */
  canMutateCurrent: boolean
  isInmateReporter: boolean
  /** An inmate reporter looking at their own editable REPORT- record. */
  isInmateReport: boolean
  canOverrideState: boolean
  canManageRevisionAccess: boolean
  canManageIncludedPapers: boolean
  canManageSignedPaper: boolean
  canRevise: boolean
  /** The decider may arm the annotation overlay. */
  canMark: boolean
  showSendForApproval: boolean
  showFileSigned: boolean
}

export type RecordAction = 'decide' | 'review' | 'revise' | 'none' | string

export type MarkInput = Parameters<NonNullable<ComponentProps<typeof BookAnnotationLayer>['onCreate']>>[0]

export interface RecordView {
  bookId: number
  isMobile: boolean
  isAr: boolean
  isPending: boolean
  /** Approval state of the book (`none` when absent). */
  state: string
  action: RecordAction
  decision: 'return' | 'reject' | null
  busy: boolean
  submitter: string
  signedSource: string | null
  current: BookVersionRead | undefined
  liveVersion: BookVersionRead | undefined
  currentSteps: BookApprovalStepRead[]
  stations: Station[]
  pdfUrl: string | null
  userId: number | undefined
  backLabel: string
  queue: RecordNavContext['queue']
  armed: boolean
  annotatable: boolean
  annMode: 'view' | 'mark'
  annotations: ComponentProps<typeof BookAnnotationLayer>['annotations']
  markBusy: boolean
  dockHidden: boolean
  recordHasPapers: boolean
  emailingRecord: boolean
  scanBusy: boolean
  wordReopenTrigger: WordReopenTrigger | null
  adjustSigTrigger: AdjustSignatureTrigger | null
  /** Props for the shared return/reject reason form (minus `act`). */
  decisionReasonFormProps: {
    reason: string
    reasonValid: boolean
    busy: boolean
    inputRef: RefObject<HTMLTextAreaElement | null>
    onReasonChange: (reason: string) => void
    onCancel: (act: 'return' | 'reject') => void
    onConfirm: (act: 'return' | 'reject') => void
  }
}

export interface RecordActions {
  back: () => void
  step: RecordNavContext['step']
  setArmedFor: Dispatch<SetStateAction<number | null>>
  setReason: (reason: string) => void
  openOverlay: (value: string, extra?: Record<string, string>) => void
  handleRevise: () => void
  /** Request the unified sign confirmation from a given trigger button. */
  requestSignConfirm: (triggerRef: RefObject<HTMLButtonElement | null>) => void
  openMobileDecision: (decision: 'return' | 'reject') => void
  /** Submit an inmate-reporter record (`useInmateReportSubmit`). */
  submitReport: (bookId: number) => void
  emailViaOutlook: () => Promise<void>
  setUnfileOpen: (open: boolean) => void
  fileSignedCopy: (file: File, ref: string) => Promise<void>
  replaceSignedPaper: (file: File) => Promise<unknown>
  setWordReopenTrigger: (trigger: WordReopenTrigger | null) => void
  setAdjustSigTrigger: (trigger: AdjustSignatureTrigger | null) => void
  createMark: (mark: MarkInput) => void
  deleteMark: (id: number) => void
  onPdfReady: () => void
  fileSignedRef: RefObject<HTMLInputElement | null>
  replaceSignedRef: RefObject<HTMLInputElement | null>
  desktopSignRef: RefObject<HTMLButtonElement | null>
  mobileInlineSignRef: RefObject<HTMLButtonElement | null>
  mobileDockSignRef: RefObject<HTMLButtonElement | null>
  decisionPanelRef: RefObject<HTMLDivElement | null>
  panelReturnButtonRef: RefObject<HTMLButtonElement | null>
  panelRejectButtonRef: RefObject<HTMLButtonElement | null>
}

export interface RecordPieceProps {
  book: BookRead | undefined
  caps: RecordCaps
  view: RecordView
  actions: RecordActions
}
