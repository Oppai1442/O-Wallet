import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Transaction } from '../types'
import { transactionValueInBase } from '../lib/fx'
import { formatCompactMoney, formatMoney } from '../lib/format'
import { useI18n } from '../i18n'
import { Button } from './ui'

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

function isMondayFirst(locale: string) {
  try {
    const info = (new Intl.Locale(locale) as unknown as { weekInfo?: { firstDay: number } }).weekInfo
    if (info) return info.firstDay === 1
  } catch { /* use fallback */ }
  return !locale.toLowerCase().startsWith('en-us')
}

function weekdayLabels(locale: string, mondayFirst: boolean) {
  const base = new Date(2026, 0, 4)
  const labels = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(base.getFullYear(), base.getMonth(), base.getDate() + index)))
  return mondayFirst ? [...labels.slice(1), labels[0]] : labels
}

export function MonthlyCashflowCalendar({ transactions, selectedMonth, currency, locale, now, onMonthChange, currentMonth }: {
  transactions: Transaction[]
  selectedMonth: string
  currency: string
  locale: string
  now: number
  onMonthChange?: (month: string) => void
  currentMonth?: string
}) {
  const { t } = useI18n()
  const firstDay = monthDate(selectedMonth)
  const mondayFirst = isMondayFirst(locale)
  const labels = useMemo(() => weekdayLabels(locale, mondayFirst), [locale, mondayFirst])
  const todayKey = localDateKey(new Date(now))
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(firstDay)
  const nextDisabled = currentMonth ? selectedMonth >= currentMonth : false

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

  function shift(delta: number) {
    if (!onMonthChange) return
    const next = new Date(firstDay.getFullYear(), firstDay.getMonth() + delta, 1)
    onMonthChange(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
  }

  return <div>
    {onMonthChange && <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-stone-50 px-2 py-1.5 dark:bg-stone-900/60">
      <Button variant="ghost" className="min-h-9 px-2.5" onClick={() => shift(-1)} title={t('analytics.previousMonth')}><ChevronLeft size={17}/></Button>
      <div className="min-w-0 text-center">
        <div className="truncate text-sm font-semibold capitalize text-stone-900 dark:text-white">{monthLabel}</div>
        {currentMonth && selectedMonth !== currentMonth && <button type="button" className="mt-0.5 text-[11px] font-semibold text-blue-600 hover:underline" onClick={() => onMonthChange(currentMonth)}>{t('analytics.backCurrent')}</button>}
      </div>
      <Button variant="ghost" className="min-h-9 px-2.5" disabled={nextDisabled} onClick={() => shift(1)} title={t('analytics.nextMonth')}><ChevronRight size={17}/></Button>
    </div>}

    <div className="w-full overflow-hidden">
      <div className="grid grid-cols-7 border-b border-stone-200 dark:border-stone-800">
        {labels.map((label, index) => <div key={`${label}-${index}`} className="min-w-0 px-0.5 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-stone-400 sm:px-2 sm:text-[11px]">{label}</div>)}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-b-2xl border-l border-t border-stone-200 dark:border-stone-800">
        {cells.map((cell) => {
          if (!cell.day) return <div key={cell.key} className="min-h-16 min-w-0 border-b border-r border-stone-200 bg-stone-50/60 sm:min-h-24 dark:border-stone-800 dark:bg-stone-950/30" />
          const totals = totalsByDay.get(cell.key)
          const isToday = cell.key === todayKey
          return <div key={cell.key} className={`relative min-h-16 min-w-0 overflow-hidden border-b border-r border-stone-200 p-1 sm:min-h-24 sm:p-2.5 dark:border-stone-800 ${isToday ? 'bg-blue-50/70 dark:bg-blue-500/10' : 'bg-white dark:bg-stone-950'}`}>
            <div className="flex items-start justify-between gap-1">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold sm:h-7 sm:w-7 sm:text-xs ${isToday ? 'bg-blue-600 text-white' : 'text-stone-600 dark:text-stone-300'}`}>{cell.day}</span>
              {totals && <span className="hidden truncate text-[10px] font-medium text-stone-400 sm:block">{totals.count} {t('analytics.txShort')}</span>}
            </div>

            {totals ? <div className="mt-1 space-y-0.5 sm:mt-2 sm:space-y-1">
              {totals.income > 0 && <>
                <div className="truncate text-[9px] font-semibold text-emerald-600 sm:hidden dark:text-emerald-400" title={formatMoney(totals.income, currency, locale)}>+{formatCompactMoney(totals.income, locale)}</div>
                <div className="hidden truncate text-xs font-semibold text-emerald-600 sm:block dark:text-emerald-400" title={formatMoney(totals.income, currency, locale)}>+ {formatCompactMoney(totals.income, locale, currency)}</div>
              </>}
              {totals.expense > 0 && <>
                <div className="truncate text-[9px] font-semibold text-rose-600 sm:hidden dark:text-rose-400" title={formatMoney(totals.expense, currency, locale)}>−{formatCompactMoney(totals.expense, locale)}</div>
                <div className="hidden truncate text-xs font-semibold text-rose-600 sm:block dark:text-rose-400" title={formatMoney(totals.expense, currency, locale)}>− {formatCompactMoney(totals.expense, locale, currency)}</div>
              </>}
            </div> : <div className="mt-2 text-center text-[10px] text-stone-300 sm:mt-3 sm:text-left sm:text-[11px] dark:text-stone-700">—</div>}
          </div>
        })}
      </div>
    </div>
  </div>
}
