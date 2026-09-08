import type { Category, Transaction } from '../types'

export type RangeKey = '7d' | '30d' | '3m' | '6m' | '1y' | 'all'

export function rangeStart(range: RangeKey, transactions: Transaction[]) {
  const now = new Date()
  switch (range) {
    case '7d': return new Date(now.getTime() - 7 * 86_400_000)
    case '30d': return new Date(now.getTime() - 30 * 86_400_000)
    case '3m': return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())
    case '6m': return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate())
    case '1y': return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
    case 'all': {
      const earliest = transactions.reduce<number>((min, item) => Math.min(min, new Date(item.occurredAt).getTime()), Date.now())
      return new Date(earliest)
    }
  }
}

export function filteredTransactions(transactions: Transaction[], range: RangeKey) {
  const start = rangeStart(range, transactions).getTime()
  return transactions.filter((item) => !item.deleted && new Date(item.occurredAt).getTime() >= start)
}

export function summarize(transactions: Transaction[]) {
  let income = 0
  let expense = 0
  transactions.forEach((item) => {
    if (item.type === 'income') income += item.amount
    if (item.type === 'expense') expense += item.amount
  })
  return { income, expense, net: income - expense }
}

export function categoryBreakdown(transactions: Transaction[], categories: Category[]) {
  const names = new Map(categories.map((category) => [category.id, category.name]))
  const sums = new Map<string, number>()
  transactions.filter((item) => item.type === 'expense').forEach((item) => {
    sums.set(item.categoryId, (sums.get(item.categoryId) ?? 0) + item.amount)
  })
  return [...sums.entries()]
    .map(([id, value]) => ({ id, name: names.get(id) ?? 'Khác', value }))
    .sort((a, b) => b.value - a.value)
}

export function trendData(transactions: Transaction[], range: RangeKey) {
  const map = new Map<string, { label: string; income: number; expense: number }>()
  const monthly = ['3m', '6m', '1y', 'all'].includes(range)
  const fmt = monthly
    ? new Intl.DateTimeFormat('vi-VN', { month: '2-digit', year: '2-digit' })
    : new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' })

  transactions.forEach((item) => {
    const date = new Date(item.occurredAt)
    const key = monthly
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      : date.toISOString().slice(0, 10)
    const current = map.get(key) ?? { label: fmt.format(date), income: 0, expense: 0 }
    if (item.type === 'income') current.income += item.amount
    if (item.type === 'expense') current.expense += item.amount
    map.set(key, current)
  })

  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value)
}
