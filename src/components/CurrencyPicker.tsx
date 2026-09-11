import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'

const FALLBACK_CURRENCIES = [
  'AED', 'ARS', 'AUD', 'BDT', 'BGN', 'BHD', 'BRL', 'CAD', 'CHF', 'CLP', 'CNY', 'COP',
  'CZK', 'DKK', 'EGP', 'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'JPY', 'KRW',
  'KWD', 'MXN', 'MYR', 'NGN', 'NOK', 'NZD', 'PHP', 'PKR', 'PLN', 'QAR', 'RON', 'RUB',
  'SAR', 'SEK', 'SGD', 'THB', 'TRY', 'TWD', 'UAH', 'USD', 'VND', 'ZAR',
] as const

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: 'currency') => string[]
}

type CurrencyOption = {
  code: string
  name: string
  symbol: string
  search: string
}

function supportedCurrencyCodes() {
  try {
    const values = (Intl as IntlWithSupportedValues).supportedValuesOf?.('currency')
    if (values?.length) return values
  } catch {
    // Fall through to a stable common-currency list for older browsers.
  }
  return [...FALLBACK_CURRENCIES]
}

function currencySymbol(code: string, locale: string) {
  try {
    const part = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0).find((item) => item.type === 'currency')
    return part?.value ?? code
  } catch {
    return code
  }
}

function currencyName(code: string, locale: string) {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code
  } catch {
    return code
  }
}

function buildOptions(locale: string): CurrencyOption[] {
  return supportedCurrencyCodes()
    .map((code) => {
      const name = currencyName(code, locale)
      const symbol = currencySymbol(code, locale)
      return {
        code,
        name,
        symbol,
        search: `${code} ${name} ${symbol}`.toLocaleLowerCase(locale),
      }
    })
    .sort((a, b) => a.code.localeCompare(b.code))
}

export function CurrencyPicker({
  value,
  onChange,
  locale = 'vi-VN',
}: {
  value: string
  onChange: (code: string) => void
  locale?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const normalizedValue = value.trim().toUpperCase()
  const options = useMemo(() => buildOptions(locale), [locale])
  const selected = options.find((item) => item.code === normalizedValue)

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale)
    if (!needle) return options
    return options.filter((item) => item.search.includes(needle))
  }, [locale, options, query])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    requestAnimationFrame(() => searchRef.current?.focus())
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function choose(code: string) {
    onChange(code)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-left text-sm text-stone-900 outline-none transition hover:border-stone-300 focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:hover:border-stone-600"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="w-9 shrink-0 font-bold tabular-nums">{selected?.symbol ?? normalizedValue || '—'}</span>
          <span className="min-w-0">
            <span className="block font-semibold">{selected?.code ?? normalizedValue || '—'}</span>
            <span className="block truncate text-xs text-stone-400">{selected?.name ?? (locale.startsWith('vi') ? 'Mã tiền tệ chưa hợp lệ' : 'Invalid currency code')}</span>
          </span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-stone-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl dark:border-stone-700 dark:bg-stone-950">
          <div className="border-b border-stone-100 p-2 dark:border-stone-800">
            <div className="flex items-center gap-2 rounded-lg bg-stone-50 px-2.5 dark:bg-stone-900">
              <Search size={15} className="shrink-0 text-stone-400" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setOpen(false)
                  if (event.key === 'Enter' && filtered[0]) choose(filtered[0].code)
                }}
                placeholder={locale.startsWith('vi') ? 'Tìm mã hoặc tên tiền tệ…' : 'Search code or currency name…'}
                className="w-full bg-transparent py-2.5 text-sm text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100"
              />
            </div>
          </div>
          <div role="listbox" className="max-h-72 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-stone-400">
                {locale.startsWith('vi') ? 'Không tìm thấy tiền tệ phù hợp.' : 'No matching currency found.'}
              </div>
            ) : filtered.map((item) => (
              <button
                key={item.code}
                type="button"
                role="option"
                aria-selected={item.code === normalizedValue}
                onClick={() => choose(item.code)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-stone-100 dark:hover:bg-stone-900"
              >
                <span className="w-10 shrink-0 text-sm font-semibold">{item.code}</span>
                <span className="w-9 shrink-0 text-sm text-stone-500">{item.symbol}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-stone-600 dark:text-stone-300">{item.name}</span>
                {item.code === normalizedValue && <Check size={15} className="shrink-0 text-blue-500" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
