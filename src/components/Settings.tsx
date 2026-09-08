import { useEffect, useMemo, useState } from 'react'
import { Cloud, Download, ExternalLink, FolderOpen, LockKeyhole, Plus, RefreshCw, Trash2, Unplug } from 'lucide-react'
import { useWallet } from '../WalletContext'
import { accountDisplayName, categoryDisplayName, useI18n, type Language } from '../i18n'
import { bytesToHuman, formatMoney } from '../lib/format'
import { accountBalance } from '../lib/finance'
import { useCurrentTime } from '../lib/useCurrentTime'
import { findExistingDriveLayout, openDriveFolderUrl } from '../lib/drive'
import type {
  Account,
  AppSettings,
  BudgetConfig,
  Category,
  RememberDuration,
  ThemeMode,
  VaultRememberDuration,
} from '../types'
import { Badge, Button, Card, Input, Label, Select } from './ui'

function downloadText(filename: string, text: string, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function csvCell(value: unknown) {
  const text = value === undefined || value === null ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

export function Settings() {
  const {
    settings,
    accounts,
    categories,
    transactions,
    repository,
    saveEntity,
    googleSession,
    googleBinding,
    googleRememberedUser,
    googleConnectionState,
    googleConfigured,
    devicePreferences,
    updateDevicePreferences,
    connectGoogle,
    retryGoogleConnection,
    disconnectGoogle,
    switchLocalAccount,
    syncNow,
    syncBusy,
    syncMessage,
    lastSync,
    lock,
    error,
  } = useWallet()
  const { t, locale, language, setLanguage } = useI18n()
  const [storage, setStorage] = useState({ recordCount: 0, imageCount: 0, imageBytes: 0 })
  const [driveFolder, setDriveFolder] = useState<string>()
  const [accountName, setAccountName] = useState('')
  const [openingBalance, setOpeningBalance] = useState('0')
  const [categoryName, setCategoryName] = useState('')
  const [categoryKind, setCategoryKind] = useState<Category['kind']>('expense')
  const [budgetCategoryId, setBudgetCategoryId] = useState('')
  const [budgetLimit, setBudgetLimit] = useState('')

  useEffect(() => { void repository?.storageStats().then(setStorage) }, [repository, transactions])
  useEffect(() => {
    if (!googleSession) { setDriveFolder(undefined); return }
    void findExistingDriveLayout(googleSession.accessToken)
      .then((layout) => setDriveFolder(layout?.rootId))
      .catch(() => setDriveFolder(undefined))
  }, [googleSession, lastSync])

  const now = useCurrentTime()
  const accountBalances = useMemo(
    () => accounts.map((account) => ({ account, balance: accountBalance(account, transactions, now) })),
    [accounts, transactions, now],
  )
  const expenseCategories = categories.filter((category) => category.kind !== 'income')
  const budgets = settings?.budgets ?? []
  const templates = settings?.ocrTemplates ?? []

  async function updateSettings(patch: Partial<AppSettings>) {
    if (!settings) return
    await saveEntity({ ...settings, ...patch, updatedAt: new Date().toISOString() })
  }

  async function changeLanguage(next: Language) {
    setLanguage(next)
    await updateSettings({ language: next })
  }

  async function changeRemember(kind: 'google' | 'vault', value: RememberDuration | VaultRememberDuration) {
    const next = kind === 'google'
      ? { ...devicePreferences, googleRemember: value as RememberDuration }
      : { ...devicePreferences, vaultRemember: value as VaultRememberDuration }
    await updateDevicePreferences(next)
    await updateSettings({ rememberDefaults: next })
  }

  async function addAccount() {
    if (!accountName.trim()) return
    const now = new Date().toISOString()
    const account: Account = {
      id: crypto.randomUUID(),
      name: accountName.trim(),
      currency: settings?.defaultCurrency ?? 'VND',
      openingBalance: Number(openingBalance) || 0,
      archived: false,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    }
    await saveEntity(account)
    setAccountName('')
    setOpeningBalance('0')
  }

  async function addCategory() {
    if (!categoryName.trim()) return
    const now = new Date().toISOString()
    const category: Category = {
      id: crypto.randomUUID(),
      name: categoryName.trim(),
      icon: 'Shapes',
      kind: categoryKind,
      archived: false,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    }
    await saveEntity(category)
    setCategoryName('')
  }

  async function addBudget() {
    if (!settings || !budgetCategoryId || !Number(budgetLimit) || Number(budgetLimit) <= 0) return
    const next: BudgetConfig = { id: crypto.randomUUID(), categoryId: budgetCategoryId, monthlyLimit: Number(budgetLimit) }
    await updateSettings({ budgets: [...budgets.filter((item) => item.categoryId !== budgetCategoryId), next] })
    setBudgetLimit('')
  }

  async function removeBudget(id: string) {
    await updateSettings({ budgets: budgets.filter((budget) => budget.id !== id) })
  }

  async function removeTemplate(id: string) {
    await updateSettings({ ocrTemplates: templates.filter((template) => template.id !== id) })
  }

  async function confirmSwitchAccount() {
    if (!window.confirm(t('settings.switchAccountConfirm'))) return
    await switchLocalAccount()
  }

  function exportJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      transactions,
      accounts,
      categories,
      settings,
    }
    downloadText(`o-wallet-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2))
  }

  function exportCsv() {
    const header = ['id', 'type', 'amount', 'currency', 'occurredAt', 'category', 'account', 'merchant', 'balanceAfter', 'description', 'note', 'tags', 'images']
    const categoryMap = new Map(categories.map((item) => [item.id, categoryDisplayName(item, t)]))
    const accountMap = new Map(accounts.map((item) => [item.id, accountDisplayName(item, t)]))
    const rows = transactions.map((tx) => [
      tx.id, tx.type, tx.amount, tx.currency, tx.occurredAt,
      categoryMap.get(tx.categoryId) ?? tx.categoryId,
      accountMap.get(tx.accountId) ?? tx.accountId,
      tx.merchant ?? '', tx.balanceAfter ?? '', tx.description ?? '', tx.note ?? '', (tx.tags ?? []).join('|'), tx.imageIds.length,
    ].map(csvCell).join(','))
    downloadText(`o-wallet-transactions-${new Date().toISOString().slice(0, 10)}.csv`, [header.map(csvCell).join(','), ...rows].join('\n'), 'text/csv')
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-950 dark:text-white">{t('settings.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('settings.subtitle')}</p>
      </div>

      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-900 dark:text-white">{t('settings.driveSync')}</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">{t('settings.driveHint')}</p>
          </div>
          {googleConnectionState === 'connected' && <Badge tone="green">{t('common.connected')}</Badge>}
          {googleConnectionState === 'reconnecting' && <Badge tone="amber">{t('common.reconnecting')}</Badge>}
          {googleConnectionState === 'attention' && <Badge tone="red">{t('common.actionRequired')}</Badge>}
          {googleConnectionState === 'disconnected' && <Badge>{t('common.disconnected')}</Badge>}
        </div>

        {!googleConfigured && <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{t('settings.clientMissing')}</div>}

        {googleSession ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {googleSession.user.picture && <img src={googleSession.user.picture} className="h-10 w-10 rounded-full" alt={t('settings.googleProfileAlt')} />}
            <div className="mr-auto min-w-0"><div className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{googleSession.user.name}</div><div className="truncate text-xs text-slate-500">{googleSession.user.email}</div></div>
            <Button variant="secondary" onClick={() => void syncNow()} disabled={syncBusy}><RefreshCw className={syncBusy ? 'animate-spin' : ''} size={17} />{syncBusy ? syncMessage || t('common.syncing') : t('settings.syncNow')}</Button>
            {driveFolder && <Button variant="secondary" onClick={() => window.open(openDriveFolderUrl(driveFolder), '_blank', 'noopener,noreferrer')}><FolderOpen size={17} /> {t('settings.openDrive')}</Button>}
            <Button variant="ghost" onClick={disconnectGoogle}><Unplug size={17} /> {t('settings.disconnect')}</Button>
          </div>
        ) : (googleRememberedUser || googleBinding) ? (
          <div className="mt-4 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="flex flex-wrap items-center gap-3">
              {(googleRememberedUser?.picture || googleBinding?.picture) && <img src={googleRememberedUser?.picture ?? googleBinding?.picture} className="h-10 w-10 rounded-full" alt={t('settings.googleProfileAlt')} />}
              <div className="mr-auto min-w-0">
                <div className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{googleRememberedUser?.name ?? googleBinding?.name}</div>
                <div className="truncate text-xs text-slate-500">{googleRememberedUser?.email ?? googleBinding?.email}</div>
              </div>
              <Button variant="secondary" onClick={() => void retryGoogleConnection()} disabled={!googleConfigured || googleConnectionState === 'reconnecting'}>
                <RefreshCw className={googleConnectionState === 'reconnecting' ? 'animate-spin' : ''} size={17} />
                {t('settings.reconnectGoogle')}
              </Button>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">{googleConnectionState === 'reconnecting' ? t('settings.reconnectingHint') : t('settings.reconnectNeededHint')}</p>
          </div>
        ) : (
          <div className="mt-4"><Button onClick={() => void connectGoogle()} disabled={!googleConfigured}><Cloud size={17} /> {t('settings.connectGoogle')}</Button></div>
        )}

        {lastSync && <div className="mt-3 text-xs text-slate-500">{t('settings.lastSync', { pulledRecords: lastSync.pulledRecords, pulledImages: lastSync.pulledImages, pushedRecords: lastSync.pushedRecords, pushedImages: lastSync.pushedImages, conflicts: lastSync.conflictsResolved })}</div>}
        {error && <div className="mt-3 text-sm text-rose-600">{error}</div>}
      </Card>

      <Card className="p-4 sm:p-5">
        <div><h2 className="font-bold text-slate-900 dark:text-white">{t('settings.preferences')}</h2><p className="mt-1 text-sm text-slate-500">{t('settings.preferencesHint')}</p></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div><Label>{t('common.language')}</Label><Select value={language} onChange={(e) => void changeLanguage(e.target.value as Language)}><option value="vi">{t('language.vi')}</option><option value="en">{t('language.en')}</option></Select></div>
          <div><Label>{t('settings.theme')}</Label><Select value={settings?.theme ?? 'system'} onChange={(e) => void updateSettings({ theme: e.target.value as ThemeMode })}><option value="system">{t('common.system')}</option><option value="light">{t('common.light')}</option><option value="dark">{t('common.dark')}</option></Select></div>
          <div><Label>{t('settings.defaultCurrency')}</Label><Input value={settings?.defaultCurrency ?? 'VND'} onChange={(e) => void updateSettings({ defaultCurrency: e.target.value.toUpperCase() || 'VND' })} /></div>
          <div><Label>{t('settings.autoSync')}</Label><Select value={settings?.autoSync ? 'on' : 'off'} onChange={(e) => void updateSettings({ autoSync: e.target.value === 'on' })}><option value="on">{t('common.on')}</option><option value="off">{t('common.off')}</option></Select></div>
          <div><Label>{t('settings.googleRemember')}</Label><Select value={devicePreferences.googleRemember} onChange={(e) => void changeRemember('google', e.target.value as RememberDuration)}><option value="off">{t('settings.googleRememberOff')}</option><option value="tab">{t('settings.googleRememberTab')}</option><option value="1h">{t('settings.duration1h')}</option><option value="8h">{t('settings.duration8h')}</option><option value="1d">{t('settings.duration1d')}</option><option value="7d">{t('settings.duration7d')}</option><option value="30d">{t('settings.duration30d')}</option></Select><p className="mt-1.5 text-xs leading-5 text-slate-500">{t('settings.rememberSyncedHint')}</p></div>
          <div><Label>{t('settings.vaultRemember')}</Label><Select value={devicePreferences.vaultRemember} onChange={(e) => void changeRemember('vault', e.target.value as VaultRememberDuration)}><option value="off">{t('settings.vaultRememberOff')}</option><option value="15m">{t('settings.duration15m')}</option><option value="1h">{t('settings.duration1h')}</option><option value="8h">{t('settings.duration8h')}</option><option value="1d">{t('settings.duration1d')}</option><option value="7d">{t('settings.duration7d')}</option><option value="30d">{t('settings.duration30d')}</option></Select><p className="mt-1.5 text-xs leading-5 text-slate-500">{t('settings.vaultRememberHint')}</p></div>
          <div><Label>{t('settings.imageRetention')}</Label><Select value={settings?.imageRetention.mode ?? 'forever'} onChange={(e) => void updateSettings({ imageRetention: { mode: e.target.value as 'forever' | 'days', days: settings?.imageRetention.days ?? 90 } })}><option value="forever">{t('common.forever')}</option><option value="days">{t('common.days', { count: settings?.imageRetention.days ?? 90 })}</option></Select></div>
          {settings?.imageRetention.mode === 'days' && <div><Label>{t('settings.keepDays')}</Label><Input type="number" min="1" value={settings.imageRetention.days} onChange={(e) => void updateSettings({ imageRetention: { mode: 'days', days: Math.max(1, Number(e.target.value) || 1) } })} /></div>}
          <div><Label>{t('settings.defaultAccount')}</Label><Select value={settings?.transactionDefaults?.accountId ?? ''} onChange={(e) => void updateSettings({ transactionDefaults: { ...settings?.transactionDefaults, accountId: e.target.value || undefined } })}><option value="">{t('common.none')}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{accountDisplayName(account, t)}</option>)}</Select></div>
          <div><Label>{t('settings.defaultCategory')}</Label><Select value={settings?.transactionDefaults?.categoryId ?? ''} onChange={(e) => void updateSettings({ transactionDefaults: { ...settings?.transactionDefaults, categoryId: e.target.value || undefined } })}><option value="">{t('common.none')}</option>{categories.map((category) => <option key={category.id} value={category.id}>{categoryDisplayName(category, t)}</option>)}</Select></div>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <h2 className="font-bold text-slate-900 dark:text-white">{t('settings.budgets')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('settings.budgetsHint')}</p>
          <div className="mt-4 space-y-2">
            {budgets.map((budget) => {
              const category = categories.find((item) => item.id === budget.categoryId)
              return <div key={budget.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800"><div className="min-w-0 flex-1"><div className="truncate font-bold text-slate-800 dark:text-slate-100">{category ? categoryDisplayName(category, t) : budget.categoryId}</div><div className="text-xs text-slate-500">{formatMoney(budget.monthlyLimit, settings?.defaultCurrency ?? 'VND', locale)} / {t('settings.month')}</div></div><Button variant="ghost" className="px-2 text-rose-500" onClick={() => void removeBudget(budget.id)}><Trash2 size={16} /></Button></div>
            })}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]"><Select value={budgetCategoryId} onChange={(e) => setBudgetCategoryId(e.target.value)}><option value="">{t('settings.chooseCategory')}</option>{expenseCategories.map((category) => <option key={category.id} value={category.id}>{categoryDisplayName(category, t)}</option>)}</Select><Input type="number" min="1" value={budgetLimit} onChange={(e) => setBudgetLimit(e.target.value)} placeholder={t('settings.budgetLimit')} /><Button onClick={() => void addBudget()}><Plus size={17} /> {t('common.add')}</Button></div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="font-bold text-slate-900 dark:text-white">{t('settings.ocrTemplates')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('settings.ocrTemplatesHint')}</p>
          <div className="mt-4 space-y-2">{templates.length === 0 ? <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-950">{t('settings.noOcrTemplates')}</div> : templates.map((template) => <div key={template.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800"><div className="min-w-0 flex-1"><div className="truncate font-bold text-slate-800 dark:text-slate-100">{template.name}</div><div className="text-xs text-slate-500">{t('settings.regionCount', { count: template.regions.length })}</div></div><Button variant="ghost" className="px-2 text-rose-500" onClick={() => void removeTemplate(template.id)}><Trash2 size={16} /></Button></div>)}</div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <h2 className="font-bold text-slate-900 dark:text-white">{t('settings.localStorage')}</h2>
          <div className="mt-4 grid grid-cols-3 gap-3"><div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><div className="text-xs text-slate-500">{t('settings.records')}</div><div className="mt-1 font-black text-slate-900 dark:text-white">{storage.recordCount}</div></div><div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><div className="text-xs text-slate-500">{t('settings.images')}</div><div className="mt-1 font-black text-slate-900 dark:text-white">{storage.imageCount}</div></div><div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><div className="text-xs text-slate-500">{t('settings.encryptedImageBytes')}</div><div className="mt-1 font-black text-slate-900 dark:text-white">{bytesToHuman(storage.imageBytes)}</div></div></div>
          <div className="mt-4"><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t('settings.export')}</h3><p className="mt-1 text-xs text-slate-500">{t('settings.exportHint')}</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" onClick={exportJson}><Download size={16} /> JSON</Button><Button variant="secondary" onClick={exportCsv}><Download size={16} /> CSV</Button></div></div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="font-bold text-slate-900 dark:text-white">{t('settings.security')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('settings.securityHint')}</p>
          <div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" onClick={lock}><LockKeyhole size={17} /> {t('settings.lockVault')}</Button><Button variant="danger" onClick={() => void confirmSwitchAccount()}>{t('settings.switchAccount')}</Button></div>
          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500 dark:bg-slate-950">{t('settings.securityQuestionsHint')}</div>
          <div className="mt-3 rounded-xl bg-rose-50 p-3 text-xs leading-5 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{t('settings.switchAccountHint')}</div>
        </Card>
      </div>

      <Card className="p-4 sm:p-5">
        <div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900 dark:text-white">{t('settings.accounts')}</h2><p className="text-xs text-slate-500">{t('settings.accountsHint')}</p></div><Badge>{accounts.length}</Badge></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{accountBalances.map(({ account, balance }) => <div key={account.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><div className="font-bold text-slate-800 dark:text-slate-100">{accountDisplayName(account, t)}</div><div className="mt-1 text-sm text-slate-500">{formatMoney(balance, account.currency, locale)}</div></div>)}</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]"><Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder={t('settings.accountPlaceholder')} /><Input type="number" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} placeholder={t('settings.openingBalance')} /><Button onClick={addAccount}><Plus size={17} /> {t('common.add')}</Button></div>
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900 dark:text-white">{t('settings.categories')}</h2><p className="text-xs text-slate-500">{t('settings.categoriesHint')}</p></div><Badge>{categories.length}</Badge></div>
        <div className="mt-4 flex flex-wrap gap-2">{categories.map((category) => <Badge key={category.id} tone={category.kind === 'income' ? 'green' : category.kind === 'expense' ? 'red' : 'slate'}>{categoryDisplayName(category, t)}</Badge>)}</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]"><Input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder={t('settings.categoryPlaceholder')} /><Select value={categoryKind} onChange={(e) => setCategoryKind(e.target.value as Category['kind'])}><option value="expense">{t('settings.kindExpense')}</option><option value="income">{t('settings.kindIncome')}</option><option value="both">{t('settings.kindBoth')}</option></Select><Button onClick={addCategory}><Plus size={17} /> {t('common.add')}</Button></div>
      </Card>

      <Card className="p-4 text-xs text-slate-500 sm:p-5">
        <div className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200"><ExternalLink size={15} /> {t('settings.deploymentNote')}</div>
        <p className="mt-2">{t('settings.deploymentText')}</p>
        <div className="mt-3 flex flex-wrap gap-3"><a className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400" href="./privacy.html" target="_blank" rel="noreferrer">{t('settings.privacy')}</a><a className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400" href="./terms.html" target="_blank" rel="noreferrer">{t('settings.terms')}</a></div>
      </Card>
    </div>
  )
}
