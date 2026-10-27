import { Lock, ShieldAlert, UserRound } from 'lucide-react'
import type { Grade } from '@/lib/api'

/** The fixed grade vocabulary, labels and marks shared by record surfaces. */
export const GRADES = ['unclassified', 'secret', 'top_secret', 'addressee_only'] as const satisfies readonly Grade[]
export const GRADE_META = {
  unclassified: { label: 'books.grade.levels.unclassified', icon: null, className: '' },
  secret: { label: 'books.grade.levels.secret', icon: Lock, className: 'bg-destructive/10 text-destructive' },
  top_secret: { label: 'books.grade.levels.top_secret', icon: ShieldAlert, className: 'bg-destructive/10 text-destructive' },
  addressee_only: { label: 'books.grade.levels.addressee_only', icon: UserRound, className: 'bg-info-soft text-info' },
} as const

export function isWriterOnlyGrade(grade: Grade): boolean {
  return grade === 'top_secret' || grade === 'addressee_only'
}
