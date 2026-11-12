import type { Grade } from '@/lib/api'
import { GRADES } from './grades'

/** Only an attached classified reference sets a floor, at Secret. */
export function deriveGrades(original: Grade, attached: boolean): readonly Grade[] {
  return original !== 'unclassified' && attached ? GRADES.filter((grade) => grade !== 'unclassified') : GRADES
}
