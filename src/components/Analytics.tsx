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
import { Card, EmptyState, Select } from './ui'

const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#84cc16', '#f59e0b', '#f97316', '#f43f5e', '#a855f7']

export function Analytics() {
  const { transactions, categories } = useWallet()
  const [range, setRange] = useState<RangeKey>('6m')
  const filtered = useMemo(() => filteredTransactions(transactions, range), [transactions, range])
  const trend = useMemo(() => trendData(filtered, range), [filtered, range])
  const breakdown = useMemo(() => categoryBreakdown(filtered, categories), [filtered, categories])
  const summary = useMemo(() => summarize(filtered), [filtered])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-black tracking-tight text-slate-950 dark:text-white">Analytics</h1><p className="mt-1 text-sm text-slate-500">Chart render client-side từ dữ liệu đã decrypt.</p></div>
        <Select className="w-40" value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
          <option value="7d">7 ngày</option><option value="30d">30 ngày</option><option value="3m">3 tháng</option><option value="6m">6 tháng</option><option value="1y">1 năm</option><option value="all">Tất cả</option>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Income</div><div className="mt-2 text-2xl font-black text-emerald-600">{formatMoney(summary.income)}</div></Card>
        <Card className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Expense</div><div className="mt-2 text-2xl font-black text-rose-600">{formatMoney(summary.expense)}</div></Card>
        <Card className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Net</div><div className={`mt-2 text-2xl font-black ${summary.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatMoney(summary.net)}</div></Card>
      </div>

      <Card className="p-4 sm:p-5">
        <h2 className="font-bold text-slate-900 dark:text-white">Cash flow</h2>
        <p className="text-xs text-slate-500">Income và expense theo bucket thời gian.</p>
        {trend.length ? (
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={formatCompactMoney} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => formatMoney(Number(value))} />
                <Legend />
                <Bar dataKey="income" fill="#10b981" radius={[5, 5, 0, 0]} />
                <Bar dataKey="expense" fill="#f43f5e" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <div className="mt-4"><EmptyState title="Chưa có data" text="Chart sẽ xuất hiện sau khi có transaction trong range này." /></div>}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr]">
        <Card className="p-4 sm:p-5">
          <h2 className="font-bold text-slate-900 dark:text-white">Expense mix</h2>
          {breakdown.length ? (
            <div className="mt-2 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={breakdown} dataKey="value" nameKey="name" outerRadius={110} innerRadius={60} paddingAngle={2} label={({ name, percent }) => `${name} ${Math.round((percent ?? 0) * 100)}%`}>
                    {breakdown.map((entry, index) => <Cell key={entry.id} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value) => formatMoney(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="mt-4"><EmptyState title="Không có expense" text="Không có category nào để vẽ pie chart." /></div>}
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="font-bold text-slate-900 dark:text-white">Top categories</h2>
          <div className="mt-4 space-y-3">
            {breakdown.length === 0 && <EmptyState title="Trống" text="Chưa có khoản chi." />}
            {breakdown.map((item, index) => {
              const max = breakdown[0]?.value || 1
              return (
                <div key={item.id}>
                  <div className="flex justify-between gap-3 text-sm"><span className="font-semibold text-slate-700 dark:text-slate-200">{item.name}</span><span className="text-slate-500">{formatMoney(item.value)}</span></div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full" style={{ width: `${Math.max(2, item.value / max * 100)}%`, backgroundColor: COLORS[index % COLORS.length] }} /></div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}
