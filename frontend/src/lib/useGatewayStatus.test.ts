import { describe, expect, it } from 'vitest'
import { pollInterval } from './useGatewayStatus'

describe('pollInterval', () => {
  it('stops polling permanently when disabled', () => {
    expect(pollInterval('disabled')).toBe(false)
  })
  it('polls every 60s otherwise', () => {
    expect(pollInterval('connected')).toBe(60_000)
    expect(pollInterval('disconnected')).toBe(60_000)
    expect(pollInterval('unreachable')).toBe(60_000)
    expect(pollInterval(undefined)).toBe(60_000)
  })
})
