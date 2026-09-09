import { useState } from 'react'
import { Bot, ScanText, Trash2 } from 'lucide-react'
import type { AppSettings, BudgetConfig, SharedTransaction, SharedWalletLedger } from '../types'
import { categoryPath, selectableCategories } from '../lib/categories'
import { formatMoney } from '../lib/format'
import { sharedTransactionsAsPersonalShape } from '../lib/sharedLedger'
import { useWallet } from '../WalletContext'
import { useI18n } from '../i18n'
import { AccountManager } from './AccountManager'
import { AiSettings } from './AiSettings'
import { CategoryManager } from './CategoryManager'
import { CategoryPicker } from './CategoryPicker'
import { RuleManager } from './RuleManager'
import { VoiceSettings } from './VoiceSettings'
import { Button, Card, EmptyState, Input } from './ui'

function settingsAdapter(ledger: SharedWalletLedger, personal?: AppSettings): AppSettings {
  const now = new Date().toISOString()
  return {
    id: 'settings',
    theme: personal?.theme ?? 'system',
    language: personal?.language,
    imageRetention: personal?.imageRetention ?? { mode: 'forever', days: 90 },
    defaultCurrency: ledger.defaultCurrency,
    autoSync: true,
    rememberDefaults: personal?.rememberDefaults,
    ocrTemplates: ledger.ocrTemplates ?? [],
    budgets: ledger.budgets,
    accountCatalogues: ledger.accountCatalogues,
    transactionRules: ledger.transactionRules,
    aiVision: ledger.aiVision,
    voiceInput: ledger.voiceInput ?? personal?.voiceInput,
    transactionDefaults: ledger.transactionDefaults,
    createdAt: personal?.createdAt ?? now,
    updatedAt: now,
    deleted: false,
  }
}

export function SharedProfileSettings({
  ledger,
  transactions,
  editable,
  onSaveLedger,
}: {
  ledger: SharedWalletLedger
  transactions: SharedTransaction[]
  editable: boolean
  onSaveLedger: (ledger: SharedWalletLedger) => Promise<void>
}) {
  const { settings: personalSettings, repository } = useWallet()
  const { t, locale } = useI18n()
  const [budgetCategoryId, setBudgetCategoryId] = useState('')
  const [budgetLimit, setBudgetLimit] = useState('')
  const shapedTransactions = sharedTransactionsAsPersonalShape(transactions)
  const adapted = settingsAdapter(ledger, personalSettings)
  const expenseCategories = selectableCategories(ledger.categories, 'expense')
  const templates = ledger.ocrTemplates ?? []

  async function patchSettings(patch: Partial<AppSettings>) {
    if (!editable) return
    await onSaveLedger({
      ...ledger,
      defaultCurrency: typeof patch.defaultCurrency === 'string' ? patch.defaultCurrency : ledger.defaultCurrency,
      budgets: patch.budgets ?? ledger.budgets,
      accountCatalogues: patch.accountCatalogues ?? ledger.accountCatalogues,
      transactionRules: patch.transactionRules ?? ledger.transactionRules,
      ocrTemplates: patch.ocrTemplates ?? ledger.ocrTemplates,
      aiVision: patch.aiVision ?? ledger.aiVision,
      voiceInput: patch.voiceInput ?? ledger.voiceInput,
      transactionDefaults: patch.transactionDefaults ?? ledger.transactionDefaults,
    })
  }

  async function saveAccount(account: typeof ledger.accounts[number]) {
    if (!editable) return
    await onSaveLedger({ ...ledger, accounts: [...ledger.accounts.filter((item) => item.id !== account.id), account] })
  }

  async function saveAccounts(accounts: typeof ledger.accounts) {
    if (!editable) return
    const ids = new Set(accounts.map((item) => item.id))
    await onSaveLedger({ ...ledger, accounts: [...ledger.accounts.filter((item) => !ids.has(item.id)), ...accounts] })
  }

  async function saveCategory(category: typeof ledger.categories[number]) {
    if (!editable) return
    await onSaveLedger({ ...ledger, categories: [...ledger.categories.filter((item) => item.id !== category.id), category] })
  }

  async function saveCategories(categories: typeof ledger.categories) {
    if (!editable) return
    const ids = new Set(categories.map((item) => item.id))
    await onSaveLedger({ ...ledger, categories: [...ledger.categories.filter((item) => !ids.has(item.id)), ...categories] })
  }

  async function addBudget() {
    const limit = Number(budgetLimit)
    if (!editable || !budgetCategoryId || !Number.isFinite(limit) || limit <= 0) return
    const next: BudgetConfig = { id: crypto.randomUUID(), categoryId: budgetCategoryId, monthlyLimit: limit }
    await onSaveLedger({ ...ledger, budgets: [...ledger.budgets.filter((item) => item.categoryId !== budgetCategoryId), next] })
    setBudgetLimit('')
  }

  async function removeBudget(id: string) {
    if (!editable) return
    await onSaveLedger({ ...ledger, budgets: ledger.budgets.filter((item) => item.id !== id) })
  }

  async function removeTemplate(id: string) {
    if (!editable) return
    await onSaveLedger({ ...ledger, ocrTemplates: templates.filter((item) => item.id !== id) })
  }

  if (!editable) {
    return <Card className="p-5">
      <EmptyState
        title={locale === 'vi' ? 'Cài đặt profile chỉ đọc' : 'Read-only profile settings'}
        text={locale === 'vi'
          ? 'Chỉ owner có thể thay đổi tài khoản, danh mục, budget, rule, Voice/OCR/AI của shared profile này.'
          : 'Only the owner can change accounts, categories, budgets, rules, Voice/OCR/AI for this shared profile.'}
      />
    </Card>
  }

  return <div className="space-y-5">
    <Card className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-blue-50 p-2 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300"><Bot size={18} /></div>
        <div>
          <h2 className="font-bold text-stone-900 dark:text-white">{locale === 'vi' ? 'Shared profile settings' : 'Shared profile settings'}</h2>
          <p className="mt-1 text-sm leading-6 text-stone-500">
            {locale === 'vi'
              ? 'Các module bên dưới dùng cùng component với Personal Wallet, nhưng đọc/ghi vào ledger của shared profile này.'
              : 'The modules below reuse the Personal Wallet components, but read/write this shared profile ledger.'}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-xs font-medium text-stone-500">{t('settings.defaultCurrency')}</div>
          <Input value={ledger.defaultCurrency} onChange={(event) => void patchSettings({ defaultCurrency: event.target.value.toUpperCase().slice(0, 12) || 'VND' })} />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-stone-500">{t('settings.defaultAccount')}</div>
          <select className="h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm dark:border-stone-800 dark:bg-stone-950" value={ledger.transactionDefaults?.accountId ?? ''} onChange={(event) => void patchSettings({ transactionDefaults: { ...ledger.transactionDefaults, accountId: event.target.value || undefined } })}>
            <option value="">{t('common.none')}</option>
            {ledger.accounts.filter((item) => !item.deleted && !item.archived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
      </div>
    </Card>

    <div className="grid gap-5 xl:grid-cols-2">
      <Card className="p-4 sm:p-5">
        <h2 className="font-bold text-stone-900 dark:text-white">{t('settings.budgets')}</h2>
        <p className="mt-1 text-sm text-stone-500">{t('settings.budgetsHint')}</p>
        <div className="mt-4 space-y-2">
          {ledger.budgets.map((budget) => {
            const category = ledger.categories.find((item) => item.id === budget.categoryId)
            return <div key={budget.id} className="flex items-center gap-3 rounded-xl border border-stone-200 p-3 dark:border-stone-800">
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold text-stone-800 dark:text-stone-100">{category ? categoryPath(category, ledger.categories) : budget.categoryId}</div>
                <div className="text-xs text-stone-500">{formatMoney(budget.monthlyLimit, ledger.defaultCurrency, locale)} / {t('settings.month')}</div>
              </div>
              <Button variant="ghost" className="px-2 text-rose-500" onClick={() => void removeBudget(budget.id)}><Trash2 size={16} /></Button>
            </div>
          })}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
          <CategoryPicker categories={expenseCategories} type="expense" value={budgetCategoryId} onChange={setBudgetCategoryId} placeholder={t('settings.chooseCategory')} />
          <Input type="number" min="1" value={budgetLimit} onChange={(event) => setBudgetLimit(event.target.value)} placeholder={t('settings.budgetLimit')} />
          <Button onClick={() => void addBudget()}>{t('common.add')}</Button>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3"><ScanText size={18} className="mt-0.5 text-stone-400" /><div><h2 className="font-bold text-stone-900 dark:text-white">{t('settings.ocrTemplates')}</h2><p className="mt-1 text-sm text-stone-500">{t('settings.ocrTemplatesHint')}</p></div></div>
        <div className="mt-4 space-y-2">
          {templates.length === 0 ? <div className="rounded-xl bg-stone-50 p-3 text-sm text-stone-500 dark:bg-stone-950">{t('settings.noOcrTemplates')}</div> : templates.map((template) => <div key={template.id} className="flex items-center gap-3 rounded-xl border border-stone-200 p-3 dark:border-stone-800">
            <div className="min-w-0 flex-1"><div className="truncate font-bold text-stone-800 dark:text-stone-100">{template.name}</div><div className="text-xs text-stone-500">{t('settings.regionCount', { count: template.regions.length })}</div></div>
            <Button variant="ghost" className="px-2 text-rose-500" onClick={() => void removeTemplate(template.id)}><Trash2 size={16} /></Button>
          </div>)}
        </div>
        <p className="mt-3 text-xs leading-5 text-stone-500">{locale === 'vi' ? 'Template mới được tạo trực tiếp trong Add transaction của shared profile.' : 'New templates are created directly from the shared profile Add transaction flow.'}</p>
      </Card>
    </div>

    <VoiceSettings settings={adapted} onSaveSettings={patchSettings} />
    <AiSettings settings={adapted} repository={repository} onSaveSettings={patchSettings} />

    <AccountManager
      accounts={ledger.accounts}
      transactions={shapedTransactions}
      settings={adapted}
      onSaveAccount={saveAccount}
      onSaveAccounts={saveAccounts}
      onSaveSettings={patchSettings}
    />

    <CategoryManager
      categories={ledger.categories}
      transactions={shapedTransactions}
      onSave={saveCategory}
      onSaveMany={saveCategories}
    />

    <RuleManager settings={adapted} categories={ledger.categories} accounts={ledger.accounts} onSaveSettings={patchSettings} />
  </div>
}
