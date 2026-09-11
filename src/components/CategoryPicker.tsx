import { ChevronDown, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Category, TransactionType } from '../types'
import { categoryPath, searchCategories } from '../lib/categories'
import { useI18n } from '../i18n'

export function CategoryPicker({
  categories,
  value,
  onChange,
  type,
  placeholder,
  allowClear = true,
}: {
  categories: Category[]
  value?: string
  onChange: (id: string) => void
  type?: TransactionType
  placeholder?: string
  allowClear?: boolean
}) {
  const { t } = useI18n()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = categories.find((item) => item.id === value)
  const selectedLabel = selected ? categoryPath(selected, categories) : ''
  const results = useMemo(() => searchCategories(categories, query, type), [categories, query, type])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div ref={rootRef} data-enter-consumes="true" className="relative min-w-0">
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); setQuery('') }}
        className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-left text-sm transition hover:border-stone-300 focus:outline-none focus:ring-4 focus:ring-blue-500/10 dark:border-stone-700 dark:bg-stone-950"
      >
        <span className={`min-w-0 flex-1 truncate ${selectedLabel ? 'text-stone-900 dark:text-stone-100' : 'text-stone-400'}`}>{selectedLabel || placeholder || t('categoryPicker.placeholder')}</span>
        {allowClear && value ? <span onClick={(event) => { event.stopPropagation(); onChange('') }} className="rounded-md p-1 text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"><X size={14} /></span> : <ChevronDown size={16} className="shrink-0 text-stone-400" />}
      </button>
      {open && (
        <div className="absolute z-[90] mt-2 w-[min(440px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl shadow-stone-950/10 dark:border-stone-700 dark:bg-stone-950">
          <div className="border-b border-stone-100 p-2 dark:border-stone-800">
            <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('categoryPicker.search')} className="w-full rounded-xl bg-stone-50 py-2.5 pl-9 pr-3 text-sm outline-none ring-blue-500/15 focus:ring-4 dark:bg-stone-900" /></div>
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5">
            {results.length === 0 ? <div className="px-3 py-5 text-center text-sm text-stone-500">{t('categoryPicker.empty')}</div> : results.map((category) => {
              const path = categoryPath(category, categories)
              return <button type="button" key={category.id} onClick={() => { onChange(category.id); setOpen(false); setQuery('') }} className={`block w-full rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-stone-100 dark:hover:bg-stone-900 ${category.id === value ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' : 'text-stone-800 dark:text-stone-200'}`}><div className="font-medium">{category.name}</div>{path !== category.name && <div className="mt-0.5 truncate text-xs text-stone-400">{path}</div>}</button>
            })}
          </div>
        </div>
      )}
    </div>
  )
}