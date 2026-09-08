import { useMemo, useState } from 'react'
import { Image as ImageIcon, Plus, Search, Trash2 } from 'lucide-react'
import { useWallet } from '../WalletContext'
import { accountDisplayName, categoryDisplayName, useI18n } from '../i18n'
import { formatDateTime, formatMoney } from '../lib/format'
import type { TransactionType } from '../types'
import { Badge, Button, Card, EmptyState, Input, Select } from './ui'
import { ImageViewer } from './ImageViewer'
import { TransactionModal } from './TransactionModal'

export function Transactions() {
  const { transactions, categories, accounts, deleteTransaction } = useWallet()
  const { t, locale } = useI18n()
  const [search, setSearch] = useState('')
  const [type, setType] = useState<'all' | TransactionType>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [viewImage, setViewImage] = useState<string>()
  const [deleting, setDeleting] = useState<string>()

  const categoryMap = useMemo(() => new Map(categories.map((item) => [item.id, categoryDisplayName(item, t)])), [categories, t])
  const accountMap = useMemo(() => new Map(accounts.map((item) => [item.id, accountDisplayName(item, t)])), [accounts, t])
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase(locale)
    return transactions.filter((tx) => {
      if (type !== 'all' && tx.type !== type) return false
      if (!q) return true
      return [tx.merchant, tx.description, tx.note, categoryMap.get(tx.categoryId), accountMap.get(tx.accountId)]
        .filter(Boolean).join(' ').toLocaleLowerCase(locale).includes(q)
    })
  }, [transactions, search, type, categoryMap, accountMap, locale])

  async function remove(id: string) {
    if (!confirm(t('transactions.deleteConfirm'))) return
    setDeleting(id)
    try { await deleteTransaction(id) } finally { setDeleting(undefined) }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-black tracking-tight text-slate-950 dark:text-white">{t('transactions.title')}</h1><p className="mt-1 text-sm text-slate-500">{t('transactions.subtitle', { count: transactions.length })}</p></div>
        <Button onClick={() => setShowAdd(true)}><Plus size={17} /> {t('common.add')}</Button>
      </div>

      <Card className="p-3 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('transactions.search')} /></div>
          <Select value={type} onChange={(e) => setType(e.target.value as 'all' | TransactionType)}><option value="all">{t('transactions.allTypes')}</option><option value="expense">{t('transaction.expense')}</option><option value="income">{t('transaction.income')}</option><option value="transfer">{t('transaction.transfer')}</option></Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? <div className="p-4"><EmptyState title={t('transactions.emptyTitle')} text={t('transactions.emptyText')} /></div> : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((tx) => (
              <div key={tx.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1.4fr)_180px_150px_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-bold text-slate-900 dark:text-white">{tx.merchant || tx.description || t('transaction.noDescription')}</span>
                    <Badge tone={tx.type === 'income' ? 'green' : tx.type === 'expense' ? 'red' : 'slate'}>{t(`transaction.${tx.type}`)}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500"><span>{formatDateTime(tx.occurredAt, locale)}</span><span>{categoryMap.get(tx.categoryId) ?? t('common.other')}</span><span>{accountMap.get(tx.accountId) ?? t('transactions.unknownAccount')}</span></div>
                  {tx.note && <div className="mt-1 truncate text-xs text-slate-400">{tx.note}</div>}
                </div>
                <div className="text-sm text-slate-500">{tx.balanceAfter !== undefined ? <>{t('transactions.balanceAfter')} <span className="font-semibold text-slate-700 dark:text-slate-300">{formatMoney(tx.balanceAfter, tx.currency, locale)}</span></> : '—'}</div>
                <div className={`font-black ${tx.type === 'income' ? 'text-emerald-600' : tx.type === 'expense' ? 'text-rose-600' : 'text-slate-700 dark:text-slate-300'}`}>{tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}{formatMoney(tx.amount, tx.currency, locale)}</div>
                <div className="flex justify-end gap-1">
                  {tx.imageIds.map((id, index) => <Button key={id} variant="ghost" className="px-2" title={t('transactions.imageTitle', { index: index + 1 })} onClick={() => setViewImage(id)}><ImageIcon size={17} /></Button>)}
                  <Button variant="ghost" className="px-2 text-rose-500" disabled={deleting === tx.id} onClick={() => remove(tx.id)}><Trash2 size={17} /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {showAdd && <TransactionModal onClose={() => setShowAdd(false)} />}
      {viewImage && <ImageViewer imageId={viewImage} onClose={() => setViewImage(undefined)} />}
    </div>
  )
}
