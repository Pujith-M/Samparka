const FALLBACK_PHONE_COUNTRY_CODE = '91'

export function resolvePhoneCountryCode(configuredCountryCode?: string) {
  const countryCode = configuredCountryCode?.trim()
  return countryCode && /^[1-9]\d{0,2}$/.test(countryCode)
    ? countryCode
    : FALLBACK_PHONE_COUNTRY_CODE
}

export const DEFAULT_PHONE_COUNTRY_CODE = resolvePhoneCountryCode(
  import.meta.env.VITE_DEFAULT_PHONE_COUNTRY_CODE,
)
