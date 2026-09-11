import type { AppSettings } from '../types'

type CurrencyAwareSettings = AppSettings & {
  /** Preferred currency for a brand-new transaction before a last-used currency exists. */
  transactionCurrency?: string
}

const LAST_TRANSACTION_CURRENCY_PREFIX = 'owallet.last-transaction-currency.v1:'

function cleanCurrency(value: string | undefined, fallback = 'VND') {
  const code = value?.trim().toUpperCase()
  return code && /^[A-Z]{3}$/.test(code) ? code : fallback
}

export function reportingCurrency(settings?: AppSettings) {
  return cleanCurrency(settings?.defaultCurrency, 'VND')
}

export function defaultTransactionCurrency(settings?: AppSettings) {
  return cleanCurrency((settings as CurrencyAwareSettings | undefined)?.transactionCurrency, reportingCurrency(settings))
}

export function transactionCurrencySettingPatch(code: string) {
  return { transactionCurrency: cleanCurrency(code) } as Partial<AppSettings>
}

function storageKey(vaultCreatedAt?: string) {
  return `${LAST_TRANSACTION_CURRENCY_PREFIX}${encodeURIComponent(vaultCreatedAt || 'local')}`
}

export function lastTransactionCurrency(vaultCreatedAt: string | undefined, settings?: AppSettings) {
  try {
    const stored = localStorage.getItem(storageKey(vaultCreatedAt))
    return cleanCurrency(stored || undefined, defaultTransactionCurrency(settings))
  } catch {
    return defaultTransactionCurrency(settings)
  }
}

export function rememberTransactionCurrency(vaultCreatedAt: string | undefined, code: string) {
  const normalized = cleanCurrency(code)
  try { localStorage.setItem(storageKey(vaultCreatedAt), normalized) } catch { /* best-effort device preference */ }
  return normalized
}
