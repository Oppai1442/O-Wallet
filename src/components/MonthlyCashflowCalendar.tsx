import { useMemo } from 'react'
import type { Transaction } from '../types'
import { transactionValueInBase } from '../lib/fx'
import { formatMoney } from '../lib/format'

interface DayTotals {
  income: number
  expense: number
  count: number
}

function monthDate(key: string) {
  const [year, month] = key.split('-').map(Number)
  return new Date(year, month - 1, 1)
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function weekdayLabels(locale: string, mondayFirst: boolean) {
  const base = new Date(2026, 0, 4) // Sunday
  const labels = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(base.getFullYear(), base.getMonth(), base.getDate() + index)))
  return mondayFirst ? [...labels.slice(1), labels[0]] : labels
}

function compactCurrency(value: number, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value)
  } catch {
    return formatMoney(value, currency, locale)
  }
}

export function MonthlyCashflowCalendar({ transactions, selectedMonth, currency, locale, now }: {
  transactions: Transaction[]
  selectedMonth: string
  currency: string
  locale: string
  now: number
}) {
  const firstDay = monthDate(selectedMonth)
  const mondayFirst = locale.startsWith('vi')
  const labels = useMemo(() => weekdayLabels(locale, mondayFirst), [locale, mondayFirst])
  const todayKey = localDateKey(new Date(now))

  const totalsByDay = useMemo(() => {
    const totals = new Map<string, DayTotals>()
    for (const transaction of transactions) {
      if (transaction.type === 'transfer') continue
      const value = transactionValueInBase(transaction, currency)
      if (value === undefined) continue
      const key = localDateKey(new Date(transaction.occurredAt))
      const current = totals.get(key) ?? { income: 0, expense: 0, count: 0 }
      if (transaction.type === 'income') current.income += value
      if (transaction.type === 'expense') current.expense += value
      current.count += 1
      totals.set(key, current)
    }
    return totals
  }, [transactions, currency])

  const cells = useMemo(() => {
    const year = firstDay.getFullYear()
    const month = firstDay.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const nativeStart = firstDay.getDay()
    const leading = mondayFirst ? (nativeStart + 6) % 7 : nativeStart
    const result: Array<{ day?: number; key: string }> = []
    for (let index = 0; index < leading; index += 1) result.push({ key: `before-${index}` })
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day)
      result.push({ day, key: localDateKey(date) })
    }
    while (result.length % 7 !== 0) result.push({ key: `after-${result.length}` })
    return result
  }, [firstDay, mondayFirst])

  const isVi = locale.startsWith('vi')

  return <div className="overflow-x-auto pb-1">
    <div className="min-w-[700px]">
      <div className="grid grid-cols-7 border-b border-stone-200 dark:border-stone-800">
        {labels.map((label) => <div key={label} className="px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-stone-400">{label}</div>)}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-b-2xl border-l border-t border-stone-200 dark:border-stone-800">
        {cells.map((cell) => {
          if (!cell.day) return <div key={cell.key} className="min-h-24 border-b border-r border-stone-200 bg-stone-50/60 dark:border-stone-800 dark:bg-stone-950/30" />
          const totals = totalsByDay.get(cell.key)
          const isToday = cell.key === todayKey
          return <div key={cell.key} className={`relative min-h-24 border-b border-r border-stone-200 p-2.5 dark:border-stone-800 ${isToday ? 'bg-blue-50/70 dark:bg-blue-500/10' : 'bg-white dark:bg-stone-950'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${isToday ? 'bg-blue-600 text-white' : 'text-stone-600 dark:text-stone-300'}`}>{cell.day}</span>
              {totals && <span className="text-[10px] font-medium text-stone-400">{totals.count} {isVi ? 'GD' : 'tx'}</span>}
            </div>
            {totals ? <div className="mt-2 space-y-1">
              {totals.income > 0 && <div className="truncate text-xs font-semibold text-emerald-600 dark:text-emerald-400" title={formatMoney(totals.income, currency, locale)}>+ {compactCurrency(totals.income, currency, locale)}</div>}
              {totals.expense > 0 && <div className="truncate text-xs font-semibold text-rose-600 dark:text-rose-400" title={formatMoney(totals.expense, currency, locale)}>− {compactCurrency(totals.expense, currency, locale)}</div>}
            </div> : <div className="mt-3 text-[11px] text-stone-300 dark:text-stone-700">—</div>}
          </div>
        })}
      </div>
    </div>
  </div>
}
