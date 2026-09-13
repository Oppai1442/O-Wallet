import { useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, PiggyBank, WalletCards } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useWallet } from '../WalletContext'
import { categoryBreakdown, filteredTransactions, summarize, summarizeByCurrency, transactionsInCurrency, trendData, type RangeKey } from '../lib/analytics'
import { accountBalanceByCurrency } from '../lib/finance'
import { formatCompactMoney, formatDateTime, formatMoney } from '../lib/format'
import { getFxRate, transactionValueInBase } from '../lib/fx'
import { effectiveTransactions } from '../lib/scheduling'
import { useCurrentTime } from '../lib/useCurrentTime'
import { useI18n } from '../i18n'
import { categoryPath } from '../lib/categories'
import { Badge, Card, EmptyState, Select } from './ui'

const PIE_COLORS = ['#6366f1', '#14b8a6', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4', '#84cc16', '#64748b']
type BalanceValuation = { value: number; missing: number; loading: boolean }
type CurrencyViewMode = 'native' | 'converted'

export function Dashboard() {
  const { transactions, categories, accounts, settings } = useWallet()
  const { t, locale } = useI18n()
  const [range, setRange] = useState<RangeKey>('30d')
  const [currencyMode, setCurrencyMode] = useState<CurrencyViewMode>('native')
  const [nativeCurrency, setNativeCurrency] = useState('')
  const [valuation, setValuation] = useState<BalanceValuation>({ value: 0, missing: 0, loading: false })
  const now = useCurrentTime()
  const baseCurrency = (settings?.defaultCurrency ?? 'VND').trim().toUpperCase()
  const currentTransactions = useMemo(() => effectiveTransactions(transactions, now), [transactions, now])
  const futureCount = Math.max(0, transactions.length - currentTransactions.length)
  const filtered = useMemo(() => filteredTransactions(transactions, range, now), [transactions, range, now])
  const nativeSummary = useMemo(() => summarizeByCurrency(filtered), [filtered])
  const convertedSummary = useMemo(() => summarize(filtered, baseCurrency), [filtered, baseCurrency])

  const nativeBalances = useMemo(() => {
    const sums = new Map<string, number>()
    for (const account of accounts.filter((item) => !item.archived && !item.deleted)) {
      for (const [currency, balance] of accountBalanceByCurrency(account, transactions, now)) {
        sums.set(currency, (sums.get(currency) ?? 0) + balance)
      }
    }
    return [...sums.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [accounts, transactions, now])

  const nativeCurrencies = useMemo(() => [...new Set([...nativeSummary.map((item) => item.currency), ...nativeBalances.map(([currency]) => currency)])].sort(), [nativeBalances, nativeSummary])
  useEffect(() => {
    if (!nativeCurrencies.length) { setNativeCurrency(''); return }
    if (!nativeCurrencies.includes(nativeCurrency)) setNativeCurrency(nativeCurrencies.includes(baseCurrency) ? baseCurrency : nativeCurrencies[0])
  }, [baseCurrency, nativeCurrencies, nativeCurrency])

  const chartCurrency = currencyMode === 'converted' ? baseCurrency : nativeCurrency || baseCurrency
  const chartTransactions = useMemo(() => currencyMode === 'converted' ? filtered : transactionsInCurrency(filtered, chartCurrency), [chartCurrency, currencyMode, filtered])
  const trend = useMemo(() => trendData(chartTransactions, range, locale, chartCurrency), [chartTransactions, range, locale, chartCurrency])
  const pie = useMemo(() => categoryBreakdown(chartTransactions, categories, (category) => categoryPath(category, categories), t('categories.uncategorized'), chartCurrency), [chartTransactions, categories, t, chartCurrency])
  const selectedNative = nativeSummary.find((item) => item.currency === chartCurrency)
  const activeSummary = currencyMode === 'converted' ? convertedSummary : { income: selectedNative?.income ?? 0, expense: selectedNative?.expense ?? 0, net: selectedNative?.net ?? 0, unconverted: 0 }

  useEffect(() => {
    let cancelled = false
    if (currencyMode !== 'converted') {
      setValuation((current) => ({ ...current, loading: false }))
      return () => { cancelled = true }
    }
    const date = new Date(now).toISOString().slice(0, 10)
    setValuation((current) => ({ ...current, loading: true }))
    void (async () => {
      let value = 0
      let missing = 0
      const rateByCurrency = new Map<string, number>()
      for (const account of accounts.filter((item) => !item.archived && !item.deleted)) {
        for (const [currency, balance] of accountBalanceByCurrency(account, transactions, now)) {
          if (currency === baseCurrency) { value += balance; continue }
          let rate = rateByCurrency.get(currency)
          if (!rate) {
            try {
              rate = (await getFxRate(currency, baseCurrency, date)).rate
              rateByCurrency.set(currency, rate)
            } catch {
              missing += 1
              continue
            }
          }
          value += balance * rate
        }
      }
      if (!cancelled) setValuation({ value, missing, loading: false })
    })()
    return () => { cancelled = true }
  }, [accounts, transactions, now, baseCurrency, currencyMode])

  const budgetRows = useMemo(() => {
    const budgets = settings?.budgets ?? []
    const nowDate = new Date(now)
    const start = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime()
    const end = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 1).getTime()
    return budgets.map((budget) => {
      const spent = currentTransactions
        .filter((tx) => tx.type === 'expense' && tx.categoryId === budget.categoryId)
        .filter((tx) => { const time = new Date(tx.occurredAt).getTime(); return time >= start && time < end })
        .reduce((sum, tx) => sum + (transactionValueInBase(tx, baseCurrency) ?? 0), 0)
      const category = categories.find((item) => item.id === budget.categoryId)
      return { ...budget, spent, name: category ? categoryPath(category, categories) : t('categories.uncategorized'), percent: budget.monthlyLimit > 0 ? Math.min(150, spent / budget.monthlyLimit * 100) : 0 }
    }).sort((a, b) => b.percent - a.percent)
  }, [settings?.budgets, currentTransactions, categories, t, now, baseCurrency])

  const missingFxText = t('fx.missingTransactions', { count: convertedSummary.unconverted, currency: baseCurrency })
  const partialBalanceText = t('fx.partialBalance', { count: valuation.missing })

  function NativeSummaryValues({ field }: { field: 'income' | 'expense' | 'net' }) {
    if (!nativeSummary.length) return <span className="text-stone-400">—</span>
    return <div className="space-y-1">{nativeSummary.map((item) => <div key={item.currency} className="text-lg font-semibold text-stone-900 dark:text-stone-100">{formatMoney(item[field], item.currency, locale)}</div>)}</div>
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-white">{t('dashboard.title')}</h1><p className="mt-1 text-sm text-stone-500">{t('dashboard.subtitle')}</p>{futureCount > 0 && <p className="mt-1 text-xs font-semibold text-blue-500">{t('dashboard.futurePending', { count: futureCount })}</p>}{currencyMode === 'converted' && convertedSummary.unconverted > 0 && <p className="mt-1 text-xs font-semibold text-amber-600 dark:text-amber-400">{missingFxText}</p>}</div>
      <div className="flex flex-wrap gap-2"><Select className="w-40" value={currencyMode} onChange={(e) => setCurrencyMode(e.target.value as CurrencyViewMode)}><option value="native">{t('view.native')}</option><option value="converted">{t('view.convertTo', { currency: baseCurrency })}</option></Select>{currencyMode === 'native' && nativeCurrencies.length > 1 && <Select className="w-28" value={chartCurrency} onChange={(e) => setNativeCurrency(e.target.value)}>{nativeCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}</Select>}<Select className="w-36" value={range} onChange={(e) => setRange(e.target.value as RangeKey)}><option value="7d">{t('range.7d')}</option><option value="30d">{t('range.30d')}</option><option value="3m">{t('range.3m')}</option><option value="6m">{t('range.6m')}</option><option value="1y">{t('range.1y')}</option><option value="all">{t('range.all')}</option></Select></div>
    </div>

    <Card className="overflow-hidden"><div className="grid lg:grid-cols-[1.25fr_2fr]">
      <div className="border-b border-stone-100 p-5 sm:p-6 lg:border-b-0 lg:border-r dark:border-stone-800"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-stone-400"><WalletCards size={14}/>{t('dashboard.balance')}</div>{currencyMode === 'converted' ? <><div className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950 dark:text-white">{valuation.loading ? '…' : formatMoney(valuation.value, baseCurrency, locale)}</div>{valuation.missing > 0 && <div className="mt-2 text-xs font-semibold text-amber-600 dark:text-amber-400">{partialBalanceText}</div>}</> : <div className="mt-3 space-y-1">{nativeBalances.length ? nativeBalances.map(([currency, value]) => <div key={currency} className="text-2xl font-semibold tracking-[-0.03em] text-stone-950 dark:text-white">{formatMoney(value, currency, locale)}</div>) : <div className="text-2xl text-stone-400">—</div>}</div>}</div>
      <div className="grid grid-cols-1 divide-y divide-stone-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-stone-800"><div className="p-5"><div className="flex items-center gap-2 text-sm text-stone-500"><ArrowUpRight className="text-emerald-500" size={17}/>{t('dashboard.income')}</div><div className="mt-3">{currencyMode === 'native' ? <NativeSummaryValues field="income"/> : <div className="text-xl font-semibold text-emerald-600">{formatMoney(activeSummary.income, baseCurrency, locale)}</div>}</div></div><div className="p-5"><div className="flex items-center gap-2 text-sm text-stone-500"><ArrowDownRight className="text-rose-500" size={17}/>{t('dashboard.expense')}</div><div className="mt-3">{currencyMode === 'native' ? <NativeSummaryValues field="expense"/> : <div className="text-xl font-semibold text-rose-600">{formatMoney(activeSummary.expense, baseCurrency, locale)}</div>}</div></div><div className="p-5"><div className="flex items-center gap-2 text-sm text-stone-500"><PiggyBank size={17}/>{t('dashboard.net')}</div><div className="mt-3">{currencyMode === 'native' ? <NativeSummaryValues field="net"/> : <div className="text-xl font-semibold">{formatMoney(activeSummary.net, baseCurrency, locale)}</div>}</div></div></div>
    </div></Card>

    {budgetRows.length > 0 && <Card className="p-4 sm:p-5"><div className="font-bold text-stone-900 dark:text-white">{t('dashboard.budgets')} · {baseCurrency}</div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{budgetRows.map((budget) => <div key={budget.id} className="rounded-2xl border border-stone-200 p-3 dark:border-stone-800"><div className="flex justify-between gap-3 text-sm"><span className="truncate font-bold">{budget.name}</span><span className={budget.percent >= 100 ? 'font-bold text-rose-600' : 'font-semibold text-stone-500'}>{Math.round(budget.percent)}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800"><div className={`h-full rounded-full ${budget.percent >= 100 ? 'bg-rose-500' : budget.percent >= 80 ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, budget.percent)}%` }}/></div><div className="mt-2 text-xs text-stone-500">{formatMoney(budget.spent, baseCurrency, locale)} / {formatMoney(budget.monthlyLimit, baseCurrency, locale)}</div></div>)}</div></Card>}

    <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
      <Card className="p-4 sm:p-5"><div className="mb-4 font-bold text-stone-900 dark:text-white">{t('dashboard.cashflow')} · {chartCurrency}</div>{trend.length ? <div className="h-72"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.22}/><XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false}/><YAxis tickFormatter={(value) => formatCompactMoney(Number(value), locale)} tick={{ fontSize: 11 }} axisLine={false} tickLine={false}/><Tooltip formatter={(value) => formatMoney(Number(value), chartCurrency, locale)}/><Area type="monotone" dataKey="income" name={t('transaction.income')} stroke="#10b981" fill="#10b98122" strokeWidth={2}/><Area type="monotone" dataKey="expense" name={t('transaction.expense')} stroke="#f43f5e" fill="#f43f5e22" strokeWidth={2}/></AreaChart></ResponsiveContainer></div> : <EmptyState title={t('dashboard.noDataTitle')} text={t('dashboard.noDataText')}/>}</Card>
      <Card className="p-4 sm:p-5"><div className="font-bold text-stone-900 dark:text-white">{t('dashboard.expenseByCategory')} · {chartCurrency}</div>{pie.length ? <><div className="h-52"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={78} paddingAngle={pie.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>{pie.map((item, index) => <Cell key={item.id} fill={PIE_COLORS[index % PIE_COLORS.length]}/>)}</Pie><Tooltip formatter={(value) => formatMoney(Number(value), chartCurrency, locale)}/></PieChart></ResponsiveContainer></div><div className="space-y-2">{pie.slice(0, 5).map((item, index) => <div className="flex items-center justify-between gap-3 text-sm" key={item.id}><div className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}/><span className="truncate text-stone-600 dark:text-stone-300">{item.name}</span></div><span className="font-semibold">{formatMoney(item.value, chartCurrency, locale)}</span></div>)}</div></> : <div className="mt-4"><EmptyState title={t('dashboard.noExpenseTitle')} text={t('dashboard.noExpenseText')}/></div>}</Card>
    </div>

    <Card className="overflow-hidden"><div className="border-b border-stone-100 px-4 py-4 font-bold dark:border-stone-800">{t('dashboard.recent')}</div>{currentTransactions.length === 0 ? <div className="p-4"><EmptyState title={t('dashboard.noTransactionsTitle')} text={t('dashboard.noTransactionsText')}/></div> : <div className="divide-y divide-stone-100 dark:divide-stone-800">{currentTransactions.slice(0, 6).map((tx) => <div key={tx.id} className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><div className="truncate font-semibold">{tx.merchant || tx.description || t('transaction.noDescription')}</div><div className="mt-1 flex items-center gap-2 text-xs text-stone-500"><span>{formatDateTime(tx.occurredAt, locale)}</span>{tx.imageIds.length > 0 && <Badge tone="indigo">{t('dashboard.images', { count: tx.imageIds.length })}</Badge>}{tx.type === 'transfer' && tx.destinationCurrency && <span>→ {formatMoney(tx.destinationAmount ?? tx.amount, tx.destinationCurrency, locale)}</span>}</div></div><div className="shrink-0 font-bold">{formatMoney(tx.amount, tx.currency, locale)}</div></div>)}</div>}</Card>
  </div>
}
