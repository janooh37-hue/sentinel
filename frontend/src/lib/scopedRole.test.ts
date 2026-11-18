import { describe, expect, it } from 'vitest'

import { scopedDestinations, scopedRoleOf, scopedRouteAllowed } from './scopedRole'

const noCapabilities = () => false
const vehiclesOnly = (cap: string) => cap === 'vehicles.view'

describe('scopedRoleOf', () => {
  it('uses the server scoped marker, not the role label', () => {
    expect(scopedRoleOf({ scoped_role: 'fleet_reporter' })).toBe('fleet_reporter')
    expect(scopedRoleOf({ scoped_role: 'inmate_reporter' })).toBe('inmate_reporter')
    expect(scopedRoleOf({ scoped_role: null })).toBeNull()
    expect(scopedRoleOf(null)).toBeNull()
    expect(scopedRoleOf(undefined)).toBeNull()
  })
})

describe('fleet reporter routes', () => {
  it.each(['/', '/services', '/services/general_book', '/services/report', '/books', '/books/42', '/books/42/'])('allows %s without vehicle access', (path) => {
    expect(scopedRouteAllowed('fleet_reporter', path, noCapabilities)).toBe(true)
  })

  it.each(['/employees', '/settings', '/ledger', '/permissions', '/books/approvals', '/books/42/word', '/services/inmate_conduct_violations', '/services/vehicle_fines', '/application', '/vehicles-other', '/unknown'])('redirects %s even with vehicle access', (path) => {
    expect(scopedRouteAllowed('fleet_reporter', path, vehiclesOnly)).toBe(false)
  })

  it.each(['/vehicles', '/vehicles/', '/vehicles/42', '/vehicles/42/fines-letter', '/vehicles/accidents/17/letter', '/vehicles/edit/42'])('requires vehicles.view for %s', (path) => {
    expect(scopedRouteAllowed('fleet_reporter', path, noCapabilities)).toBe(false)
    expect(scopedRouteAllowed('fleet_reporter', path, vehiclesOnly)).toBe(true)
  })

  it('adds Vehicles only when held', () => {
    expect(scopedDestinations('fleet_reporter', noCapabilities)).toEqual(['/', '/services', '/books'])
    expect(scopedDestinations('fleet_reporter', vehiclesOnly)).toEqual(['/', '/services', '/books', '/vehicles'])
  })
})

describe('unchanged inmate shell', () => {
  it.each(['/', '/services', '/books', '/books/42', '/services/inmate_conduct_violations', '/application', '/books/42/'])('allows %s', (path) => {
    expect(scopedRouteAllowed('inmate_reporter', path, noCapabilities)).toBe(true)
  })

  it.each(['/vehicles', '/vehicles/42', '/settings', '/employees', '/ledger', '/books/approvals', '/books/42/word', '/services/general_book', '/services/report', '/unknown'])('redirects %s regardless of capabilities', (path) => {
    expect(scopedRouteAllowed('inmate_reporter', path, () => true)).toBe(false)
  })

  it('keeps the same three fixed destinations', () => {
    expect(scopedDestinations('inmate_reporter', () => true)).toEqual(['/', '/services', '/books'])
  })
})
