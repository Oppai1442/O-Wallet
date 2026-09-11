import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Category, Transaction } from '../types'
import { categoryBreakdown, monthKey, summarize, summarizeByCurrency, transactionsInCurrency, transactionsInMonth, trendData } from '../lib/analytics'
import { formatCompactMoney, formatMoney } from '../lib/format'
import { useCurrentTime } from '../lib/useCurrentTime'
import { useI18n } from '../i18n'
import { categoryPath } from '../lib/categories'
import { Button, Card, EmptyState, Select } from './ui'

const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#84cc16', '#f59e0b', '#f97316', '#f43f5e', '#a855f7']
type CurrencyViewMode = 'native' | 'converted'

function monthDate(key: string) {
  const [year, month] = key.split('-').map(Number)
  return new Date(year, month - 1, 1)
}

function shiftMonth(key: string, delta: number) {
  const date = monthDate(key)
  return monthKey(new Date(date.getFullYear(), date.getMonth() + delta, 1))
}

export function LedgerAnalytics({ transactions, categories, currency = 'VND', title, subtitle }: { transactions: Transaction[]; categories: Category[]; currency?: string; title?: string; subtitle?: string }) {
  const { t, locale } = useI18n()
  const now = useCurrentTime()
  const currentMonth = monthKey(now)
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [currencyMode, setCurrencyMode] = useState<CurrencyViewMode>('native')
  const [nativeCurrency, setNativeCurrency] = useState('')

  const filtered = useMemo(() => transactionsInMonth(transactions, selectedMonth, now), [transactions, selectedMonth, now])
  const nativeSummary = useMemo(() => summarizeByCurrency(filtered), [filtered])
  const nativeCurrencies = useMemo(() => nativeSummary.map((item) => item.currency), [nativeSummary])

  useEffect(() => {
    if (!nativeCurrencies.length) { setNativeCurrency(''); return }
    if (!nativeCurrencies.includes(nativeCurrency)) setNativeCurrency(nativeCurrencies.includes(currency) ? currency : nativeCurrencies[0])
  }, [currency, nativeCurrencies, nativeCurrency])

  const convertedSummary = useMemo(() => summarize(filtered, currency), [filtered, currency])
  const chartCurrency = currencyMode === 'converted' ? currency : nativeCurrency || currency
  const chartTransactions = useMemo(
    () => currencyMode === 'converted' ? filtered : transactionsInCurrency(filtered, chartCurrency),
    [chartCurrency, currencyMode, filtered],
  )
  const trend = useMemo(() => trendData(chartTransactions, '30d', locale, chartCurrency), [chartTransactions, locale, chartCurrency])
  const expenseBreakdown = useMemo(() => categoryBreakdown(chartTransactions, categories, (category) => categoryPath(category, categories), t('common.other'), chartCurrency, 'expense'), [chartTransactions, categories, t, chartCurrency])
  const incomeBreakdown = useMemo(() => categoryBreakdown(chartTransactions, categories, (category) => categoryPath(category, categories), t('common.other'), chartCurrency, 'income'), [chartTransactions, categories, t, chartCurrency])
  const selectedNative = nativeSummary.find((item) => item.currency === chartCurrency)
  const activeSummary = currencyMode === 'converted'
    ? convertedSummary
    : { income: selectedNative?.income ?? 0, expense: selectedNative?.expense ?? 0, net: selectedNative?.net ?? 0, unconverted: 0 }

  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(monthDate(selectedMonth))
  const nextDisabled = selectedMonth >= currentMonth
  const missingFxText = locale.startsWith('vi')
    ? `${convertedSummary.unconverted} giao dịch chưa có snapshot tỷ giá sang ${currency} nên chưa được tính khi quy đổi.`
    : `${convertedSummary.unconverted} transaction(s) have no saved FX snapshot to ${currency} and are excluded in converted view.`
  const nativeHint = locale.startsWith('vi')
    ? 'Tiền gốc: giữ riêng từng đơn vị; biểu đồ đang phân tích một currency tại một thời điểm.'
    : 'Native currencies: original units stay separate; charts analyze one currency at a time.'
  const convertedHint = locale.startsWith('vi')
    ? `Quy đổi: hiển thị tháng này theo ${currency} bằng snapshot tỷ giá đã lưu; dữ liệu gốc không đổi.`
    : `Converted: displays this month in ${currency} using saved FX snapshots; original data is unchanged.`

  function NativeValues({ field, tone }: { field: 'income' | 'expense' | 'net'; tone?: string }) {
    if (!nativeSummary.length) return <span className="text-stone-400">—</span>
    return <div className="space-y-1">{nativeSummary.map((item) => <div key={item.currency} className={`text-lg font-semibold ${tone ?? (field === 'net' ? (item.net >= 0 ? 'text-emerald-600' : 'text-rose-600') : '')}`}>{formatMoney(item[field], item.currency, locale)}</div>)}</div>
  }

  function PieCard({ title: pieTitle, data, emptyTitle, emptyText }: { title: string; data: Array<{ id: string; name: string; value: number }>; emptyTitle: string; emptyText: string }) {
    return <Card className="p-4 sm:p-5">
      <h3 className="font-bold text-stone-900 dark:text-white">{pieTitle}</h3>
      <p className="mt-0.5 text-xs text-stone-500">{monthLabel} · {chartCurrency}</p>
      {data.length ? <>
        <div className="mt-2 h-72"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="name" outerRadius={100} innerRadius={56} paddingAngle={2} label={({ name, percent }) => `${name} ${Math.round((percent ?? 0) * 100)}%`}>{data.map((entry, index) => <Cell key={entry.id} fill={COLORS[index % COLORS.length]}/>)}</Pie><Tooltip formatter={(value) => formatMoney(Number(value), chartCurrency, locale)}/></PieChart></ResponsiveContainer></div>
        <div className="mt-1 space-y-2">{data.slice(0, 6).map((item, index) => <div key={item.id} className="flex items-center justify-between gap-3 text-sm"><div className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}/><span className="truncate text-stone-600 dark:text-stone-300">{item.name}</span></div><span className="shrink-0 font-semibold text-stone-700 dark:text-stone-200">{formatMoney(item.value, chartCurrency, locale)}</span></div>)}</div>
      </> : <div className="mt-4"><EmptyState title={emptyTitle} text={emptyText}/></div>}
    </Card>
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-white">{title ?? t('analytics.title')}</h2><p className="mt-1 text-sm text-stone-500">{subtitle ?? t('analytics.subtitle')}</p><p className="mt-1 text-xs text-stone-400">{currencyMode === 'native' ? nativeHint : convertedHint}</p>{currencyMode === 'converted' && convertedSummary.unconverted > 0 && <p className="mt-1 text-xs font-semibold text-amber-600 dark:text-amber-400">{missingFxText}</p>}</div>
      <div className="flex flex-wrap gap-2">
        <Select className="w-40" value={currencyMode} onChange={(e) => setCurrencyMode(e.target.value as CurrencyViewMode)}><option value="native">{locale.startsWith('vi') ? 'Tiền gốc' : 'Native currencies'}</option><option value="converted">{locale.startsWith('vi') ? `Quy đổi → ${currency}` : `Convert → ${currency}`}</option></Select>
        {currencyMode === 'native' && nativeCurrencies.length > 1 && <Select className="w-28" value={chartCurrency} onChange={(e) => setNativeCurrency(e.target.value)}>{nativeCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}</Select>}
      </div>
    </div>

    <Card className="p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" className="px-3" onClick={() => setSelectedMonth((value) => shiftMonth(value, -1))} title={locale.startsWith('vi') ? 'Tháng trước' : 'Previous month'}><ChevronLeft size={18}/></Button>
        <div className="min-w-0 text-center"><div className="text-xs font-semibold uppercase tracking-[.14em] text-stone-400">{locale.startsWith('vi') ? 'Phân tích theo tháng' : 'Monthly analysis'}</div><div className="mt-0.5 text-lg font-semibold capitalize text-stone-950 dark:text-white">{monthLabel}</div>{selectedMonth !== currentMonth && <button type="button" className="mt-1 text-xs font-semibold text-blue-600 hover:underline" onClick={() => setSelectedMonth(currentMonth)}>{locale.startsWith('vi') ? 'Về tháng hiện tại' : 'Back to current month'}</button>}</div>
        <Button variant="ghost" className="px-3" disabled={nextDisabled} onClick={() => setSelectedMonth((value) => shiftMonth(value, 1))} title={locale.startsWith('vi') ? 'Tháng sau' : 'Next month'}><ChevronRight size={18}/></Button>
      </div>
    </Card>

    <div className="grid gap-3 sm:grid-cols-3">
      <Card className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-stone-500">{t('analytics.income')}</div><div className="mt-2">{currencyMode === 'native' ? <NativeValues field="income" tone="text-emerald-600"/> : <div className="text-2xl font-semibold text-emerald-600">{formatMoney(activeSummary.income, currency, locale)}</div>}</div></Card>
      <Card className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-stone-500">{t('analytics.expense')}</div><div className="mt-2">{currencyMode === 'native' ? <NativeValues field="expense" tone="text-rose-600"/> : <div className="text-2xl font-semibold text-rose-600">{formatMoney(activeSummary.expense, currency, locale)}</div>}</div></Card>
      <Card className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-stone-500">{t('analytics.net')}</div><div className="mt-2">{currencyMode === 'native' ? <NativeValues field="net"/> : <div className={`text-2xl font-semibold ${activeSummary.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatMoney(activeSummary.net, currency, locale)}</div>}</div></Card>
    </div>

    <Card className="p-4 sm:p-5"><h3 className="font-bold text-stone-900 dark:text-white">{t('analytics.cashflow')}</h3><p className="text-xs text-stone-500">{locale.startsWith('vi') ? `Theo ngày trong ${monthLabel}` : `Daily detail for ${monthLabel}`} · {chartCurrency}</p>{trend.length ? <div className="mt-4 h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={trend} margin={{ top:8,right:8,left:-10,bottom:0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2}/><XAxis dataKey="label" tick={{fontSize:11}} axisLine={false} tickLine={false}/><YAxis tickFormatter={(value)=>formatCompactMoney(Number(value),locale)} tick={{fontSize:11}} axisLine={false} tickLine={false}/><Tooltip formatter={(value)=>formatMoney(Number(value),chartCurrency,locale)}/><Legend/><Bar dataKey="income" name={t('transaction.income')} fill="#10b981" radius={[5,5,0,0]}/><Bar dataKey="expense" name={t('transaction.expense')} fill="#f43f5e" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></div> : <div className="mt-4"><EmptyState title={t('analytics.noDataTitle')} text={t('analytics.noDataText')}/></div>}</Card>

    <div className="grid gap-5 xl:grid-cols-2">
      <PieCard title={locale.startsWith('vi') ? 'Cơ cấu thu nhập' : 'Income mix'} data={incomeBreakdown} emptyTitle={locale.startsWith('vi') ? 'Chưa có thu nhập' : 'No income yet'} emptyText={locale.startsWith('vi') ? 'Tháng này chưa có giao dịch thu nhập trong currency đang xem.' : 'There are no income transactions for the selected currency this month.'}/>
      <PieCard title={t('analytics.expenseMix')} data={expenseBreakdown} emptyTitle={t('analytics.noExpenseTitle')} emptyText={t('analytics.noExpenseText')}/>
    </div>
  </div>
}
