import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useWallet } from '../WalletContext'
import { categoryBreakdown, filteredTransactions, summarize, trendData, type RangeKey } from '../lib/analytics'
import { formatCompactMoney, formatMoney } from '../lib/format'
import { useCurrentTime } from '../lib/useCurrentTime'
import { useI18n } from '../i18n'
import { categoryPath } from '../lib/categories'
import { Card, EmptyState, Select } from './ui'

const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#84cc16', '#f59e0b', '#f97316', '#f43f5e', '#a855f7']

export function Analytics() {
  const { transactions, categories } = useWallet()
  const { t, locale } = useI18n()
  const [range, setRange] = useState<RangeKey>('6m')
  const now = useCurrentTime()
  const filtered = useMemo(() => filteredTransactions(transactions, range, now), [transactions, range, now])
  const trend = useMemo(() => trendData(filtered, range, locale), [filtered, range, locale])
  const breakdown = useMemo(() => categoryBreakdown(filtered, categories, (category) => categoryPath(category, categories), t('common.other')), [filtered, categories, t])
  const summary = useMemo(() => summarize(filtered), [filtered])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-white">{t('analytics.title')}</h1><p className="mt-1 text-sm text-stone-500">{t('analytics.subtitle')}</p></div>
        <Select className="w-40" value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
          <option value="7d">{t('range.7d')}</option><option value="30d">{t('range.30d')}</option><option value="3m">{t('range.3m')}</option><option value="6m">{t('range.6m')}</option><option value="1y">{t('range.1y')}</option><option value="all">{t('range.all')}</option>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-stone-500">{t('analytics.income')}</div><div className="mt-2 text-2xl font-semibold text-emerald-600">{formatMoney(summary.income, 'VND', locale)}</div></Card>
        <Card className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-stone-500">{t('analytics.expense')}</div><div className="mt-2 text-2xl font-semibold text-rose-600">{formatMoney(summary.expense, 'VND', locale)}</div></Card>
        <Card className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-stone-500">{t('analytics.net')}</div><div className={`mt-2 text-2xl font-semibold ${summary.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatMoney(summary.net, 'VND', locale)}</div></Card>
      </div>

      <Card className="p-4 sm:p-5">
        <h2 className="font-bold text-stone-900 dark:text-white">{t('analytics.cashflow')}</h2>
        <p className="text-xs text-stone-500">{t('analytics.cashflowHint')}</p>
        {trend.length ? (
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(value) => formatCompactMoney(Number(value), locale)} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => formatMoney(Number(value), 'VND', locale)} />
                <Legend />
                <Bar dataKey="income" name={t('transaction.income')} fill="#10b981" radius={[5, 5, 0, 0]} />
                <Bar dataKey="expense" name={t('transaction.expense')} fill="#f43f5e" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <div className="mt-4"><EmptyState title={t('analytics.noDataTitle')} text={t('analytics.noDataText')} /></div>}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr]">
        <Card className="p-4 sm:p-5">
          <h2 className="font-bold text-stone-900 dark:text-white">{t('analytics.expenseMix')}</h2>
          {breakdown.length ? (
            <div className="mt-2 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={breakdown} dataKey="value" nameKey="name" outerRadius={110} innerRadius={60} paddingAngle={2} label={({ name, percent }) => `${name} ${Math.round((percent ?? 0) * 100)}%`}>
                    {breakdown.map((entry, index) => <Cell key={entry.id} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value) => formatMoney(Number(value), 'VND', locale)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="mt-4"><EmptyState title={t('analytics.noExpenseTitle')} text={t('analytics.noExpenseText')} /></div>}
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="font-bold text-stone-900 dark:text-white">{t('analytics.topCategories')}</h2>
          <div className="mt-4 space-y-3">
            {breakdown.length === 0 && <EmptyState title={t('analytics.emptyTitle')} text={t('analytics.emptyText')} />}
            {breakdown.map((item, index) => {
              const max = breakdown[0]?.value || 1
              return (
                <div key={item.id}>
                  <div className="flex justify-between gap-3 text-sm"><span className="font-semibold text-stone-700 dark:text-stone-200">{item.name}</span><span className="text-stone-500">{formatMoney(item.value, 'VND', locale)}</span></div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800"><div className="h-full rounded-full" style={{ width: `${Math.max(2, item.value / max * 100)}%`, backgroundColor: COLORS[index % COLORS.length] }} /></div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}
