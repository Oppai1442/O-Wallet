import type { Category, Transaction } from '../types'
import { effectiveTransactions } from './scheduling'
import { transactionValueInBase } from './fx'

export type RangeKey = '7d' | '30d' | '3m' | '6m' | '1y' | 'all'

export function rangeStart(range: RangeKey, transactions: Transaction[], nowMs = Date.now()) {
  const now = new Date(nowMs)
  const effective = effectiveTransactions(transactions, nowMs)
  switch (range) {
    case '7d': return new Date(now.getTime() - 7 * 86_400_000)
    case '30d': return new Date(now.getTime() - 30 * 86_400_000)
    case '3m': return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())
    case '6m': return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate())
    case '1y': return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
    case 'all': {
      const earliest = effective.reduce<number>((min, item) => Math.min(min, new Date(item.occurredAt).getTime()), Date.now())
      return new Date(earliest)
    }
  }
}

export function filteredTransactions(transactions: Transaction[], range: RangeKey, now = Date.now()) {
  const start = rangeStart(range, transactions, now).getTime()
  return effectiveTransactions(transactions, now).filter((item) => new Date(item.occurredAt).getTime() >= start)
}

export function summarize(transactions: Transaction[], baseCurrency = 'VND') {
  let income = 0
  let expense = 0
  let unconverted = 0
  transactions.forEach((item) => {
    const value = transactionValueInBase(item, baseCurrency)
    if (value === undefined) {
      if (item.type !== 'transfer') unconverted += 1
      return
    }
    if (item.type === 'income') income += value
    if (item.type === 'expense') expense += value
  })
  return { income, expense, net: income - expense, unconverted }
}

export function categoryBreakdown(
  transactions: Transaction[],
  categories: Category[],
  displayName: (category: Category) => string = (category) => category.name,
  fallbackName = 'Other',
  baseCurrency = 'VND',
) {
  const names = new Map(categories.map((category) => [category.id, displayName(category)]))
  const sums = new Map<string, number>()
  transactions.filter((item) => item.type === 'expense').forEach((item) => {
    const value = transactionValueInBase(item, baseCurrency)
    if (value === undefined) return
    sums.set(item.categoryId, (sums.get(item.categoryId) ?? 0) + value)
  })
  return [...sums.entries()]
    .map(([id, value]) => ({ id, name: names.get(id) ?? fallbackName, value }))
    .sort((a, b) => b.value - a.value)
}

export function trendData(transactions: Transaction[], range: RangeKey, locale = 'vi-VN', baseCurrency = 'VND') {
  const map = new Map<string, { label: string; income: number; expense: number }>()
  const monthly = ['3m', '6m', '1y', 'all'].includes(range)
  const fmt = monthly
    ? new Intl.DateTimeFormat(locale, { month: '2-digit', year: '2-digit' })
    : new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' })

  transactions.forEach((item) => {
    const value = transactionValueInBase(item, baseCurrency)
    if (value === undefined) return
    const date = new Date(item.occurredAt)
    const key = monthly
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      : date.toISOString().slice(0, 10)
    const current = map.get(key) ?? { label: fmt.format(date), income: 0, expense: 0 }
    if (item.type === 'income') current.income += value
    if (item.type === 'expense') current.expense += value
    map.set(key, current)
  })

  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value)
}
