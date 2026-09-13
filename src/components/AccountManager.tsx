import { Check, FolderPlus, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Account, AccountCatalogue, AppSettings, Transaction } from '../types'
import { formatMoney } from '../lib/format'
import { accountBalanceByCurrency } from '../lib/finance'
import { accountCurrencies, accountOpeningBalance, withAccountPockets } from '../lib/accounts'
import { useCurrentTime } from '../lib/useCurrentTime'
import { useI18n, type UiLanguage } from '../i18n'
import { Button, Card, Input, Label, Select } from './ui'
import { CurrencyPicker } from './CurrencyPicker'

type PocketDraft = { currency: string; balance: string }
type PocketCopy = { duplicate: string; inUse: string; add: string; hint: string }

const POCKET_COPY: Record<UiLanguage, PocketCopy> = {
  vi:{duplicate:'Tiền tệ này đã có trong tài khoản.',inUse:'Đang có giao dịch dùng pocket này',add:'Thêm tiền tệ',hint:'Mỗi tài khoản có thể có một hoặc nhiều pocket tiền tệ. Giao dịch chỉ dùng được các tiền tệ có trong tài khoản đó.'},
  en:{duplicate:'This currency already exists in the account.',inUse:'Transactions are using this pocket',add:'Add currency',hint:'Each account can contain one or more currency pockets. Transactions can only use currencies available in that account.'},
  ja:{duplicate:'この通貨はすでに口座に追加されています。',inUse:'この通貨は取引で使用されています',add:'通貨を追加',hint:'1つの口座に複数の通貨を持たせられます。取引では、その口座に登録された通貨だけを使用できます。'},
  'zh-CN':{duplicate:'该币种已存在于账户中。',inUse:'已有交易使用该币种',add:'添加币种',hint:'每个账户可以包含一种或多种币种。交易只能使用该账户中已有的币种。'},
  'zh-TW':{duplicate:'此幣別已存在於帳戶中。',inUse:'已有交易使用此幣別',add:'新增幣別',hint:'每個帳戶可以包含一種或多種幣別。交易只能使用該帳戶中已有的幣別。'},
  th:{duplicate:'บัญชีนี้มีสกุลเงินนี้อยู่แล้ว',inUse:'มีรายการที่ใช้สกุลเงินนี้อยู่',add:'เพิ่มสกุลเงิน',hint:'แต่ละบัญชีสามารถมีได้หลายสกุลเงิน และรายการจะใช้ได้เฉพาะสกุลเงินที่มีอยู่ในบัญชีนั้น'},
  id:{duplicate:'Mata uang ini sudah ada di akun.',inUse:'Ada transaksi yang menggunakan mata uang ini',add:'Tambah mata uang',hint:'Setiap akun dapat memiliki satu atau beberapa mata uang. Transaksi hanya dapat menggunakan mata uang yang tersedia di akun tersebut.'},
  es:{duplicate:'Esta moneda ya existe en la cuenta.',inUse:'Hay transacciones que usan esta moneda',add:'Añadir moneda',hint:'Cada cuenta puede tener una o varias monedas. Las transacciones solo pueden usar las monedas disponibles en esa cuenta.'},
  fr:{duplicate:'Cette devise existe déjà dans le compte.',inUse:'Des transactions utilisent cette devise',add:'Ajouter une devise',hint:'Chaque compte peut contenir une ou plusieurs devises. Une transaction ne peut utiliser que les devises disponibles dans ce compte.'},
  de:{duplicate:'Diese Währung ist im Konto bereits vorhanden.',inUse:'Diese Währung wird von Transaktionen verwendet',add:'Währung hinzufügen',hint:'Ein Konto kann eine oder mehrere Währungen enthalten. Transaktionen können nur im Konto vorhandene Währungen verwenden.'},
  'pt-BR':{duplicate:'Esta moeda já existe na conta.',inUse:'Há transações usando esta moeda',add:'Adicionar moeda',hint:'Cada conta pode ter uma ou mais moedas. As transações só podem usar moedas disponíveis nessa conta.'},
  ru:{duplicate:'Эта валюта уже добавлена к счёту.',inUse:'Эта валюта используется в транзакциях',add:'Добавить валюту',hint:'На одном счёте можно хранить одну или несколько валют. В транзакциях доступны только валюты этого счёта.'},
}

function normalizeCurrency(value: string) {
  return value.trim().toUpperCase()
}

export function AccountManager({ accounts, transactions, settings, onSaveAccount, onSaveAccounts, onSaveSettings }: {
  accounts: Account[]
  transactions: Transaction[]
  settings?: AppSettings
  onSaveAccount: (account: Account) => Promise<void>
  onSaveAccounts: (accounts: Account[]) => Promise<void>
  onSaveSettings: (patch: Partial<AppSettings>) => Promise<void>
}) {
  const { t, locale, uiLanguage } = useI18n()
  const pocketCopy = POCKET_COPY[uiLanguage]
  const now = useCurrentTime()
  const catalogues = settings?.accountCatalogues ?? []
  const reportingCurrency = normalizeCurrency(settings?.defaultCurrency ?? 'VND') || 'VND'
  const [newCatalogue, setNewCatalogue] = useState('')
  const [name, setName] = useState('')
  const [catalogueId, setCatalogueId] = useState('')
  const [newPockets, setNewPockets] = useState<PocketDraft[]>([{ currency: reportingCurrency, balance: '0' }])
  const [editingId, setEditingId] = useState<string>()
  const [editName, setEditName] = useState('')
  const [editCatalogue, setEditCatalogue] = useState('')
  const [editPockets, setEditPockets] = useState<PocketDraft[]>([])
  const activeAccounts = accounts.filter((account) => !account.archived)
  const balances = useMemo(() => new Map(accounts.map((account) => [account.id, accountBalanceByCurrency(account, transactions, now)])), [accounts, transactions, now])

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

  function validPockets(pockets: PocketDraft[]) {
    const codes = pockets.map((item) => normalizeCurrency(item.currency)).filter(Boolean)
    return codes.length > 0 && new Set(codes).size === codes.length && codes.every((code) => /^[A-Z]{3}$/.test(code))
  }

  function pocketRecord(pockets: PocketDraft[]) {
    return Object.fromEntries(pockets.map((item) => [normalizeCurrency(item.currency), Number(item.balance) || 0]))
  }

  async function addAccount() {
    const value = name.trim()
    if (!value || !validPockets(newPockets)) return
    const timestamp = new Date().toISOString()
    const currencies = newPockets.map((item) => normalizeCurrency(item.currency))
    const balancesByCurrency = pocketRecord(newPockets)
    const primary = currencies[0]
    const account: Account = {
      id: crypto.randomUUID(),
      name: value,
      catalogueId: catalogueId || undefined,
      currency: primary,
      openingBalance: balancesByCurrency[primary] ?? 0,
      currencies,
      openingBalances: balancesByCurrency,
      archived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      deleted: false,
    }
    await onSaveAccount(account)
    setName('')
    setNewPockets([{ currency: reportingCurrency, balance: '0' }])
  }

  function beginEdit(account: Account) {
    setEditingId(account.id)
    setEditName(account.name)
    setEditCatalogue(account.catalogueId ?? '')
    setEditPockets(accountCurrencies(account).map((currency) => ({ currency, balance: String(accountOpeningBalance(account, currency)) })))
  }

  function usedCurrencies(account: Account) {
    const used = new Set<string>()
    for (const tx of transactions) {
      if (tx.deleted) continue
      if (tx.accountId === account.id) used.add(normalizeCurrency(tx.currency))
      if (tx.type === 'transfer' && tx.destinationAccountId === account.id) used.add(normalizeCurrency(tx.destinationCurrency ?? tx.currency))
    }
    return used
  }

  async function saveEdit(account: Account) {
    const value = editName.trim()
    if (!value || !validPockets(editPockets)) return
    const currencies = editPockets.map((item) => normalizeCurrency(item.currency))
    const required = usedCurrencies(account)
    if ([...required].some((code) => !currencies.includes(code))) return
    const next = withAccountPockets(
      { ...account, name: value, catalogueId: editCatalogue || undefined, updatedAt: new Date().toISOString() },
      currencies,
      pocketRecord(editPockets),
    )
    await onSaveAccount(next)
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

  function PocketEditor({ pockets, setPockets, locked = new Set<string>() }: { pockets: PocketDraft[]; setPockets: (next: PocketDraft[]) => void; locked?: Set<string> }) {
    return <div className="space-y-2">
      {pockets.map((pocket, index) => {
        const code = normalizeCurrency(pocket.currency)
        const duplicate = pockets.some((item, other) => other !== index && normalizeCurrency(item.currency) === code)
        const cannotRemove = pockets.length <= 1 || locked.has(code)
        return <div key={`${index}:${pocket.currency}`} className="grid gap-2 rounded-xl border border-stone-200 p-2 dark:border-stone-800 sm:grid-cols-[minmax(190px,1fr)_160px_auto] sm:items-end">
          <div><Label>{t('modal.currency')}</Label><CurrencyPicker value={pocket.currency} onChange={(currency) => setPockets(pockets.map((item, i) => i === index ? { ...item, currency } : item))} locale={locale}/>{duplicate && <div className="mt-1 text-[11px] font-semibold text-rose-500">{pocketCopy.duplicate}</div>}</div>
          <div><Label>{t('settings.openingBalance')}</Label><Input type="number" inputMode="decimal" value={pocket.balance} onChange={(e) => setPockets(pockets.map((item, i) => i === index ? { ...item, balance: e.target.value } : item))}/></div>
          <Button variant="ghost" className="px-2 text-rose-500" disabled={cannotRemove} title={locked.has(code) ? pocketCopy.inUse : undefined} onClick={() => setPockets(pockets.filter((_, i) => i !== index))}><Trash2 size={16}/></Button>
        </div>
      })}
      <Button variant="secondary" onClick={() => setPockets([...pockets, { currency: pockets.some((item) => normalizeCurrency(item.currency) === reportingCurrency) ? 'USD' : reportingCurrency, balance: '0' }])}><Plus size={16}/>{pocketCopy.add}</Button>
    </div>
  }

  const renderAccount = (account: Account) => {
    const editing = editingId === account.id
    const accountBalances = balances.get(account.id) ?? new Map<string, number>()
    return <div key={account.id} className="group rounded-2xl border border-stone-200 bg-white p-3.5 transition hover:border-stone-300 dark:border-stone-800 dark:bg-stone-950">
      {editing ? <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
          <Input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} />
          <Select value={editCatalogue} onChange={(e) => setEditCatalogue(e.target.value)}><option value="">{t('accounts.noCatalogue')}</option>{orderedCatalogues.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
          <div className="flex gap-1"><Button className="px-3" onClick={() => void saveEdit(account)}><Check size={16}/></Button><Button variant="ghost" className="px-3" onClick={() => setEditingId(undefined)}><X size={16}/></Button></div>
        </div>
        <PocketEditor pockets={editPockets} setPockets={setEditPockets} locked={usedCurrencies(account)}/>
      </div> : <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1"><div className="truncate font-semibold text-stone-900 dark:text-stone-100">{account.name}</div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">{accountCurrencies(account).map((currency) => <span key={currency}>{formatMoney(accountBalances.get(currency) ?? 0, currency, locale)}</span>)}</div></div>
        <Button variant="ghost" className="px-2 opacity-70 group-hover:opacity-100" onClick={() => beginEdit(account)} title={t('common.edit')}><Pencil size={15}/></Button>
        <Button variant="ghost" className="px-2 text-rose-500 opacity-70 group-hover:opacity-100" onClick={() => void deleteAccount(account)} title={t('common.delete')}><Trash2 size={15}/></Button>
      </div>}
    </div>
  }

  return <Card className="p-4 sm:p-5">
    <div><h2 className="text-base font-semibold text-stone-950 dark:text-white">{t('settings.accounts')}</h2><p className="mt-1 text-sm text-stone-500">{pocketCopy.hint}</p></div>

    <div className="mt-5 rounded-2xl bg-stone-50 p-3 dark:bg-stone-900/60">
      <div className="flex items-center gap-2 text-sm font-semibold text-stone-700 dark:text-stone-200"><FolderPlus size={16}/>{t('accounts.catalogues')}</div>
      <div className="mt-3 flex flex-wrap gap-2">{orderedCatalogues.map((item) => <span key={item.id} className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200">{item.name}<button type="button" onClick={() => void removeCatalogue(item.id)} className="text-stone-400 hover:text-rose-500"><X size={13}/></button></span>)}</div>
      <div className="mt-3 flex gap-2"><Input value={newCatalogue} onChange={(e) => setNewCatalogue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addCatalogue() }} placeholder={t('accounts.cataloguePlaceholder')}/><Button variant="secondary" onClick={() => void addCatalogue()}><Plus size={16}/>{t('common.add')}</Button></div>
    </div>

    <div className="mt-5 space-y-5">
      {orderedCatalogues.map((catalogue) => { const rows = activeAccounts.filter((account) => account.catalogueId === catalogue.id); if (!rows.length) return null; return <section key={catalogue.id}><div className="mb-2 text-xs font-semibold uppercase tracking-[.12em] text-stone-400">{catalogue.name}</div><div className="grid gap-2 md:grid-cols-2">{rows.map(renderAccount)}</div></section> })}
      {uncategorized.length > 0 && <section><div className="mb-2 text-xs font-semibold uppercase tracking-[.12em] text-stone-400">{t('accounts.uncategorized')}</div><div className="grid gap-2 md:grid-cols-2">{uncategorized.map(renderAccount)}</div></section>}
      {activeAccounts.length === 0 && <div className="rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500 dark:border-stone-700">{t('accounts.empty')}</div>}
    </div>

    <div className="mt-5 border-t border-stone-100 pt-4 dark:border-stone-800">
      <div className="mb-3 text-sm font-semibold text-stone-800 dark:text-stone-200">{t('accounts.add')}</div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
        <div><Label>{t('settings.accountPlaceholder')}</Label><Input value={name} onChange={(e) => setName(e.target.value)}/></div>
        <div><Label>{t('accounts.catalogue')}</Label><Select value={catalogueId} onChange={(e) => setCatalogueId(e.target.value)}><option value="">{t('accounts.noCatalogue')}</option>{orderedCatalogues.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></div>
      </div>
      <div className="mt-3"><PocketEditor pockets={newPockets} setPockets={setNewPockets}/></div>
      <div className="mt-3 flex justify-end"><Button onClick={() => void addAccount()} disabled={!name.trim() || !validPockets(newPockets)}><Plus size={16}/>{t('common.add')}</Button></div>
    </div>
  </Card>
}
