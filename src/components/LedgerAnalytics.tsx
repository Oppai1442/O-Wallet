import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Category, Transaction } from '../types'
import { categoryBreakdown, filteredTransactions, summarize, summarizeByCurrency, transactionsInCurrency, trendData, type RangeKey } from '../lib/analytics'
import { formatCompactMoney, formatMoney } from '../lib/format'
import { useCurrentTime } from '../lib/useCurrentTime'
import { useI18n } from '../i18n'
import { categoryPath } from '../lib/categories'
import { Card, EmptyState, Select } from './ui'

const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#84cc16', '#f59e0b', '#f97316', '#f43f5e', '#a855f7']
type CurrencyViewMode = 'native' | 'converted'

export function LedgerAnalytics({ transactions, categories, currency = 'VND', title, subtitle }: { transactions: Transaction[]; categories: Category[]; currency?: string; title?: string; subtitle?: string }) {
  const { t, locale } = useI18n()
  const [range, setRange] = useState<RangeKey>('6m')
  const [currencyMode, setCurrencyMode] = useState<CurrencyViewMode>('native')
  const [nativeCurrency, setNativeCurrency] = useState('')
  const now = useCurrentTime()
  const filtered = useMemo(() => filteredTransactions(transactions, range, now), [transactions, range, now])
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
  const trend = useMemo(() => trendData(chartTransactions, range, locale, chartCurrency), [chartTransactions, range, locale, chartCurrency])
  const breakdown = useMemo(() => categoryBreakdown(chartTransactions, categories, (category) => categoryPath(category, categories), t('common.other'), chartCurrency), [chartTransactions, categories, t, chartCurrency])
  const selectedNative = nativeSummary.find((item) => item.currency === chartCurrency)
  const activeSummary = currencyMode === 'converted'
    ? convertedSummary
    : { income: selectedNative?.income ?? 0, expense: selectedNative?.expense ?? 0, net: selectedNative?.net ?? 0, unconverted: 0 }

  const missingFxText = locale.startsWith('vi')
    ? `${convertedSummary.unconverted} giao dịch chưa có snapshot tỷ giá sang ${currency} nên chưa được tính khi quy đổi.`
    : `${convertedSummary.unconverted} transaction(s) have no saved FX snapshot to ${currency} and are excluded in converted view.`
  const nativeHint = locale.startsWith('vi')
    ? 'Native: giữ nguyên đơn vị gốc; không cộng các loại tiền khác nhau vào cùng một tổng.'
    : 'Native: keeps original units and never adds different currencies into one total.'
  const convertedHint = locale.startsWith('vi')
    ? `Converted: quy đổi để xem sang ${currency} bằng snapshot tỷ giá đã lưu trên từng giao dịch; dữ liệu gốc không đổi.`
    : `Converted: displays everything in ${currency} using each transaction’s saved FX snapshot; original data is unchanged.`

  function NativeValues({ field, tone }: { field: 'income' | 'expense' | 'net'; tone?: string }) {
    if (!nativeSummary.length) return <span className="text-stone-400">—</span>
    return <div className="space-y-1">{nativeSummary.map((item) => <div key={item.currency} className={`text-lg font-semibold ${tone ?? (field === 'net' ? (item.net >= 0 ? 'text-emerald-600' : 'text-rose-600') : '')}`}>{formatMoney(item[field], item.currency, locale)}</div>)}</div>
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-white">{title ?? t('analytics.title')}</h2><p className="mt-1 text-sm text-stone-500">{subtitle ?? t('analytics.subtitle')}</p><p className="mt-1 text-xs text-stone-400">{currencyMode === 'native' ? nativeHint : convertedHint}</p>{currencyMode === 'converted' && convertedSummary.unconverted > 0 && <p className="mt-1 text-xs font-semibold text-amber-600 dark:text-amber-400">{missingFxText}</p>}</div>
      <div className="flex flex-wrap gap-2">
        <Select className="w-40" value={currencyMode} onChange={(e) => setCurrencyMode(e.target.value as CurrencyViewMode)}><option value="native">{locale.startsWith('vi') ? 'Tiền gốc' : 'Native currencies'}</option><option value="converted">{locale.startsWith('vi') ? `Quy đổi → ${currency}` : `Convert → ${currency}`}</option></Select>
        {currencyMode === 'native' && nativeCurrencies.length > 1 && <Select className="w-28" value={chartCurrency} onChange={(e) => setNativeCurrency(e.target.value)}>{nativeCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}</Select>}
        <Select className="w-40" value={range} onChange={(e) => setRange(e.target.value as RangeKey)}><option value="7d">{t('range.7d')}</option><option value="30d">{t('range.30d')}</option><option value="3m">{t('range.3m')}</option><option value="6m">{t('range.6m')}</option><option value="1y">{t('range.1y')}</option><option value="all">{t('range.all')}</option></Select>
      </div>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <Card className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-stone-500">{t('analytics.income')}</div><div className="mt-2">{currencyMode === 'native' ? <NativeValues field="income" tone="text-emerald-600"/> : <div className="text-2xl font-semibold text-emerald-600">{formatMoney(activeSummary.income, currency, locale)}</div>}</div></Card>
      <Card className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-stone-500">{t('analytics.expense')}</div><div className="mt-2">{currencyMode === 'native' ? <NativeValues field="expense" tone="text-rose-600"/> : <div className="text-2xl font-semibold text-rose-600">{formatMoney(activeSummary.expense, currency, locale)}</div>}</div></Card>
      <Card className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-stone-500">{t('analytics.net')}</div><div className="mt-2">{currencyMode === 'native' ? <NativeValues field="net"/> : <div className={`text-2xl font-semibold ${activeSummary.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatMoney(activeSummary.net, currency, locale)}</div>}</div></Card>
    </div>
    <Card className="p-4 sm:p-5"><h3 className="font-bold text-stone-900 dark:text-white">{t('analytics.cashflow')}</h3><p className="text-xs text-stone-500">{t('analytics.cashflowHint')} · {chartCurrency}</p>{trend.length ? <div className="mt-4 h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={trend} margin={{ top:8,right:8,left:-10,bottom:0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2}/><XAxis dataKey="label" tick={{fontSize:11}} axisLine={false} tickLine={false}/><YAxis tickFormatter={(value)=>formatCompactMoney(Number(value),locale)} tick={{fontSize:11}} axisLine={false} tickLine={false}/><Tooltip formatter={(value)=>formatMoney(Number(value),chartCurrency,locale)}/><Legend/><Bar dataKey="income" name={t('transaction.income')} fill="#10b981" radius={[5,5,0,0]}/><Bar dataKey="expense" name={t('transaction.expense')} fill="#f43f5e" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></div> : <div className="mt-4"><EmptyState title={t('analytics.noDataTitle')} text={t('analytics.noDataText')}/></div>}</Card>
    <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr]">
      <Card className="p-4 sm:p-5"><h3 className="font-bold text-stone-900 dark:text-white">{t('analytics.expenseMix')}</h3>{breakdown.length ? <div className="mt-2 h-80"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={breakdown} dataKey="value" nameKey="name" outerRadius={110} innerRadius={60} paddingAngle={2} label={({name,percent})=>`${name} ${Math.round((percent??0)*100)}%`}>{breakdown.map((entry,index)=><Cell key={entry.id} fill={COLORS[index%COLORS.length]}/>)}</Pie><Tooltip formatter={(value)=>formatMoney(Number(value),chartCurrency,locale)}/></PieChart></ResponsiveContainer></div> : <div className="mt-4"><EmptyState title={t('analytics.noExpenseTitle')} text={t('analytics.noExpenseText')}/></div>}</Card>
      <Card className="p-4 sm:p-5"><h3 className="font-bold text-stone-900 dark:text-white">{t('analytics.topCategories')}</h3><div className="mt-4 space-y-3">{breakdown.length===0&&<EmptyState title={t('analytics.emptyTitle')} text={t('analytics.emptyText')}/>} {breakdown.map((item,index)=>{const max=breakdown[0]?.value||1;return <div key={item.id}><div className="flex justify-between gap-3 text-sm"><span className="font-semibold text-stone-700 dark:text-stone-200">{item.name}</span><span className="text-stone-500">{formatMoney(item.value,chartCurrency,locale)}</span></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800"><div className="h-full rounded-full" style={{width:`${Math.max(2,item.value/max*100)}%`,backgroundColor:COLORS[index%COLORS.length]}}/></div></div>})}</div></Card>
    </div>
  </div>
}
