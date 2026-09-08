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
import { Badge, Card, EmptyState, Select } from './ui'

const PIE_COLORS = ['#6366f1', '#14b8a6', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4', '#84cc16', '#64748b']

export function Dashboard() {
  const { transactions, categories, accounts } = useWallet()
  const [range, setRange] = useState<RangeKey>('30d')
  const filtered = useMemo(() => filteredTransactions(transactions, range), [transactions, range])
  const summary = useMemo(() => summarize(filtered), [filtered])
  const trend = useMemo(() => trendData(filtered, range), [filtered, range])
  const pie = useMemo(() => categoryBreakdown(filtered, categories), [filtered, categories])
  const balance = useMemo(() => totalBalance(accounts, transactions), [accounts, transactions])

  const cards = [
    { label: 'Tổng số dư', value: balance, icon: WalletCards, tone: 'text-indigo-500' },
    { label: 'Thu', value: summary.income, icon: ArrowUpRight, tone: 'text-emerald-500' },
    { label: 'Chi', value: summary.expense, icon: ArrowDownRight, tone: 'text-rose-500' },
    { label: 'Net', value: summary.net, icon: PiggyBank, tone: summary.net >= 0 ? 'text-emerald-500' : 'text-rose-500' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950 dark:text-white">Tổng quan</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Dữ liệu được tính trực tiếp trên thiết bị.</p>
        </div>
        <Select className="w-36" value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
          <option value="7d">7 ngày</option>
          <option value="30d">30 ngày</option>
          <option value="3m">3 tháng</option>
          <option value="6m">6 tháng</option>
          <option value="1y">1 năm</option>
          <option value="all">Tất cả</option>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((item) => (
          <Card className="p-4" key={item.label}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">{item.label}</div>
              <item.icon className={item.tone} size={19} />
            </div>
            <div className="mt-3 text-xl font-black tracking-tight text-slate-950 dark:text-white">{formatMoney(item.value)}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <Card className="p-4 sm:p-5">
          <div className="mb-4">
            <div className="font-bold text-slate-900 dark:text-white">Thu / chi theo thời gian</div>
            <div className="text-xs text-slate-500">Khoảng đang chọn: {range.toUpperCase()}</div>
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
                  <YAxis tickFormatter={formatCompactMoney} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value) => formatMoney(Number(value))} />
                  <Area type="monotone" dataKey="income" stroke="#10b981" fill="url(#incomeFill)" strokeWidth={2} />
                  <Area type="monotone" dataKey="expense" stroke="#f43f5e" fill="url(#expenseFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyState title="Chưa có dữ liệu" text="Thêm transaction để chart bắt đầu có chuyện để kể." />}
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="font-bold text-slate-900 dark:text-white">Chi theo category</div>
          <div className="text-xs text-slate-500">Tổng {formatMoney(summary.expense)}</div>
          {pie.length ? (
            <>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={78} paddingAngle={2}>
                      {pie.map((item, index) => <Cell key={item.id} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(value) => formatMoney(Number(value))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2">
                {pie.slice(0, 5).map((item, index) => (
                  <div className="flex items-center justify-between gap-3 text-sm" key={item.id}>
                    <div className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} /><span className="truncate text-slate-600 dark:text-slate-300">{item.name}</span></div>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{formatCompactMoney(item.value)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <div className="mt-4"><EmptyState title="Chưa có khoản chi" text="Pie chart hiện đang ăn không khí." /></div>}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-4 font-bold text-slate-900 dark:border-slate-800 dark:text-white">Giao dịch gần đây</div>
        {transactions.length === 0 ? <div className="p-4"><EmptyState title="Chưa có transaction" text="Thêm giao dịch thủ công hoặc OCR screenshot." /></div> : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {transactions.slice(0, 6).map((tx) => (
              <div key={tx.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-slate-800 dark:text-slate-100">{tx.merchant || tx.description || 'Không mô tả'}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500"><span>{formatDateTime(tx.occurredAt)}</span>{tx.imageIds.length > 0 && <Badge tone="indigo">{tx.imageIds.length} ảnh</Badge>}</div>
                </div>
                <div className={`shrink-0 font-bold ${tx.type === 'income' ? 'text-emerald-600' : tx.type === 'expense' ? 'text-rose-600' : 'text-slate-700 dark:text-slate-300'}`}>{tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}{formatMoney(tx.amount, tx.currency)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
