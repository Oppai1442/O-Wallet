import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, PiggyBank, WalletCards } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from 'recharts'
import { useWallet } from '../WalletContext'
import { categoryBreakdown, filteredTransactions, summarize, trendData, type RangeKey } from '../lib/analytics'
import { totalBalance } from '../lib/finance'
import { formatCompactMoney, formatDateTime, formatMoney } from '../lib/format'
import { categoryDisplayName, useI18n } from '../i18n'
import { Badge, Card, EmptyState, Select } from './ui'

const PIE_COLORS = ['#6366f1', '#14b8a6', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4', '#84cc16', '#64748b']

export function Dashboard() {
  const { transactions, categories, accounts, settings } = useWallet()
  const { t, locale } = useI18n()
  const [range, setRange] = useState<RangeKey>('30d')
  const filtered = useMemo(() => filteredTransactions(transactions, range), [transactions, range])
  const summary = useMemo(() => summarize(filtered), [filtered])
  const trend = useMemo(() => trendData(filtered, range, locale), [filtered, range, locale])
  const pie = useMemo(() => categoryBreakdown(filtered, categories, (category) => categoryDisplayName(category, t), t('common.other')), [filtered, categories, t])
  const balance = useMemo(() => totalBalance(accounts, transactions), [accounts, transactions])
  const budgetRows = useMemo(() => {
    const budgets = settings?.budgets ?? []
    if (!budgets.length) return []
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
    return budgets.map((budget) => {
      const spent = transactions
        .filter((tx) => tx.type === 'expense' && tx.categoryId === budget.categoryId)
        .filter((tx) => { const time = new Date(tx.occurredAt).getTime(); return time >= start && time < end })
        .reduce((sum, tx) => sum + tx.amount, 0)
      const category = categories.find((item) => item.id === budget.categoryId)
      return {
        ...budget,
        spent,
        name: category ? categoryDisplayName(category, t) : t('common.other'),
        percent: budget.monthlyLimit > 0 ? Math.min(150, spent / budget.monthlyLimit * 100) : 0,
      }
    }).sort((a, b) => b.percent - a.percent)
  }, [settings?.budgets, transactions, categories, t])

  const cards = [
    { label: t('dashboard.balance'), value: balance, icon: WalletCards, tone: 'text-indigo-500' },
    { label: t('dashboard.income'), value: summary.income, icon: ArrowUpRight, tone: 'text-emerald-500' },
    { label: t('dashboard.expense'), value: summary.expense, icon: ArrowDownRight, tone: 'text-rose-500' },
    { label: t('dashboard.net'), value: summary.net, icon: PiggyBank, tone: summary.net >= 0 ? 'text-emerald-500' : 'text-rose-500' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950 dark:text-white">{t('dashboard.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('dashboard.subtitle')}</p>
        </div>
        <Select className="w-36" value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
          <option value="7d">{t('range.7d')}</option>
          <option value="30d">{t('range.30d')}</option>
          <option value="3m">{t('range.3m')}</option>
          <option value="6m">{t('range.6m')}</option>
          <option value="1y">{t('range.1y')}</option>
          <option value="all">{t('range.all')}</option>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((item) => (
          <Card className="p-4" key={item.label}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">{item.label}</div>
              <item.icon className={item.tone} size={19} />
            </div>
            <div className="mt-3 text-xl font-black tracking-tight text-slate-950 dark:text-white">{formatMoney(item.value, 'VND', locale)}</div>
          </Card>
        ))}
      </div>

      {budgetRows.length > 0 && (
        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div><div className="font-bold text-slate-900 dark:text-white">{t('dashboard.budgets')}</div><div className="text-xs text-slate-500">{t('dashboard.budgetsHint')}</div></div>
            <Badge>{t('settings.month')}</Badge>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {budgetRows.map((budget) => (
              <div key={budget.id} className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center justify-between gap-3 text-sm"><span className="truncate font-bold text-slate-800 dark:text-slate-100">{budget.name}</span><span className={budget.percent >= 100 ? 'font-bold text-rose-600' : 'font-semibold text-slate-500'}>{Math.round(budget.percent)}%</span></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${budget.percent >= 100 ? 'bg-rose-500' : budget.percent >= 80 ? 'bg-amber-500' : 'bg-indigo-500'}`} style={{ width: `${Math.min(100, budget.percent)}%` }} /></div>
                <div className="mt-2 text-xs text-slate-500">{formatMoney(budget.spent, settings?.defaultCurrency ?? 'VND', locale)} / {formatMoney(budget.monthlyLimit, settings?.defaultCurrency ?? 'VND', locale)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <Card className="p-4 sm:p-5">
          <div className="mb-4">
            <div className="font-bold text-slate-900 dark:text-white">{t('dashboard.cashflow')}</div>
            <div className="text-xs text-slate-500">{t('dashboard.selectedRange', { range: t(`range.${range}`) })}</div>
          </div>
          {trend.length ? (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                  <defs>
                    <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.28}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient>
                    <linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f43f5e" stopOpacity={0.28}/><stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.22} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(value) => formatCompactMoney(Number(value), locale)} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value) => formatMoney(Number(value), 'VND', locale)} />
                  <Area type="monotone" dataKey="income" name={t('transaction.income')} stroke="#10b981" fill="url(#incomeFill)" strokeWidth={2} />
                  <Area type="monotone" dataKey="expense" name={t('transaction.expense')} stroke="#f43f5e" fill="url(#expenseFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyState title={t('dashboard.noDataTitle')} text={t('dashboard.noDataText')} />}
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="font-bold text-slate-900 dark:text-white">{t('dashboard.expenseByCategory')}</div>
          <div className="text-xs text-slate-500">{t('dashboard.total', { value: formatMoney(summary.expense, 'VND', locale) })}</div>
          {pie.length ? (
            <>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={78} paddingAngle={2}>
                      {pie.map((item, index) => <Cell key={item.id} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(value) => formatMoney(Number(value), 'VND', locale)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2">
                {pie.slice(0, 5).map((item, index) => (
                  <div className="flex items-center justify-between gap-3 text-sm" key={item.id}>
                    <div className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} /><span className="truncate text-slate-600 dark:text-slate-300">{item.name}</span></div>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{formatCompactMoney(item.value, locale)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <div className="mt-4"><EmptyState title={t('dashboard.noExpenseTitle')} text={t('dashboard.noExpenseText')} /></div>}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-4 font-bold text-slate-900 dark:border-slate-800 dark:text-white">{t('dashboard.recent')}</div>
        {transactions.length === 0 ? <div className="p-4"><EmptyState title={t('dashboard.noTransactionsTitle')} text={t('dashboard.noTransactionsText')} /></div> : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {transactions.slice(0, 6).map((tx) => (
              <div key={tx.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-slate-800 dark:text-slate-100">{tx.merchant || tx.description || t('transaction.noDescription')}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500"><span>{formatDateTime(tx.occurredAt, locale)}</span>{tx.imageIds.length > 0 && <Badge tone="indigo">{t('dashboard.images', { count: tx.imageIds.length })}</Badge>}</div>
                </div>
                <div className={`shrink-0 font-bold ${tx.type === 'income' ? 'text-emerald-600' : tx.type === 'expense' ? 'text-rose-600' : 'text-slate-700 dark:text-slate-300'}`}>{tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}{formatMoney(tx.amount, tx.currency, locale)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
