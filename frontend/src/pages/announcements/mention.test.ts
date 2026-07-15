import { describe, expect, it } from 'vitest'
import { applyMentions, mentionDigits, splitMentionParts } from './mention'

describe('mentionDigits', () => {
  it('normalizes like the backend', () => {
    expect(mentionDigits('+971 50 905 9931')).toBe('971509059931')
    expect(mentionDigits('00971509059931')).toBe('971509059931')
    expect(mentionDigits('0509059931')).toBe('971509059931')
    expect(mentionDigits('abc')).toBe('')
  })

  it('prefixes 971 on bare 9-digit local mobiles (how contacts are stored)', () => {
    expect(mentionDigits('589911905')).toBe('971589911905')
    expect(mentionDigits('50 112 2877')).toBe('971501122877')
    expect(mentionDigits('.....')).toBe('')
  })
})

describe('applyMentions', () => {
  it('replaces @Name tokens with @digits and collects numbers', () => {
    const r = applyMentions('Hi @Omar Al-Rashid, see roster', [
      { name: 'Omar Al-Rashid', number: '+971509059931' },
    ])
    expect(r.text).toBe('Hi @971509059931, see roster')
    expect(r.numbers).toEqual(['971509059931'])
  })
  it('skips mentions the operator edited away', () => {
    const r = applyMentions('no tags here', [{ name: 'Omar', number: '0501234567' }])
    expect(r.text).toBe('no tags here')
    expect(r.numbers).toEqual([])
  })
  it('handles prefix-overlapping names (longest first)', () => {
    const r = applyMentions('@Omar Ali and @Omar', [
      { name: 'Omar', number: '0500000001' },
      { name: 'Omar Ali', number: '0500000002' },
    ])
    expect(r.text).toBe('@971500000002 and @971500000001')
  })
  it('drops mentions without a usable number', () => {
    const r = applyMentions('@Ghost hi', [{ name: 'Ghost', number: 'n/a' }])
    expect(r.text).toBe('@Ghost hi')
    expect(r.numbers).toEqual([])
  })
})

describe('splitMentionParts', () => {
  it('splits text into text/mention parts', () => {
    expect(splitMentionParts('Hi @Omar!', ['Omar'])).toEqual([
      { kind: 'text', value: 'Hi ' },
      { kind: 'mention', value: '@Omar' },
      { kind: 'text', value: '!' },
    ])
  })
  it('returns single text part when no names match', () => {
    expect(splitMentionParts('plain', ['Omar'])).toEqual([{ kind: 'text', value: 'plain' }])
  })
})
