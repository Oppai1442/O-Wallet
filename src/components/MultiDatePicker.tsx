import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { useI18n } from '../i18n'
import { Button } from './ui'

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function monthStart(input?: string) {
  const value = input ? new Date(`${input}T12:00:00`) : new Date()
  return new Date(value.getFullYear(), value.getMonth(), 1, 12)
}

export function MultiDatePicker({ selected, onChange }: { selected: string[]; onChange: (dates: string[]) => void }) {
  const { t, locale } = useI18n()
  const [month, setMonth] = useState(() => monthStart(selected[0]))
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const firstWeekday = (month.getDay() + 6) % 7 // Monday-first
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const today = (() => {
    const now = new Date()
    return dateKey(now.getFullYear(), now.getMonth(), now.getDate())
  })()
  const weekDays = useMemo(() => {
    const monday = new Date(2024, 0, 1)
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(monday)
      day.setDate(monday.getDate() + index)
      return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(day)
    })
  }, [locale])

  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1
    return day >= 1 && day <= daysInMonth ? day : undefined
  })

  function toggle(key: string) {
    const next = new Set(selectedSet)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange([...next].sort())
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" className="px-2" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1, 12))}><ChevronLeft size={17} /></Button>
        <div className="text-sm font-semibold text-stone-900 dark:text-white">{new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(month)}</div>
        <Button variant="ghost" className="px-2" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1, 12))}><ChevronRight size={17} /></Button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wide text-stone-400">
        {weekDays.map((day) => <div key={day} className="py-1">{day}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (!day) return <div key={`blank-${index}`} className="aspect-square" />
          const key = dateKey(month.getFullYear(), month.getMonth(), day)
          const active = selectedSet.has(key)
          const isToday = key === today
          return (
            <button
              type="button"
              key={key}
              onClick={() => toggle(key)}
              className={`aspect-square rounded-xl text-sm font-bold transition ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800'} ${isToday && !active ? 'ring-1 ring-inset ring-blue-400' : ''}`}
            >
              {day}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 pt-3 text-xs dark:border-stone-800">
        <span className="font-semibold text-stone-500">{t('schedule.selectedDates', { count: selected.length })}</span>
        {selected.length > 0 && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onChange([])}><RotateCcw size={14} /> {t('schedule.clearDates')}</Button>}
      </div>
    </div>
  )
}
