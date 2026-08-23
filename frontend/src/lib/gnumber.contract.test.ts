import { describe, expect, it } from 'vitest'

import cases from '../../../shared/contracts/gnumber_cases.json'
import { gNumberRegex } from './gnumber'

type Case = { text: string; matches: string[] }

type Contract = { valid: Case[]; invalid: Case[] }

const contract = cases as Contract

function matches(text: string): string[] {
  return [...text.matchAll(gNumberRegex())].map((match) => match[0].toUpperCase()).filter((value, index, all) => all.indexOf(value) === index)
}

describe('G-number detector contract', () => {
  for (const example of [...contract.valid, ...contract.invalid]) {
    it(`matches ${JSON.stringify(example.text)}`, () => {
      expect(matches(example.text)).toEqual(example.matches)
    })
  }
})
