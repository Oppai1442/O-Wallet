import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Image as ImageIcon, Mic, Pencil, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { useWallet } from '../WalletContext'
import { accountDisplayName, useI18n } from '../i18n'
import { categoryPath, selectableCategories } from '../lib/categories'
import { formatDateTime, formatMoney } from '../lib/format'
import { isFutureTransaction } from '../lib/scheduling'
import { useCurrentTime } from '../lib/useCurrentTime'
import type { Transaction, TransactionType } from '../types'
import { Badge, Button, Card, EmptyState, Input, Label, Select } from './ui'
import { ImageViewer } from './ImageViewer'

const TransactionModal = lazy(() => import('./TransactionModal').then((module) => ({ default: module.TransactionModal })))

const PAGE_SIZE = 100
type SortKey = 'newest' | 'oldest' | 'amountHigh' | 'amountLow'

export function Transactions() {
  const { transactions, categories, accounts, deleteTransaction } = useWallet()
  const { t, locale } = useI18n()
  const now = useCurrentTime()
  const [search, setSearch] = useState('')
  const [type, setType] = useState<'all' | TransactionType>('all')
  const [accountId, setAccountId] = useState('all')
  const [categoryId, setCategoryId] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [imageFilter, setImageFilter] = useState<'all' | 'with' | 'without'>('all')
  const [sort, setSort] = useState<SortKey>('newest')
  const [page, setPage] = useState(1)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showVoiceAdd, setShowVoiceAdd] = useState(false)
  const [editTx, setEditTx] = useState<Transaction>()
  const [duplicateTx, setDuplicateTx] = useState<Transaction>()
  const [viewImage, setViewImage] = useState<string>()
  const [deleting, setDeleting] = useState<string>()

  const categoryMap = useMemo(() => new Map(categories.map((item) => [item.id, categoryPath(item, categories)])), [categories, t])
  const accountMap = useMemo(() => new Map(accounts.map((item) => [item.id, accountDisplayName(item, t)])), [accounts, t])
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase(locale)
    const min = minAmount ? Number(minAmount) : undefined
    const max = maxAmount ? Number(maxAmount) : undefined
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : undefined
    const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : undefined
    const result = transactions.filter((tx) => {
      if (type !== 'all' && tx.type !== type) return false
      if (accountId !== 'all' && tx.accountId !== accountId && tx.destinationAccountId !== accountId) return false
      if (categoryId === '__uncategorized__' && tx.categoryId) return false
      if (categoryId !== 'all' && categoryId !== '__uncategorized__' && tx.categoryId !== categoryId) return false
      if (min !== undefined && tx.amount < min) return false
      if (max !== undefined && tx.amount > max) return false
      const time = new Date(tx.occurredAt).getTime()
      if (from !== undefined && time < from) return false
      if (to !== undefined && time > to) return false
      if (imageFilter === 'with' && tx.imageIds.length === 0) return false
      if (imageFilter === 'without' && tx.imageIds.length > 0) return false
      if (!q) return true
      return [tx.merchant, tx.description, tx.note, ...(tx.tags ?? []), categoryMap.get(tx.categoryId), accountMap.get(tx.accountId)]
        .filter(Boolean).join(' ').toLocaleLowerCase(locale).includes(q)
    })
    return result.sort((a, b) => {
      if (sort === 'oldest') return a.occurredAt.localeCompare(b.occurredAt)
      if (sort === 'amountHigh') return b.amount - a.amount
      if (sort === 'amountLow') return a.amount - b.amount
      return b.occurredAt.localeCompare(a.occurredAt)
    })
  }, [transactions, search, type, accountId, categoryId, fromDate, toDate, minAmount, maxAmount, imageFilter, sort, categoryMap, accountMap, locale])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const visible = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page])

  useEffect(() => { setPage(1) }, [search, type, accountId, categoryId, fromDate, toDate, minAmount, maxAmount, imageFilter, sort])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  const advancedActive = accountId !== 'all' || categoryId !== 'all' || fromDate || toDate || minAmount || maxAmount || imageFilter !== 'all' || sort !== 'newest'

  function clearAdvanced() {
    setAccountId('all'); setCategoryId('all'); setFromDate(''); setToDate(''); setMinAmount(''); setMaxAmount(''); setImageFilter('all'); setSort('newest')
  }

  async function remove(id: string) {
    if (!confirm(t('transactions.deleteConfirm'))) return
    setDeleting(id)
    try { await deleteTransaction(id) } finally { setDeleting(undefined) }
  }

  const pageLabel = locale.startsWith('vi')
    ? `Trang ${page}/${pageCount} · tối đa ${PAGE_SIZE} giao dịch/trang`
    : `Page ${page}/${pageCount} · up to ${PAGE_SIZE} transactions/page`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-white">{t('transactions.title')}</h1><p className="mt-1 text-sm text-stone-500">{t('transactions.subtitle', { count: transactions.length })}</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setShowVoiceAdd(true)}><Mic size={17} /> {t('voice.entryButton')}</Button><Button onClick={() => setShowAdd(true)}><Plus size={17} /> {t('common.add')}</Button></div>
      </div>

      <Card className="p-3 sm:p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={17} /><Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('transactions.search')} /></div>
          <Select value={type} onChange={(e) => setType(e.target.value as 'all' | TransactionType)}><option value="all">{t('transactions.allTypes')}</option><option value="expense">{t('transaction.expense')}</option><option value="income">{t('transaction.income')}</option><option value="transfer">{t('transaction.transfer')}</option></Select>
          <Button variant={advancedActive ? 'secondary' : 'ghost'} onClick={() => setShowAdvanced((value) => !value)}><SlidersHorizontal size={17} /> {t('transactions.filters')}</Button>
        </div>

        {showAdvanced && <div className="mt-4 grid gap-3 border-t border-stone-200 pt-4 dark:border-stone-800 sm:grid-cols-2 lg:grid-cols-4">
          <div><Label>{t('transactions.account')}</Label><Select value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="all">{t('common.all')}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{accountDisplayName(account, t)}</option>)}</Select></div>
          <div><Label>{t('transactions.category')}</Label><Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="all">{t('common.all')}</option><option value="__uncategorized__">{t('categories.uncategorized')}</option>{selectableCategories(categories).map((category) => <option key={category.id} value={category.id}>{categoryPath(category, categories)}</option>)}</Select></div>
          <div><Label>{t('transactions.fromDate')}</Label><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
          <div><Label>{t('transactions.toDate')}</Label><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
          <div><Label>{t('transactions.minAmount')}</Label><Input type="number" min="0" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} /></div>
          <div><Label>{t('transactions.maxAmount')}</Label><Input type="number" min="0" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} /></div>
          <div><Label>{t('transactions.imagesFilter')}</Label><Select value={imageFilter} onChange={(e) => setImageFilter(e.target.value as typeof imageFilter)}><option value="all">{t('common.all')}</option><option value="with">{t('transactions.withImages')}</option><option value="without">{t('transactions.withoutImages')}</option></Select></div>
          <div><Label>{t('transactions.sort')}</Label><Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}><option value="newest">{t('transactions.sortNewest')}</option><option value="oldest">{t('transactions.sortOldest')}</option><option value="amountHigh">{t('transactions.sortAmountHigh')}</option><option value="amountLow">{t('transactions.sortAmountLow')}</option></Select></div>
          {advancedActive && <div className="sm:col-span-2 lg:col-span-4"><Button variant="ghost" onClick={clearAdvanced}><X size={16} /> {t('transactions.clearFilters')}</Button></div>}
        </div>}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-stone-500"><span>{t('transactions.filteredCount', { count: filtered.length })}</span>{filtered.length > PAGE_SIZE && <span>{pageLabel}</span>}</div>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? <div className="p-4"><EmptyState title={t('transactions.emptyTitle')} text={t('transactions.emptyText')} /></div> : <div className="divide-y divide-stone-100 dark:divide-stone-800">{visible.map((tx) => (
          <div key={tx.id} className="grid gap-3 px-4 py-4 xl:grid-cols-[minmax(0,1.4fr)_190px_190px_auto] xl:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><span className="truncate font-bold text-stone-900 dark:text-white">{tx.merchant || tx.description || t('transaction.noDescription')}</span><Badge tone={tx.type === 'income' ? 'green' : tx.type === 'expense' ? 'red' : 'slate'}>{t(`transaction.${tx.type}`)}</Badge>{isFutureTransaction(tx, now) && <Badge tone="indigo">{t('transactions.scheduled')}</Badge>}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500"><span>{formatDateTime(tx.occurredAt, locale)}</span><span>{categoryMap.get(tx.categoryId) ?? t('categories.uncategorized')}</span><span>{accountMap.get(tx.accountId) ?? t('transactions.unknownAccount')}</span></div>
              {(tx.tags?.length ?? 0) > 0 && <div className="mt-2 flex flex-wrap gap-1">{tx.tags?.map((tag) => <span key={tag} className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">#{tag}</span>)}</div>}
              {tx.note && <div className="mt-1 truncate text-xs text-stone-400">{tx.note}</div>}
            </div>
            <div className="text-sm text-stone-500">{tx.balanceAfter !== undefined ? <>{t('transactions.balanceAfter')} <span className="font-semibold text-stone-700 dark:text-stone-300">{formatMoney(tx.balanceAfter, tx.currency, locale)}</span></> : '—'}</div>
            <div>
              <div className={`font-semibold ${tx.type === 'income' ? 'text-emerald-600' : tx.type === 'expense' ? 'text-rose-600' : 'text-stone-700 dark:text-stone-300'}`}>{tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}{formatMoney(tx.amount, tx.currency, locale)}</div>
              {tx.fx && <div className="mt-0.5 text-[11px] text-stone-400">≈ {formatMoney(tx.fx.convertedAmount, tx.fx.baseCurrency, locale)} · 1 {tx.currency} = {new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(tx.fx.rate)} {tx.fx.baseCurrency} · {tx.fx.rateDate}</div>}
            </div>
            <div className="flex flex-wrap justify-end gap-1">{tx.imageIds.map((id, index) => <Button key={id} variant="ghost" className="px-2" title={t('transactions.imageTitle', { index: index + 1 })} onClick={() => setViewImage(id)}><ImageIcon size={17} /></Button>)}<Button variant="ghost" className="px-2" title={t('transactions.edit')} onClick={() => setEditTx(tx)}><Pencil size={17} /></Button><Button variant="ghost" className="px-2" title={t('transactions.duplicate')} onClick={() => setDuplicateTx(tx)}><Copy size={17} /></Button><Button variant="ghost" className="px-2 text-rose-500" disabled={deleting === tx.id} onClick={() => remove(tx.id)}><Trash2 size={17} /></Button></div>
          </div>
        ))}</div>}
      </Card>

      {filtered.length > PAGE_SIZE && <div className="flex items-center justify-center gap-3"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={17}/>{locale.startsWith('vi') ? 'Trước' : 'Previous'}</Button><span className="text-xs font-semibold text-stone-500">{page}/{pageCount}</span><Button variant="secondary" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>{locale.startsWith('vi') ? 'Sau' : 'Next'}<ChevronRight size={17}/></Button></div>}

      <Suspense fallback={null}>
        {showAdd && <TransactionModal onClose={() => setShowAdd(false)} />}
        {showVoiceAdd && <TransactionModal initialVoice onClose={() => setShowVoiceAdd(false)} />}
        {editTx && <TransactionModal transaction={editTx} onClose={() => setEditTx(undefined)} />}
        {duplicateTx && <TransactionModal duplicateFrom={duplicateTx} onClose={() => setDuplicateTx(undefined)} />}
      </Suspense>
      {viewImage && <ImageViewer imageId={viewImage} onClose={() => setViewImage(undefined)} />}
    </div>
  )
}
