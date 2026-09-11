import type { FxSnapshot, Transaction } from '../types'

const API_ROOT = 'https://api.frankfurter.dev/v2'
const CACHE_PREFIX = 'owallet.fx.v1:'
const MAX_CACHE_AGE_MS = 45 * 24 * 60 * 60 * 1000

type CachedRate = {
  baseCurrency: string
  quoteCurrency: string
  requestedDate: string
  rateDate: string
  rate: number
  fetchedAt: string
}

type FrankfurterRate = {
  date?: string
  base?: string
  quote?: string
  rate?: number
}

function cleanCurrency(value: string) {
  return value.trim().toUpperCase().slice(0, 12)
}

function cacheKey(from: string, to: string, requestedDate: string) {
  return `${CACHE_PREFIX}${requestedDate}:${cleanCurrency(from)}:${cleanCurrency(to)}`
}

function readCache(from: string, to: string, requestedDate: string) {
  try {
    const raw = localStorage.getItem(cacheKey(from, to, requestedDate))
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as CachedRate
    if (!Number.isFinite(parsed.rate) || parsed.rate <= 0) return undefined
    if (Date.now() - Date.parse(parsed.fetchedAt) > MAX_CACHE_AGE_MS) return undefined
    return parsed
  } catch {
    return undefined
  }
}

function writeCache(entry: CachedRate) {
  try { localStorage.setItem(cacheKey(entry.baseCurrency, entry.quoteCurrency, entry.requestedDate), JSON.stringify(entry)) } catch { /* best-effort public cache */ }
}

function requestedDateFromIso(iso: string) {
  return new Date(iso).toISOString().slice(0, 10)
}

async function fetchFrankfurterRate(from: string, to: string, requestedDate: string): Promise<CachedRate> {
  const source = cleanCurrency(from)
  const target = cleanCurrency(to)
  const today = new Date().toISOString().slice(0, 10)
  const date = requestedDate > today ? today : requestedDate
  const url = new URL(`${API_ROOT}/rates`)
  url.searchParams.set('base', source)
  url.searchParams.set('quotes', target)
  url.searchParams.set('date', date)
  const response = await fetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer' })
  if (!response.ok) throw new Error(`FX API ${response.status}`)
  const payload = await response.json() as FrankfurterRate[] | FrankfurterRate
  const row = Array.isArray(payload) ? payload[0] : payload
  const rate = Number(row?.rate)
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('error.fxUnavailable')
  const fetchedAt = new Date().toISOString()
  const entry: CachedRate = {
    baseCurrency: source,
    quoteCurrency: target,
    requestedDate,
    rateDate: row?.date || date,
    rate,
    fetchedAt,
  }
  writeCache(entry)
  return entry
}

export async function getFxRate(from: string, to: string, requestedDate: string, force = false) {
  const source = cleanCurrency(from)
  const target = cleanCurrency(to)
  if (!source || !target) throw new Error('error.fxUnavailable')
  if (source === target) return { baseCurrency: source, quoteCurrency: target, requestedDate, rateDate: requestedDate, rate: 1, fetchedAt: new Date().toISOString() } satisfies CachedRate
  if (!force) {
    const cached = readCache(source, target, requestedDate)
    if (cached) return cached
  }
  return fetchFrankfurterRate(source, target, requestedDate)
}

export async function buildFxSnapshot(amount: number, currency: string, baseCurrency: string, occurredAt: string, force = false): Promise<FxSnapshot | undefined> {
  const source = cleanCurrency(currency)
  const target = cleanCurrency(baseCurrency)
  if (!source || !target || source === target) return undefined
  const requestedDate = requestedDateFromIso(occurredAt)
  const rate = await getFxRate(source, target, requestedDate, force)
  return {
    baseCurrency: target,
    rate: rate.rate,
    convertedAmount: amount * rate.rate,
    requestedDate,
    rateDate: rate.rateDate,
    provider: 'frankfurter',
    fetchedAt: rate.fetchedAt,
  }
}

export function manualFxSnapshot(amount: number, currency: string, baseCurrency: string, occurredAt: string, rate: number): FxSnapshot | undefined {
  const source = cleanCurrency(currency)
  const target = cleanCurrency(baseCurrency)
  if (!source || !target || source === target) return undefined
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('error.fxRateInvalid')
  const requestedDate = requestedDateFromIso(occurredAt)
  return {
    baseCurrency: target,
    rate,
    convertedAmount: amount * rate,
    requestedDate,
    rateDate: requestedDate,
    provider: 'manual',
    fetchedAt: new Date().toISOString(),
  }
}

export function transactionValueInBase(transaction: Transaction, baseCurrency: string): number | undefined {
  const target = cleanCurrency(baseCurrency)
  const source = cleanCurrency(transaction.currency)
  if (source === target) return transaction.amount
  if (transaction.fx?.baseCurrency === target && Number.isFinite(transaction.fx.convertedAmount)) return transaction.fx.convertedAmount
  return undefined
}

export function withFxSnapshot<T extends Transaction>(transaction: T, fx: FxSnapshot | undefined): T {
  return { ...transaction, fx }
}
