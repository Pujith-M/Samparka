import { DEFAULT_PHONE_COUNTRY_CODE } from './phoneConfig'

export type ExternalContactAction = 'call' | 'whatsapp'

const ALLOWED_PHONE_CHARACTERS = /^[+\d\s().-]+$/

function normalizedDigits(
  phone: string,
  defaultCountryCode: string,
): string | undefined {
  const value = phone.trim()
  if (!value || !ALLOWED_PHONE_CHARACTERS.test(value)) return undefined
  if (value.slice(1).includes('+')) return undefined

  const digits = value.replace(/\D/g, '')
  if (value.startsWith('+')) return digits

  // Accept numbers already written with the configured country code, with or without '+'.
  const nationalDigits = digits.startsWith('0') ? digits.slice(1) : digits
  if (
    nationalDigits.length > 10 &&
    nationalDigits.startsWith(defaultCountryCode)
  ) {
    return nationalDigits
  }
  return `${defaultCountryCode}${nationalDigits}`
}

export function getTelHref(
  phone: string,
  defaultCountryCode = DEFAULT_PHONE_COUNTRY_CODE,
): string | undefined {
  const digits = normalizedDigits(phone, defaultCountryCode)
  if (!digits || digits.length < 8 || digits.length > 15) return undefined
  return `tel:+${digits}`
}

export function getWhatsAppHref(
  phone: string,
  defaultCountryCode = DEFAULT_PHONE_COUNTRY_CODE,
): string | undefined {
  const digits = normalizedDigits(phone, defaultCountryCode)
  if (!digits || digits.length < 8 || digits.length > 15) return undefined
  return `https://wa.me/${digits}`
}
