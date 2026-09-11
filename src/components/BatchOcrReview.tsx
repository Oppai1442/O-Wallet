import { AlertTriangle, CheckCircle2, Images, SkipForward } from 'lucide-react'
import type { Account, AccountCatalogue, Category, TransactionType } from '../types'
import { useI18n } from '../i18n'
import { selectableCategories } from '../lib/categories'
import { accountCurrencies } from '../lib/accounts'
import { CategoryPicker } from './CategoryPicker'
import { AccountSelect } from './AccountSelect'
import { Input, Label, Select, Textarea } from './ui'

export interface BatchOcrConflict {
  level: 'exact' | 'possible'
  source: 'existing' | 'batch'
  transactionId: string
  occurredAt: string
  amount: number
  merchant?: string
}

export interface BatchOcrDraft {
  id: string
  fileIndex: number
  selected: boolean
  type: TransactionType
  amount: string
  currency: string
  occurredAt: string
  categoryId: string
  accountId: string
  destinationAccountId?: string
  merchant: string
  balanceAfter: string
  description: string
  rawText: string
  conflict?: BatchOcrConflict
}

export function BatchOcrReview({ drafts, previewUrls, files, accounts, categories, catalogues, activeId, onActiveId, onChange }: {
  drafts: BatchOcrDraft[]
  previewUrls: string[]
  files: File[]
  accounts: Account[]
  categories: Category[]
  catalogues: AccountCatalogue[]
  activeId?: string
  onActiveId: (id: string) => void
  onChange: (draft: BatchOcrDraft) => void
}) {
  const { t } = useI18n()
  const active = drafts.find((draft) => draft.id === activeId) ?? drafts[0]
  if (!active) return null
  const eligibleCategories = selectableCategories(categories, active.type)
  const selectedCount = drafts.filter((draft) => draft.selected).length
  const selectedAccount = accounts.find((account) => account.id === active.accountId)
  const currencies = selectedAccount ? accountCurrencies(selectedAccount) : []
  const patch = (values: Partial<BatchOcrDraft>) => onChange({ ...active, ...values })

  function changeAccount(accountId: string) {
    const account = accounts.find((item) => item.id === accountId)
    const allowed = account ? accountCurrencies(account) : []
    patch({ accountId, currency: allowed.includes(active.currency) ? active.currency : allowed[0] ?? active.currency })
  }

  return <div className="min-w-0 space-y-3 overflow-visible rounded-2xl border border-blue-200 bg-blue-50/40 p-3 dark:border-blue-500/30 dark:bg-blue-500/5">
    <div className="flex flex-wrap items-center gap-2"><div className="flex items-center gap-2 font-bold text-stone-800 dark:text-stone-100"><Images size={18}/>{t('batch.title')}</div><div className="ml-auto text-xs font-semibold text-stone-500">{t('batch.selectedCount', { selected: selectedCount, total: drafts.length })}</div></div>
    <p className="text-xs leading-5 text-stone-500">{t('batch.hint')}</p>
    <div className="grid min-w-0 gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
      <div className="min-w-0 max-h-[520px] space-y-2 overflow-y-auto overflow-x-hidden pr-1">{drafts.map((draft, index) => { const file = files[draft.fileIndex]; const activeRow = draft.id === active.id; return <button type="button" key={draft.id} onClick={() => onActiveId(draft.id)} className={`grid w-full min-w-0 grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border p-2 text-left transition ${activeRow ? 'border-blue-500 bg-white shadow-sm dark:bg-stone-900' : 'border-stone-200 bg-white/70 hover:border-blue-300 dark:border-stone-700 dark:bg-stone-900/70'}`}><img src={previewUrls[draft.fileIndex]} alt="" className="h-12 w-12 rounded-lg object-cover" draggable={false}/><span className="min-w-0"><span className="block truncate text-xs font-bold text-stone-800 dark:text-stone-100">{index + 1}. {file?.name ?? t('common.file')}</span><span className="mt-0.5 block truncate text-[11px] text-stone-500">{draft.amount || '—'} {draft.currency || ''} · {draft.merchant || t('transaction.noDescription')}</span></span><span className="flex flex-col items-end gap-1">{draft.conflict?.level === 'exact' ? <AlertTriangle size={15} className="text-rose-500"/> : draft.conflict ? <AlertTriangle size={15} className="text-amber-500"/> : <CheckCircle2 size={15} className="text-emerald-500"/>}{!draft.selected && <SkipForward size={14} className="text-stone-400"/>}</span></button> })}</div>
      <div className="min-w-0 overflow-visible space-y-3 rounded-xl bg-white p-3 dark:bg-stone-900">
        <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(220px,.8fr)_minmax(0,1fr)]"><div className="flex min-h-48 items-center justify-center overflow-hidden rounded-xl bg-stone-950/5 p-2 dark:bg-stone-950/40"><img src={previewUrls[active.fileIndex]} alt="" className="max-h-72 w-full select-none object-contain" draggable={false}/></div><div className="min-w-0 overflow-hidden"><div className="break-words text-sm font-bold text-stone-800 dark:text-stone-100">{files[active.fileIndex]?.name}</div><label className="mt-2 flex min-w-0 items-start gap-2 text-sm font-semibold leading-5 text-stone-700 dark:text-stone-200"><input className="mt-0.5 shrink-0" type="checkbox" checked={active.selected} onChange={(e) => patch({ selected: e.target.checked })}/><span>{t('batch.include')}</span></label>{active.conflict && <div className={`mt-2 rounded-lg px-2.5 py-2 text-xs ${active.conflict.level === 'exact' ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'}`}>{active.conflict.level === 'exact' ? t('batch.exactDuplicate') : t('batch.possibleDuplicate')}<span className="mt-1 block opacity-80">{active.conflict.source === 'batch' ? t('batch.conflictBatchSource') : t('batch.conflictExistingSource')}</span></div>}</div></div>
        <div className="grid min-w-0 gap-3 md:grid-cols-3"><div><Label>{t('modal.amount')}</Label><Input type="number" value={active.amount} onChange={(e) => patch({ amount: e.target.value })}/></div><div><Label>{t('modal.currency')}</Label><Select value={active.currency} onChange={(e) => patch({ currency: e.target.value })} disabled={currencies.length <= 1}>{currencies.length ? currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>) : <option value={active.currency}>{active.currency}</option>}</Select></div><div><Label>{t('modal.time')}</Label><Input type="datetime-local" value={active.occurredAt} onChange={(e) => patch({ occurredAt: e.target.value })}/></div></div>
        <div className="grid min-w-0 gap-3 md:grid-cols-3"><div><Label>{t('batch.type')}</Label><Select value={active.type} onChange={(e) => patch({ type: e.target.value as TransactionType })}>{(['expense', 'income', 'transfer'] as const).map((value) => <option key={value} value={value}>{t(`transaction.${value}`)}</option>)}</Select></div><div><Label>{t('modal.category')}</Label><CategoryPicker categories={categories} type={active.type} value={active.categoryId} onChange={(value) => patch({ categoryId: value })}/></div><div><Label>{t('modal.account')}</Label><AccountSelect accounts={accounts} catalogues={catalogues} value={active.accountId} onChange={changeAccount}/></div></div>
        {active.type === 'transfer' && <div><Label>{t('modal.destinationAccount')}</Label><AccountSelect accounts={accounts} catalogues={catalogues} value={active.destinationAccountId ?? ''} onChange={(value) => patch({ destinationAccountId: value })} excludeId={active.accountId} includeEmpty/></div>}
        <div className="grid min-w-0 gap-3 md:grid-cols-2"><div className="min-w-0"><Label>{t('modal.merchant')}</Label><Input className="min-w-0" value={active.merchant} onChange={(e) => patch({ merchant: e.target.value })}/></div><div><Label>{t('modal.balanceAfter')}</Label><Input type="number" value={active.balanceAfter} onChange={(e) => patch({ balanceAfter: e.target.value })}/></div></div>
        <div><Label>{t('modal.description')}</Label><Textarea rows={2} className="break-words" value={active.description} onChange={(e) => patch({ description: e.target.value })}/></div>
        <details className="rounded-xl bg-stone-50 p-2.5 dark:bg-stone-950/40"><summary className="cursor-pointer text-xs font-bold text-stone-600 dark:text-stone-300">{t('modal.rawOcr')}</summary><pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words text-[11px] text-stone-500">{active.rawText}</pre></details>
      </div>
    </div>
  </div>
}
