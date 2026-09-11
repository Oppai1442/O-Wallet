import { Plus, Power, Trash2, WandSparkles } from 'lucide-react'
import { useState } from 'react'
import type { Account, AccountCatalogue, AppSettings, Category, TransactionRule, TransactionType } from '../types'
import { categoryPath } from '../lib/categories'
import { useI18n } from '../i18n'
import { AccountSelect } from './AccountSelect'
import { CategoryPicker } from './CategoryPicker'
import { Button, Card, Input, Label, Select } from './ui'

export function RuleManager({ settings, categories, accounts, onSaveSettings }: {
  settings?: AppSettings
  categories: Category[]
  accounts: Account[]
  onSaveSettings: (patch: Partial<AppSettings>) => Promise<void>
}) {
  const { t } = useI18n()
  const rules = settings?.transactionRules ?? []
  const catalogues: AccountCatalogue[] = settings?.accountCatalogues ?? []
  const [name, setName] = useState('')
  const [merchant, setMerchant] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [type, setType] = useState<'' | TransactionType>('')
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')

  async function add() {
    if (!settings || (!merchant.trim() && !description.trim() && !amount && !type) || (!categoryId && !accountId)) return
    const timestamp = new Date().toISOString()
    const rule: TransactionRule = {
      id: crypto.randomUUID(), name: name.trim() || t('rules.autoName'), enabled: true,
      merchantContains: merchant.trim() || undefined,
      descriptionContains: description.trim() || undefined,
      amountEquals: amount ? Number(amount) : undefined,
      transactionType: type || undefined,
      categoryId: categoryId || undefined,
      accountId: accountId || undefined,
      createdAt: timestamp, updatedAt: timestamp,
    }
    await onSaveSettings({ transactionRules: [...rules, rule] })
    setName(''); setMerchant(''); setDescription(''); setAmount(''); setType(''); setCategoryId(''); setAccountId('')
  }
  async function patch(id: string, values: Partial<TransactionRule>) { await onSaveSettings({ transactionRules: rules.map((rule) => rule.id === id ? { ...rule, ...values, updatedAt: new Date().toISOString() } : rule) }) }
  async function remove(id: string) { await onSaveSettings({ transactionRules: rules.filter((rule) => rule.id !== id) }) }

  return <Card className="p-4 sm:p-5">
    <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300"><WandSparkles size={17} /></span><div><h2 className="text-base font-semibold text-stone-950 dark:text-white">{t('rules.title')}</h2><p className="mt-1 text-sm text-stone-500">{t('rules.hint')}</p></div></div>

    <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50/60 p-3 dark:border-stone-800 dark:bg-stone-950/30">
      <div className="mb-3 text-sm font-semibold text-stone-800 dark:text-stone-200">{t('rules.create')}</div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div><Label>{t('rules.name')}</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('rules.namePlaceholder')} /></div>
        <div><Label>{t('rules.recipientContains')}</Label><Input value={merchant} onChange={(e) => setMerchant(e.target.value)} /></div>
        <div><Label>{t('rules.descriptionContains')}</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div><Label>{t('rules.amountEquals')}</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><Label>{t('rules.transactionType')}</Label><Select value={type} onChange={(e) => setType(e.target.value as '' | TransactionType)}><option value="">{t('common.any')}</option><option value="expense">{t('transaction.expense')}</option><option value="income">{t('transaction.income')}</option><option value="transfer">{t('transaction.transfer')}</option></Select></div>
        <div><Label>{t('rules.category')}</Label><CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} placeholder={t('common.none')} /></div>
        <div><Label>{t('rules.account')}</Label><AccountSelect accounts={accounts} catalogues={catalogues} value={accountId} onChange={setAccountId} includeEmpty /></div>
        <div className="self-end"><Button className="w-full" onClick={() => void add()}><Plus size={16} />{t('rules.add')}</Button></div>
      </div>
    </div>

    <div className="mt-5 space-y-2">{rules.length === 0 ? <div className="rounded-2xl border border-dashed border-stone-300 px-4 py-7 text-center text-sm text-stone-500 dark:border-stone-700">{t('rules.empty')}</div> : rules.map((rule) => <div key={rule.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200 px-3.5 py-3 dark:border-stone-800"><button type="button" onClick={() => void patch(rule.id, { enabled: !rule.enabled })} className={`flex h-8 w-8 items-center justify-center rounded-lg ${rule.enabled ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' : 'bg-stone-100 text-stone-400 dark:bg-stone-800'}`}><Power size={15} /></button><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-stone-800 dark:text-stone-200">{rule.name}</div><div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-stone-500">{rule.merchantContains && <span>{t('rules.recipient')}: “{rule.merchantContains}”</span>}{rule.amountEquals !== undefined && <span>{t('rules.amount')}: {rule.amountEquals}</span>}{rule.categoryId && <span>→ {categoryPath(categories.find((item) => item.id === rule.categoryId) ?? ({ id:'',name:'?',icon:'',kind:'both',archived:false,createdAt:'',updatedAt:'',deleted:false } as Category), categories)}</span>}</div></div><Button variant="ghost" className="px-2 text-rose-500" onClick={() => void remove(rule.id)}><Trash2 size={15} /></Button></div>)}</div>
  </Card>
}
