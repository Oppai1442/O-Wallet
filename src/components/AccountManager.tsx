import { Check, FolderPlus, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Account, AccountCatalogue, AppSettings, Transaction } from '../types'
import { formatMoney } from '../lib/format'
import { accountBalance } from '../lib/finance'
import { useCurrentTime } from '../lib/useCurrentTime'
import { useI18n } from '../i18n'
import { Button, Card, Input, Label, Select } from './ui'

export function AccountManager({ accounts, transactions, settings, onSaveAccount, onSaveAccounts, onSaveSettings }: {
  accounts: Account[]
  transactions: Transaction[]
  settings?: AppSettings
  onSaveAccount: (account: Account) => Promise<void>
  onSaveAccounts: (accounts: Account[]) => Promise<void>
  onSaveSettings: (patch: Partial<AppSettings>) => Promise<void>
}) {
  const { t, locale } = useI18n()
  const now = useCurrentTime()
  const catalogues = settings?.accountCatalogues ?? []
  const [newCatalogue, setNewCatalogue] = useState('')
  const [name, setName] = useState('')
  const [openingBalance, setOpeningBalance] = useState('0')
  const [catalogueId, setCatalogueId] = useState('')
  const [editingId, setEditingId] = useState<string>()
  const [editName, setEditName] = useState('')
  const [editCatalogue, setEditCatalogue] = useState('')
  const activeAccounts = accounts.filter((account) => !account.archived)
  const balances = useMemo(() => new Map(accounts.map((account) => [account.id, accountBalance(account, transactions, now)])), [accounts, transactions, now])

  async function addCatalogue() {
    const value = newCatalogue.trim()
    if (!value || !settings) return
    const timestamp = new Date().toISOString()
    const next: AccountCatalogue = { id: crypto.randomUUID(), name: value, createdAt: timestamp, updatedAt: timestamp }
    await onSaveSettings({ accountCatalogues: [...catalogues, next] })
    setNewCatalogue('')
  }

  async function removeCatalogue(id: string) {
    if (!settings || !confirm(t('accounts.deleteCatalogueConfirm'))) return
    const affected = accounts.filter((account) => account.catalogueId === id).map((account) => ({ ...account, catalogueId: undefined, updatedAt: new Date().toISOString() }))
    if (affected.length) await onSaveAccounts(affected)
    await onSaveSettings({ accountCatalogues: catalogues.filter((item) => item.id !== id) })
  }

  async function addAccount() {
    const value = name.trim()
    if (!value) return
    const timestamp = new Date().toISOString()
    await onSaveAccount({
      id: crypto.randomUUID(),
      name: value,
      catalogueId: catalogueId || undefined,
      currency: settings?.defaultCurrency ?? 'VND',
      openingBalance: Number(openingBalance) || 0,
      archived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      deleted: false,
    })
    setName(''); setOpeningBalance('0')
  }

  function beginEdit(account: Account) {
    setEditingId(account.id)
    setEditName(account.name)
    setEditCatalogue(account.catalogueId ?? '')
  }

  async function saveEdit(account: Account) {
    const value = editName.trim()
    if (!value) return
    await onSaveAccount({ ...account, name: value, catalogueId: editCatalogue || undefined, updatedAt: new Date().toISOString() })
    setEditingId(undefined)
  }

  async function deleteAccount(account: Account) {
    const usage = transactions.filter((tx) => tx.accountId === account.id || tx.destinationAccountId === account.id).length
    const message = usage ? t('accounts.deleteUsedConfirm', { count: usage }) : t('accounts.deleteConfirm')
    if (!confirm(message)) return
    const nowIso = new Date().toISOString()
    await onSaveAccount(usage ? { ...account, archived: true, updatedAt: nowIso } : { ...account, deleted: true, updatedAt: nowIso })
    if (settings?.transactionDefaults?.accountId === account.id) {
      await onSaveSettings({ transactionDefaults: { ...settings.transactionDefaults, accountId: undefined } })
    }
  }

  const orderedCatalogues = [...catalogues].sort((a, b) => a.name.localeCompare(b.name, locale))
  const uncategorized = activeAccounts.filter((account) => !account.catalogueId || !catalogues.some((item) => item.id === account.catalogueId))

  const renderAccount = (account: Account) => {
    const editing = editingId === account.id
    return <div key={account.id} className="group rounded-2xl border border-stone-200 bg-white p-3.5 transition hover:border-stone-300 dark:border-stone-800 dark:bg-stone-950">
      {editing ? <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
        <Input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} />
        <Select value={editCatalogue} onChange={(e) => setEditCatalogue(e.target.value)}><option value="">{t('accounts.noCatalogue')}</option>{orderedCatalogues.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
        <div className="flex gap-1"><Button className="px-3" onClick={() => void saveEdit(account)}><Check size={16} /></Button><Button variant="ghost" className="px-3" onClick={() => setEditingId(undefined)}><X size={16} /></Button></div>
      </div> : <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1"><div className="truncate font-semibold text-stone-900 dark:text-stone-100">{account.name}</div><div className="mt-0.5 text-xs text-stone-500">{formatMoney(balances.get(account.id) ?? 0, account.currency, locale)}</div></div>
        <Button variant="ghost" className="px-2 opacity-70 group-hover:opacity-100" onClick={() => beginEdit(account)} title={t('common.edit')}><Pencil size={15} /></Button>
        <Button variant="ghost" className="px-2 text-rose-500 opacity-70 group-hover:opacity-100" onClick={() => void deleteAccount(account)} title={t('common.delete')}><Trash2 size={15} /></Button>
      </div>}
    </div>
  }

  return <Card className="p-4 sm:p-5">
    <div><h2 className="text-base font-semibold text-stone-950 dark:text-white">{t('settings.accounts')}</h2><p className="mt-1 text-sm text-stone-500">{t('accounts.managerHint')}</p></div>

    <div className="mt-5 rounded-2xl bg-stone-50 p-3 dark:bg-stone-900/60">
      <div className="flex items-center gap-2 text-sm font-semibold text-stone-700 dark:text-stone-200"><FolderPlus size={16} />{t('accounts.catalogues')}</div>
      <div className="mt-3 flex flex-wrap gap-2">{orderedCatalogues.map((item) => <span key={item.id} className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200">{item.name}<button type="button" onClick={() => void removeCatalogue(item.id)} className="text-stone-400 hover:text-rose-500"><X size={13} /></button></span>)}</div>
      <div className="mt-3 flex gap-2"><Input value={newCatalogue} onChange={(e) => setNewCatalogue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addCatalogue() }} placeholder={t('accounts.cataloguePlaceholder')} /><Button variant="secondary" onClick={() => void addCatalogue()}><Plus size={16} />{t('common.add')}</Button></div>
    </div>

    <div className="mt-5 space-y-5">
      {orderedCatalogues.map((catalogue) => {
        const rows = activeAccounts.filter((account) => account.catalogueId === catalogue.id)
        if (!rows.length) return null
        return <section key={catalogue.id}><div className="mb-2 text-xs font-semibold uppercase tracking-[.12em] text-stone-400">{catalogue.name}</div><div className="grid gap-2 md:grid-cols-2">{rows.map(renderAccount)}</div></section>
      })}
      {uncategorized.length > 0 && <section><div className="mb-2 text-xs font-semibold uppercase tracking-[.12em] text-stone-400">{t('accounts.uncategorized')}</div><div className="grid gap-2 md:grid-cols-2">{uncategorized.map(renderAccount)}</div></section>}
      {activeAccounts.length === 0 && <div className="rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500 dark:border-stone-700">{t('accounts.empty')}</div>}
    </div>

    <div className="mt-5 border-t border-stone-100 pt-4 dark:border-stone-800">
      <div className="mb-3 text-sm font-semibold text-stone-800 dark:text-stone-200">{t('accounts.add')}</div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_180px_auto]">
        <div><Label>{t('settings.accountPlaceholder')}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>{t('settings.openingBalance')}</Label><Input type="number" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} /></div>
        <div><Label>{t('accounts.catalogue')}</Label><Select value={catalogueId} onChange={(e) => setCatalogueId(e.target.value)}><option value="">{t('accounts.noCatalogue')}</option>{orderedCatalogues.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></div>
        <div className="self-end"><Button className="w-full" onClick={() => void addAccount()}><Plus size={16} />{t('common.add')}</Button></div>
      </div>
    </div>
  </Card>
}
