import { describe, it, expect } from 'vitest'
import { skippedLabelKey, smsDeliveryTone } from './smsDelivery'

describe('smsDeliveryTone', () => {
  it('delivered when gateway confirms delivery', () => {
    expect(smsDeliveryTone({ status: 'sent', delivery_state: 'Delivered' })).toBe('delivered')
  })
  it('failed when SIM reported a failure even though send was accepted', () => {
    expect(smsDeliveryTone({ status: 'sent', delivery_state: 'Failed' })).toBe('failed')
  })
  it('failed when the gateway never accepted the send', () => {
    expect(smsDeliveryTone({ status: 'failed', delivery_state: null })).toBe('failed')
  })
  it('pending when accepted but not yet confirmed', () => {
    expect(smsDeliveryTone({ status: 'sent', delivery_state: null })).toBe('pending')
    expect(smsDeliveryTone({ status: 'sent', delivery_state: 'Sent' })).toBe('pending')
  })
  it('skipped, never failed or pending, when the message was not attempted', () => {
    expect(smsDeliveryTone({ status: 'skipped', delivery_state: null })).toBe('skipped')
  })
})

describe('skippedLabelKey', () => {
  it('names why the message was not sent', () => {
    expect(skippedLabelKey('default_off')).toBe('notify.skipped.defaultOff')
    expect(skippedLabelKey('user_off')).toBe('notify.skipped.userOff')
    expect(skippedLabelKey(null)).toBe('notify.skipped.generic')
  })
})
