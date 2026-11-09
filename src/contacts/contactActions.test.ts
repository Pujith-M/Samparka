import { describe, expect, it } from 'vitest'
import { getTelHref, getWhatsAppHref } from './contactActions'

describe('contact action URLs', () => {
  it('applies the India default to local numbers and preserves explicit international prefixes', () => {
    expect(getTelHref(' +91 (98765) 43210 ')).toBe('tel:+919876543210')
    expect(getTelHref('98765 43210')).toBe('tel:+919876543210')
    expect(getTelHref('09876543210')).toBe('tel:+919876543210')
    expect(getTelHref('919876543210')).toBe('tel:+919876543210')
  })

  it('applies the India default to WhatsApp links and uses digits only', () => {
    expect(getWhatsAppHref('+91 (98765) 43210')).toBe(
      'https://wa.me/919876543210',
    )
    expect(getWhatsAppHref('98765 43210')).toBe('https://wa.me/919876543210')
  })

  it('allows the configured default country code to be overridden', () => {
    expect(getTelHref('202 555 0100', '1')).toBe('tel:+12025550100')
    expect(getWhatsAppHref('202 555 0100', '1')).toBe(
      'https://wa.me/12025550100',
    )
  })

  it('rejects malformed or out-of-range numbers', () => {
    expect(getTelHref('abc')).toBeUndefined()
    expect(getTelHref('+1+234')).toBeUndefined()
    expect(getTelHref('1234567890123456')).toBeUndefined()
    expect(getWhatsAppHref('+1234567')).toBeUndefined()
  })
})
