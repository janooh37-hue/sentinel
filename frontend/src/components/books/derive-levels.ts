import { CONFIDENTIALITY_LEVELS, type Confidentiality } from '@/lib/api'

export function deriveLevels(original: Confidentiality, attached: boolean): readonly Confidentiality[] {
  return CONFIDENTIALITY_LEVELS.filter((level) =>
    original === 'secret' && attached ? level === 'secret' : original === 'general' || level !== 'general',
  )
}
