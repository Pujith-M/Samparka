import { describe, expect, it } from 'vitest'
import { resolvePhoneCountryCode } from './phoneConfig'

describe('phone country configuration', () => {
  it('falls back to India when the setting is missing or invalid', () => {
    expect(resolvePhoneCountryCode()).toBe('91')
    expect(resolvePhoneCountryCode('')).toBe('91')
    expect(resolvePhoneCountryCode('0')).toBe('91')
    expect(resolvePhoneCountryCode('+91')).toBe('91')
  })

  it('accepts a configured country calling code', () => {
    expect(resolvePhoneCountryCode('1')).toBe('1')
    expect(resolvePhoneCountryCode(' 44 ')).toBe('44')
  })
})
