import { useEffect, useMemo, useState } from 'react'
import { Cloud, ExternalLink, FolderOpen, LockKeyhole, Plus, RefreshCw, Unplug } from 'lucide-react'
import { useWallet } from '../WalletContext'
import { accountDisplayName, categoryDisplayName, useI18n, type Language } from '../i18n'
import { bytesToHuman, formatMoney } from '../lib/format'
import { accountBalance } from '../lib/finance'
import { findExistingDriveLayout, openDriveFolderUrl } from '../lib/drive'
import type { Account, AppSettings, Category, ThemeMode } from '../types'
import { Badge, Button, Card, Input, Label, Select } from './ui'

export function Settings() {
  const {
    settings,
    accounts,
    categories,
    transactions,
    repository,
    saveEntity,
    googleSession,
    googleConfigured,
    connectGoogle,
    disconnectGoogle,
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

  useEffect(() => { void repository?.storageStats().then(setStorage) }, [repository, transactions])
  useEffect(() => {
    if (!googleSession) { setDriveFolder(undefined); return }
    void findExistingDriveLayout(googleSession.accessToken).then((layout) => setDriveFolder(layout?.rootId)).catch(() => setDriveFolder(undefined))
  }, [googleSession, lastSync])

  const accountBalances = useMemo(() => accounts.map((account) => ({ account, balance: accountBalance(account, transactions) })), [accounts, transactions])

  async function updateSettings(patch: Partial<AppSettings>) {
    if (!settings) return
    await saveEntity({ ...settings, ...patch, updatedAt: new Date().toISOString() })
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

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-black tracking-tight text-slate-950 dark:text-white">{t('settings.title')}</h1><p className="mt-1 text-sm text-slate-500">{t('settings.subtitle')}</p></div>

      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-bold text-slate-900 dark:text-white">{t('settings.driveSync')}</h2><p className="mt-1 max-w-2xl text-sm text-slate-500">{t('settings.driveHint')}</p></div>
          {googleSession ? <Badge tone="green">{t('common.connected')}</Badge> : <Badge>{t('common.disconnected')}</Badge>}
        </div>
        {!googleConfigured && <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{t('settings.clientMissing')}</div>}
        {googleSession ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {googleSession.user.picture && <img src={googleSession.user.picture} className="h-10 w-10 rounded-full" alt="Google profile" />}
            <div className="mr-auto"><div className="text-sm font-bold text-slate-800 dark:text-slate-100">{googleSession.user.name}</div><div className="text-xs text-slate-500">{googleSession.user.email}</div></div>
            <Button variant="secondary" onClick={() => void syncNow()} disabled={syncBusy}><RefreshCw className={syncBusy ? 'animate-spin' : ''} size={17} /> {syncBusy ? syncMessage || 'Sync…' : t('settings.syncNow')}</Button>
            {driveFolder && <Button variant="secondary" onClick={() => window.open(openDriveFolderUrl(driveFolder), '_blank', 'noopener,noreferrer')}><FolderOpen size={17} /> {t('settings.openDrive')}</Button>}
            <Button variant="ghost" onClick={disconnectGoogle}><Unplug size={17} /> {t('settings.disconnect')}</Button>
          </div>
        ) : (
          <Button className="mt-4" onClick={() => void connectGoogle()} disabled={!googleConfigured}><Cloud size={17} /> {t('settings.connectGoogle')}</Button>
        )}
        {lastSync && <div className="mt-3 text-xs text-slate-500">{t('settings.lastSync', { pulledRecords: lastSync.pulledRecords, pulledImages: lastSync.pulledImages, pushedRecords: lastSync.pushedRecords, pushedImages: lastSync.pushedImages, conflicts: lastSync.conflictsResolved })}</div>}
        {error && <div className="mt-3 text-sm text-rose-600">{error}</div>}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <h2 className="font-bold text-slate-900 dark:text-white">{t('settings.localStorage')}</h2>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><div className="text-xs text-slate-500">{t('settings.records')}</div><div className="mt-1 font-black text-slate-900 dark:text-white">{storage.recordCount}</div></div>
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><div className="text-xs text-slate-500">{t('settings.images')}</div><div className="mt-1 font-black text-slate-900 dark:text-white">{storage.imageCount}</div></div>
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><div className="text-xs text-slate-500">{t('settings.encryptedImageBytes')}</div><div className="mt-1 font-black text-slate-900 dark:text-white">{bytesToHuman(storage.imageBytes)}</div></div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div><Label>{t('common.language')}</Label><Select value={language} onChange={(e) => setLanguage(e.target.value as Language)}><option value="vi">{t('language.vi')}</option><option value="en">{t('language.en')}</option></Select></div>
            <div><Label>{t('settings.theme')}</Label><Select value={settings?.theme ?? 'system'} onChange={(e) => void updateSettings({ theme: e.target.value as ThemeMode })}><option value="system">{t('common.system')}</option><option value="light">{t('common.light')}</option><option value="dark">{t('common.dark')}</option></Select></div>
            <div><Label>{t('settings.autoSync')}</Label><Select value={settings?.autoSync ? 'on' : 'off'} onChange={(e) => void updateSettings({ autoSync: e.target.value === 'on' })}><option value="on">{t('common.on')}</option><option value="off">{t('common.off')}</option></Select></div>
            <div><Label>{t('settings.imageRetention')}</Label><Select value={settings?.imageRetention.mode ?? 'forever'} onChange={(e) => void updateSettings({ imageRetention: { mode: e.target.value as 'forever' | 'days', days: settings?.imageRetention.days ?? 90 } })}><option value="forever">{t('common.forever')}</option><option value="days">{t('common.days', { count: settings?.imageRetention.days ?? 90 })}</option></Select></div>
            {settings?.imageRetention.mode === 'days' && <div><Label>{t('settings.keepDays')}</Label><Input type="number" min="1" value={settings.imageRetention.days} onChange={(e) => void updateSettings({ imageRetention: { mode: 'days', days: Math.max(1, Number(e.target.value) || 1) } })} /></div>}
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="font-bold text-slate-900 dark:text-white">{t('settings.security')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('settings.securityHint')}</p>
          <Button variant="secondary" className="mt-4" onClick={lock}><LockKeyhole size={17} /> {t('settings.lockVault')}</Button>
          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500 dark:bg-slate-950">{t('settings.securityQuestionsHint')}</div>
        </Card>
      </div>

      <Card className="p-4 sm:p-5">
        <div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900 dark:text-white">{t('settings.accounts')}</h2><p className="text-xs text-slate-500">{t('settings.accountsHint')}</p></div><Badge>{accounts.length}</Badge></div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {accountBalances.map(({ account, balance }) => <div key={account.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><div className="font-bold text-slate-800 dark:text-slate-100">{accountDisplayName(account, t)}</div><div className="mt-1 text-sm text-slate-500">{formatMoney(balance, account.currency, locale)}</div></div>)}
        </div>
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
        <div className="mt-3 flex flex-wrap gap-3">
          <a className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400" href="./privacy.html" target="_blank" rel="noreferrer">{t('settings.privacy')}</a>
          <a className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400" href="./terms.html" target="_blank" rel="noreferrer">{t('settings.terms')}</a>
        </div>
      </Card>
    </div>
  )
}
