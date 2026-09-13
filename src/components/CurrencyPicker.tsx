import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { useI18n, type UiLanguage } from '../i18n'

const FALLBACK_CURRENCIES = [
  'AED', 'ARS', 'AUD', 'BDT', 'BGN', 'BHD', 'BRL', 'CAD', 'CHF', 'CLP', 'CNY', 'COP',
  'CZK', 'DKK', 'EGP', 'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'JPY', 'KRW',
  'KWD', 'MXN', 'MYR', 'NGN', 'NOK', 'NZD', 'PHP', 'PKR', 'PLN', 'QAR', 'RON', 'RUB',
  'SAR', 'SEK', 'SGD', 'THB', 'TRY', 'TWD', 'UAH', 'USD', 'VND', 'ZAR',
] as const

type IntlWithSupportedValues = typeof Intl & { supportedValuesOf?: (key: 'currency') => string[] }
type CurrencyOption = { code: string; name: string; symbol: string; search: string }
type CurrencyCopy = { invalid: string; search: string; pocket: string; empty: string }

const COPY: Record<UiLanguage, CurrencyCopy> = {
  vi:{invalid:'Mã tiền tệ chưa hợp lệ',search:'Tìm mã hoặc tên tiền tệ…',pocket:'Chọn pocket tiền tệ của tài khoản',empty:'Không tìm thấy tiền tệ phù hợp.'},
  en:{invalid:'Invalid currency code',search:'Search by code or currency name…',pocket:'Choose an account currency pocket',empty:'No matching currency found.'},
  ja:{invalid:'無効な通貨コード',search:'通貨コードまたは名前を検索…',pocket:'口座の通貨ポケットを選択',empty:'一致する通貨がありません。'},
  'zh-CN':{invalid:'无效的币种代码',search:'搜索币种代码或名称…',pocket:'选择账户中的币种余额',empty:'未找到匹配的币种。'},
  'zh-TW':{invalid:'無效的幣別代碼',search:'搜尋幣別代碼或名稱…',pocket:'選擇帳戶中的幣別餘額',empty:'找不到符合的幣別。'},
  th:{invalid:'รหัสสกุลเงินไม่ถูกต้อง',search:'ค้นหารหัสหรือชื่อสกุลเงิน…',pocket:'เลือกสกุลเงินของบัญชี',empty:'ไม่พบสกุลเงินที่ตรงกัน'},
  id:{invalid:'Kode mata uang tidak valid',search:'Cari kode atau nama mata uang…',pocket:'Pilih saldo mata uang akun',empty:'Mata uang yang cocok tidak ditemukan.'},
  es:{invalid:'Código de moneda no válido',search:'Buscar por código o nombre de moneda…',pocket:'Elige una moneda de la cuenta',empty:'No se encontró ninguna moneda coincidente.'},
  fr:{invalid:'Code de devise non valide',search:'Rechercher par code ou nom de devise…',pocket:'Choisir une devise du compte',empty:'Aucune devise correspondante.'},
  de:{invalid:'Ungültiger Währungscode',search:'Nach Währungscode oder -name suchen…',pocket:'Währungssaldo des Kontos auswählen',empty:'Keine passende Währung gefunden.'},
  'pt-BR':{invalid:'Código de moeda inválido',search:'Buscar por código ou nome da moeda…',pocket:'Escolha uma moeda da conta',empty:'Nenhuma moeda correspondente encontrada.'},
  ru:{invalid:'Недопустимый код валюты',search:'Поиск по коду или названию валюты…',pocket:'Выберите валюту счёта',empty:'Подходящая валюта не найдена.'},
}

function supportedCurrencyCodes() {
  try {
    const values = (Intl as IntlWithSupportedValues).supportedValuesOf?.('currency')
    if (values?.length) return values
  } catch { /* fallback below */ }
  return [...FALLBACK_CURRENCIES]
}

function currencySymbol(code: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((item) => item.type === 'currency')?.value ?? code
  } catch { return code }
}

function currencyName(code: string, locale: string) {
  try { return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code } catch { return code }
}

function buildOptions(locale: string): CurrencyOption[] {
  return supportedCurrencyCodes().map((code) => {
    const name = currencyName(code, locale)
    const symbol = currencySymbol(code, locale)
    return { code, name, symbol, search: `${code} ${name} ${symbol}`.toLocaleLowerCase(locale) }
  }).sort((a, b) => a.code.localeCompare(b.code))
}

export function CurrencyPicker({ value, onChange, locale = 'vi-VN' }: { value: string; onChange: (code: string) => void; locale?: string }) {
  const { uiLanguage } = useI18n()
  const copy = COPY[uiLanguage]
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [accountCurrencies, setAccountCurrencies] = useState<string[]>([])
  const normalizedValue = value.trim().toUpperCase()
  const options = useMemo(() => buildOptions(locale), [locale])
  const scopedOptions = accountCurrencies.length ? options.filter((item) => accountCurrencies.includes(item.code)) : options
  const selected = options.find((item) => item.code === normalizedValue)
  const displayedCode = selected?.code ?? (normalizedValue || '—')
  const displayedSymbol = selected?.symbol ?? (normalizedValue || '—')

  useEffect(() => {
    const modal = rootRef.current?.closest('.fixed.inset-0')
    const marker = modal?.querySelector<HTMLElement>('[data-account-currency-source]')
    const next = (marker?.dataset.accountCurrencySource ?? '').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean)
    setAccountCurrencies((current) => current.join(',') === next.join(',') ? current : next)
    if (next.length && !next.includes(normalizedValue)) onChange(next[0])
  })

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale)
    if (!needle) return scopedOptions
    return scopedOptions.filter((item) => item.search.includes(needle))
  }, [locale, query, scopedOptions])

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

  if (accountCurrencies.length === 1) {
    const only = options.find((item) => item.code === accountCurrencies[0])
    return <div ref={rootRef} className="flex w-full items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm dark:border-stone-700 dark:bg-stone-950">
      <span className="w-9 shrink-0 font-bold">{only?.symbol ?? accountCurrencies[0]}</span><span><span className="block font-semibold">{accountCurrencies[0]}</span><span className="block text-xs text-stone-400">{only?.name ?? accountCurrencies[0]}</span></span>
    </div>
  }

  return <div ref={rootRef} className="relative">
    <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="flex w-full items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-left text-sm text-stone-900 outline-none transition hover:border-stone-300 focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:hover:border-stone-600">
      <span className="flex min-w-0 flex-1 items-center gap-2"><span className="w-9 shrink-0 font-bold tabular-nums">{displayedSymbol}</span><span className="min-w-0"><span className="block font-semibold">{displayedCode}</span><span className="block truncate text-xs text-stone-400">{selected?.name ?? copy.invalid}</span></span></span><ChevronDown size={16} className={`shrink-0 text-stone-400 transition ${open ? 'rotate-180' : ''}`}/>
    </button>
    {open && <div className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl dark:border-stone-700 dark:bg-stone-950">
      {accountCurrencies.length === 0 && <div className="border-b border-stone-100 p-2 dark:border-stone-800"><div className="flex items-center gap-2 rounded-lg bg-stone-50 px-2.5 dark:bg-stone-900"><Search size={15} className="shrink-0 text-stone-400"/><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); if (event.key === 'Enter' && filtered[0]) choose(filtered[0].code) }} placeholder={copy.search} className="w-full bg-transparent py-2.5 text-sm text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100"/></div></div>}
      {accountCurrencies.length > 1 && <div className="border-b border-stone-100 px-3 py-2 text-xs text-stone-500 dark:border-stone-800">{copy.pocket}</div>}
      <div role="listbox" className="max-h-72 overflow-y-auto p-1.5">{filtered.length === 0 ? <div className="px-3 py-6 text-center text-sm text-stone-400">{copy.empty}</div> : filtered.map((item) => <button key={item.code} type="button" role="option" aria-selected={item.code === normalizedValue} onClick={() => choose(item.code)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-stone-100 dark:hover:bg-stone-900"><span className="w-10 shrink-0 text-sm font-semibold">{item.code}</span><span className="w-9 shrink-0 text-sm text-stone-500">{item.symbol}</span><span className="min-w-0 flex-1 truncate text-sm text-stone-600 dark:text-stone-300">{item.name}</span>{item.code === normalizedValue && <Check size={15} className="shrink-0 text-blue-500"/>}</button>)}</div>
    </div>}
  </div>
}
