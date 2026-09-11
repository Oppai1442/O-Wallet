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

export function formatMoney(value: number, currency = 'VND', locale = 'vi-VN') {
  const code = normalizedCurrencyCode(currency)
  if (!/^[A-Z]{3}$/.test(code)) return `${fallbackNumber(value, locale)}${code ? ` ${code}` : ''}`
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
    }).format(value)
  } catch {
    return `${fallbackNumber(value, locale)} ${code}`
  }
}

export function formatCompactMoney(value: number, locale = 'vi-VN') {
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
