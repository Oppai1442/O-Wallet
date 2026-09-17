const CURRENCY_NATIVE_LOCALES: Record<string, string> = {
  VND: 'vi-VN',
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
  JPY: 'ja-JP',
  CNY: 'zh-CN',
  TWD: 'zh-TW',
  HKD: 'zh-HK',
  SGD: 'en-SG',
  THB: 'th-TH',
  IDR: 'id-ID',
  INR: 'en-IN',
  KRW: 'ko-KR',
  RUB: 'ru-RU',
  BRL: 'pt-BR',
  CAD: 'en-CA',
  AUD: 'en-AU',
  CHF: 'de-CH',
  MYR: 'ms-MY',
  PHP: 'en-PH',
}

interface CurrencyPlacement {
  symbol: string
  position: 'prefix' | 'suffix'
  spacing: boolean
}

function normalizedCurrencyCode(currency: string | undefined) {
  return (currency ?? '').trim().toUpperCase()
}

function fallbackNumber(value: number, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
  } catch {
    return String(value)
  }
}

function nativeCurrencyPlacement(code: string): CurrencyPlacement | undefined {
  const nativeLocale = CURRENCY_NATIVE_LOCALES[code]
  if (!nativeLocale) return undefined
  try {
    const parts = new Intl.NumberFormat(nativeLocale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(1)
    const currencyIndex = parts.findIndex((part) => part.type === 'currency')
    const integerIndex = parts.findIndex((part) => part.type === 'integer')
    if (currencyIndex < 0 || integerIndex < 0) return undefined
    const start = Math.min(currencyIndex, integerIndex)
    const end = Math.max(currencyIndex, integerIndex)
    return {
      symbol: parts[currencyIndex].value,
      position: currencyIndex < integerIndex ? 'prefix' : 'suffix',
      spacing: parts.slice(start + 1, end).some((part) => part.type === 'literal' && /\s/u.test(part.value)),
    }
  } catch {
    return undefined
  }
}

function currencyFractionDigits(code: string, locale: string) {
  try {
    const options = new Intl.NumberFormat(locale, { style: 'currency', currency: code }).resolvedOptions()
    return {
      minimumFractionDigits: options.minimumFractionDigits,
      maximumFractionDigits: options.maximumFractionDigits,
    }
  } catch {
    return { minimumFractionDigits: 0, maximumFractionDigits: 2 }
  }
}

function formatCurrencyByNativePlacement(value: number, code: string, locale: string, compact = false) {
  const placement = nativeCurrencyPlacement(code)
  if (!placement) return undefined
  try {
    const digits = currencyFractionDigits(code, locale)
    const absolute = Math.abs(value)
    const number = new Intl.NumberFormat(locale, compact ? {
      notation: 'compact',
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    } : digits).format(absolute)
    const sign = value < 0 || Object.is(value, -0) ? '-' : ''
    const gap = placement.spacing ? '\u00a0' : ''
    return placement.position === 'prefix'
      ? `${sign}${placement.symbol}${gap}${number}`
      : `${sign}${number}${gap}${placement.symbol}`
  } catch {
    return undefined
  }
}

export function formatMoney(value: number, currency = 'VND', locale = 'vi-VN') {
  const code = normalizedCurrencyCode(currency)
  if (!/^[A-Z]{3}$/.test(code)) return `${fallbackNumber(value, locale)}${code ? ` ${code}` : ''}`

  const nativePlaced = formatCurrencyByNativePlacement(value, code, locale)
  if (nativePlaced !== undefined) return nativePlaced

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
    }).format(value)
  } catch {
    return `${fallbackNumber(value, locale)} ${code}`
  }
}

export function formatCompactMoney(value: number, locale = 'vi-VN', currency?: string) {
  const code = normalizedCurrencyCode(currency)
  if (code && /^[A-Z]{3}$/.test(code)) {
    const nativePlaced = formatCurrencyByNativePlacement(value, code, locale, true)
    if (nativePlaced !== undefined) return nativePlaced
  }
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatDateTime(iso: string, locale = 'vi-VN') {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso))
}

export function toLocalInputDateTime(iso?: string) {
  const date = iso ? new Date(iso) : new Date()
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function fromLocalInputDateTime(value: string) {
  return new Date(value).toISOString()
}

export function bytesToHuman(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function clampText(text: string, max = 80) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}
