import { useEffect, useState, type ReactNode } from 'react'
import {
  Cloud,
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  LockKeyhole,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unplug,
  WalletCards,
} from 'lucide-react'
import { useWallet } from '../WalletContext'
import { accountDisplayName, useI18n, type Language } from '../i18n'
import { categoryPath, selectableCategories } from '../lib/categories'
import { bytesToHuman, formatMoney } from '../lib/format'
import { findExistingDriveLayout, openDriveFolderUrl } from '../lib/drive'
import { openTrustedExternalUrl, safeGoogleProfileImageUrl } from '../lib/security'
import type { AppSettings, BudgetConfig, RememberDuration, ThemeMode, VaultRememberDuration } from '../types'
import { ExternalImport } from './ExternalImport'
import { AccountManager } from './AccountManager'
import { AiSettings } from './AiSettings'
import { VoiceSettings } from './VoiceSettings'
import { CategoryManager } from './CategoryManager'
import { RuleManager } from './RuleManager'
import { CategoryPicker } from './CategoryPicker'
import { AccountSelect } from './AccountSelect'
import { QuickUnlockSettings } from './QuickUnlockSettings'
import { Badge, Button, Card, Input, Label, Select } from './ui'

type SettingsSection = 'general' | 'wallet' | 'input' | 'sync' | 'data'
type WalletSection = 'defaults' | 'accounts' | 'categories' | 'budgets' | 'rules'
type InputSection = 'voice' | 'ocr' | 'ai' | 'import'

const COPY = {
  vi: {
    general: 'Chung', generalHint: 'Giao diện và hành vi ứng dụng',
    wallet: 'Ví cá nhân', walletHint: 'Mặc định, tài khoản và danh mục',
    input: 'Nhập liệu & AI', inputHint: 'Voice, OCR, AI và import',
    sync: 'Sync & bảo mật', syncHint: 'Google Drive, Quick Unlock và khóa ví',
    data: 'Dữ liệu & ứng dụng', dataHint: 'Storage, export và thông tin app',
    defaults: 'Mặc định', accounts: 'Tài khoản', categories: 'Danh mục', budgets: 'Ngân sách', rules: 'Rules',
    voice: 'Giọng nói', ocr: 'OCR', ai: 'AI', import: 'Import',
    generalTitle: 'Thiết lập chung', generalText: 'Những tùy chọn ảnh hưởng tới giao diện và cách O-Wallet hoạt động trên thiết bị này.',
    walletTitle: 'Thiết lập ví cá nhân', walletText: 'Quản lý dữ liệu tài chính cốt lõi của Personal Wallet mà không trộn với thiết lập trình duyệt.',
    inputTitle: 'Nhập liệu & tự động hóa', inputText: 'Cấu hình các cách đưa dữ liệu vào ví. Mỗi công cụ được tách thành một khu riêng.',
    syncTitle: 'Sync & bảo mật', syncText: 'Google Drive, Quick Unlock, hành vi ghi nhớ phiên và các thao tác khóa/chuyển tài khoản.',
    dataTitle: 'Dữ liệu & ứng dụng', dataText: 'Kiểm tra dung lượng local, xuất dữ liệu và thông tin triển khai.',
  },
  en: {
    general: 'General', generalHint: 'Appearance and app behavior',
    wallet: 'Personal wallet', walletHint: 'Defaults, accounts and categories',
    input: 'Input & AI', inputHint: 'Voice, OCR, AI and import',
    sync: 'Sync & security', syncHint: 'Google Drive, Quick Unlock and locking',
    data: 'Data & app', dataHint: 'Storage, export and app info',
    defaults: 'Defaults', accounts: 'Accounts', categories: 'Categories', budgets: 'Budgets', rules: 'Rules',
    voice: 'Voice', ocr: 'OCR', ai: 'AI', import: 'Import',
    generalTitle: 'General settings', generalText: 'Options that affect appearance and how O-Wallet behaves on this device.',
    walletTitle: 'Personal wallet settings', walletText: 'Manage core Personal Wallet data without mixing it with browser and device settings.',
    inputTitle: 'Input & automation', inputText: 'Configure the ways data enters your wallet. Each tool lives in its own focused area.',
    syncTitle: 'Sync & security', syncText: 'Google Drive, Quick Unlock, session remember behavior, locking and account switching.',
    dataTitle: 'Data & app', dataText: 'Inspect local storage, export your data and view deployment information.',
  },
} as const

function downloadText(filename: string, text: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function csvCell(value: unknown) {
  const text = value === undefined || value === null ? '' : String(value)
  const safe = /^[=+@-]/.test(text.trimStart()) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

export function Settings() {
  const wallet = useWallet()
  const {
    settings, accounts, categories, transactions, repository, saveEntity, saveEntities,
    googleSession, googleBinding, googleRememberedUser, googleConnectionState, googleConfigured,
    devicePreferences, updateDevicePreferences, connectGoogle, retryGoogleConnection, disconnectGoogle,
    switchLocalAccount, syncNow, syncBusy, syncMessage, lastSync, lock, error,
  } = wallet
  const { t, locale, language, setLanguage } = useI18n()
  const L = COPY[language]
  const [section, setSection] = useState<SettingsSection>('general')
  const [walletSection, setWalletSection] = useState<WalletSection>('defaults')
  const [inputSection, setInputSection] = useState<InputSection>('voice')
  const [storage, setStorage] = useState({ recordCount: 0, imageCount: 0, imageBytes: 0 })
  const [driveFolder, setDriveFolder] = useState<string>()
  const [budgetCategoryId, setBudgetCategoryId] = useState('')
  const [budgetLimit, setBudgetLimit] = useState('')

  useEffect(() => { void repository?.storageStats().then(setStorage) }, [repository, transactions])
  useEffect(() => {
    if (!googleSession) { setDriveFolder(undefined); return }
    void findExistingDriveLayout(googleSession.accessToken).then((layout) => setDriveFolder(layout?.rootId)).catch(() => setDriveFolder(undefined))
  }, [googleSession, lastSync])

  const expenseCategories = selectableCategories(categories, 'expense')
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

  async function addBudget() {
    if (!settings || !budgetCategoryId || Number(budgetLimit) <= 0) return
    const next: BudgetConfig = { id: crypto.randomUUID(), categoryId: budgetCategoryId, monthlyLimit: Number(budgetLimit) }
    await updateSettings({ budgets: [...budgets.filter((item) => item.categoryId !== budgetCategoryId), next] })
    setBudgetLimit('')
  }

  async function confirmSwitchAccount() {
    if (window.confirm(t('settings.switchAccountConfirm'))) await switchLocalAccount()
  }

  function exportJson() {
    downloadText(`o-wallet-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), version: 1, transactions, accounts, categories, settings }, null, 2))
  }

  function exportCsv() {
    const header = ['id', 'type', 'amount', 'currency', 'occurredAt', 'category', 'account', 'merchant', 'balanceAfter', 'description', 'note', 'tags', 'images']
    const categoryMap = new Map(categories.map((item) => [item.id, categoryPath(item, categories)]))
    const accountMap = new Map(accounts.map((item) => [item.id, accountDisplayName(item, t)]))
    const rows = transactions.map((tx) => [tx.id, tx.type, tx.amount, tx.currency, tx.occurredAt, categoryMap.get(tx.categoryId) ?? t('categories.uncategorized'), accountMap.get(tx.accountId) ?? tx.accountId, tx.merchant ?? '', tx.balanceAfter ?? '', tx.description ?? '', tx.note ?? '', (tx.tags ?? []).join('|'), tx.imageIds.length].map(csvCell).join(','))
    downloadText(`o-wallet-transactions-${new Date().toISOString().slice(0, 10)}.csv`, [header.map(csvCell).join(','), ...rows].join('\n'), 'text/csv')
  }

  const sections = [
    { id: 'general' as const, label: L.general, hint: L.generalHint, icon: Settings2 },
    { id: 'wallet' as const, label: L.wallet, hint: L.walletHint, icon: WalletCards },
    { id: 'input' as const, label: L.input, hint: L.inputHint, icon: Sparkles },
    { id: 'sync' as const, label: L.sync, hint: L.syncHint, icon: ShieldCheck },
    { id: 'data' as const, label: L.data, hint: L.dataHint, icon: Database },
  ]

  return <div className="space-y-5">
    <div><h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-white">{t('settings.title')}</h1><p className="mt-1 text-sm text-stone-500">{t('settings.subtitle')}</p></div>
    <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start"><div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">{sections.map((item) => <SectionButton key={item.id} active={section === item.id} label={item.label} hint={item.hint} icon={<item.icon size={18}/>} onClick={() => setSection(item.id)} />)}</div></aside>
      <div className="min-w-0">
        {section === 'general' && <div className="space-y-5"><SectionHeading title={L.generalTitle} text={L.generalText}/><Card className="p-4 sm:p-5"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><div><Label>{t('common.language')}</Label><Select value={language} onChange={(e) => void changeLanguage(e.target.value as Language)}><option value="vi">{t('language.vi')}</option><option value="en">{t('language.en')}</option></Select></div><div><Label>{t('settings.theme')}</Label><Select value={settings?.theme ?? 'system'} onChange={(e) => void updateSettings({ theme: e.target.value as ThemeMode })}><option value="system">{t('common.system')}</option><option value="light">{t('common.light')}</option><option value="dark">{t('common.dark')}</option></Select></div><div><Label>{t('settings.imageRetention')}</Label><Select value={settings?.imageRetention.mode ?? 'forever'} onChange={(e) => void updateSettings({ imageRetention: { mode: e.target.value as 'forever' | 'days', days: settings?.imageRetention.days ?? 90 } })}><option value="forever">{t('common.forever')}</option><option value="days">{t('common.days', { count: settings?.imageRetention.days ?? 90 })}</option></Select></div>{settings?.imageRetention.mode === 'days' && <div><Label>{t('settings.keepDays')}</Label><Input type="number" min="1" value={settings.imageRetention.days} onChange={(e) => void updateSettings({ imageRetention: { mode: 'days', days: Math.max(1, Number(e.target.value) || 1) } })}/></div>}</div></Card></div>}

        {section === 'wallet' && <div className="space-y-5"><SectionHeading title={L.walletTitle} text={L.walletText}/><SubNav value={walletSection} onChange={(value) => setWalletSection(value as WalletSection)} items={[[ 'defaults', L.defaults ], [ 'accounts', L.accounts ], [ 'categories', L.categories ], [ 'budgets', L.budgets ], [ 'rules', L.rules ]]}/>{walletSection === 'defaults' && <Card className="p-4 sm:p-5"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><div><Label>{t('settings.defaultCurrency')}</Label><Input value={settings?.defaultCurrency ?? 'VND'} onChange={(e) => void updateSettings({ defaultCurrency: e.target.value.toUpperCase() || 'VND' })}/></div><div><Label>{t('settings.defaultAccount')}</Label><AccountSelect accounts={accounts} catalogues={settings?.accountCatalogues ?? []} value={settings?.transactionDefaults?.accountId ?? ''} onChange={(value) => void updateSettings({ transactionDefaults: { ...settings?.transactionDefaults, accountId: value || undefined } })} includeEmpty/></div><div><Label>{t('settings.defaultCategory')}</Label><CategoryPicker categories={categories} value={settings?.transactionDefaults?.categoryId ?? ''} onChange={(value) => void updateSettings({ transactionDefaults: { ...settings?.transactionDefaults, categoryId: value || undefined } })} placeholder={t('common.none')}/></div></div></Card>}{walletSection === 'accounts' && <AccountManager accounts={accounts} transactions={transactions} settings={settings} onSaveAccount={async (account) => { await saveEntity(account) }} onSaveAccounts={async (items) => { await saveEntities(items) }} onSaveSettings={updateSettings}/>} {walletSection === 'categories' && <CategoryManager categories={categories} transactions={transactions} onSave={async (category) => { await saveEntity(category) }} onSaveMany={async (items) => { await saveEntities(items) }}/>} {walletSection === 'budgets' && <Card className="p-4 sm:p-5"><h2 className="font-bold">{t('settings.budgets')}</h2><p className="mt-1 text-sm text-stone-500">{t('settings.budgetsHint')}</p><div className="mt-4 space-y-2">{budgets.map((budget) => { const category = categories.find((item) => item.id === budget.categoryId); return <div key={budget.id} className="flex items-center gap-3 rounded-xl border border-stone-200 p-3 dark:border-stone-800"><div className="min-w-0 flex-1"><div className="truncate font-bold">{category ? categoryPath(category, categories) : budget.categoryId}</div><div className="text-xs text-stone-500">{formatMoney(budget.monthlyLimit, settings?.defaultCurrency ?? 'VND', locale)} / {t('settings.month')}</div></div><Button variant="ghost" className="px-2 text-rose-500" onClick={() => void updateSettings({ budgets: budgets.filter((item) => item.id !== budget.id) })}><Trash2 size={16}/></Button></div> })}</div><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]"><Select value={budgetCategoryId} onChange={(e) => setBudgetCategoryId(e.target.value)}><option value="">{t('settings.chooseCategory')}</option>{expenseCategories.map((category) => <option key={category.id} value={category.id}>{categoryPath(category, categories)}</option>)}</Select><Input type="number" min="1" value={budgetLimit} onChange={(e) => setBudgetLimit(e.target.value)} placeholder={t('settings.budgetLimit')}/><Button onClick={() => void addBudget()}><Plus size={17}/>{t('common.add')}</Button></div></Card>} {walletSection === 'rules' && <RuleManager settings={settings} categories={categories} accounts={accounts} onSaveSettings={updateSettings}/>}</div>}

        {section === 'input' && <div className="space-y-5"><SectionHeading title={L.inputTitle} text={L.inputText}/><SubNav value={inputSection} onChange={(value) => setInputSection(value as InputSection)} items={[[ 'voice', L.voice ], [ 'ocr', L.ocr ], [ 'ai', L.ai ], [ 'import', L.import ]]}/>{inputSection === 'voice' && <VoiceSettings settings={settings} onSaveSettings={updateSettings}/>} {inputSection === 'ocr' && <Card className="p-4 sm:p-5"><h2 className="font-bold">{t('settings.ocrTemplates')}</h2><p className="mt-1 text-sm text-stone-500">{t('settings.ocrTemplatesHint')}</p><div className="mt-4 space-y-2">{templates.length === 0 ? <div className="rounded-xl bg-stone-50 p-3 text-sm text-stone-500 dark:bg-stone-950">{t('settings.noOcrTemplates')}</div> : templates.map((template) => <div key={template.id} className="flex items-center gap-3 rounded-xl border border-stone-200 p-3 dark:border-stone-800"><div className="min-w-0 flex-1"><div className="truncate font-bold">{template.name}</div><div className="text-xs text-stone-500">{t('settings.regionCount', { count: template.regions.length })}</div></div><Button variant="ghost" className="px-2 text-rose-500" onClick={() => void updateSettings({ ocrTemplates: templates.filter((item) => item.id !== template.id) })}><Trash2 size={16}/></Button></div>)}</div></Card>} {inputSection === 'ai' && <AiSettings settings={settings} repository={repository} onSaveSettings={updateSettings}/>} {inputSection === 'import' && <ExternalImport/>}</div>}

        {section === 'sync' && <div className="space-y-5"><SectionHeading title={L.syncTitle} text={L.syncText}/><DriveCard/><QuickUnlockSettings/><Card className="p-4 sm:p-5"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><div><Label>{t('settings.autoSync')}</Label><Select value={settings?.autoSync ? 'on' : 'off'} onChange={(e) => void updateSettings({ autoSync: e.target.value === 'on' })}><option value="on">{t('common.on')}</option><option value="off">{t('common.off')}</option></Select></div><div><Label>{t('settings.googleRemember')}</Label><RememberSelect value={devicePreferences.googleRemember} onChange={(value) => void changeRemember('google', value as RememberDuration)} google/></div><div><Label>{t('settings.vaultRemember')}</Label><RememberSelect value={devicePreferences.vaultRemember} onChange={(value) => void changeRemember('vault', value as VaultRememberDuration)}/></div></div></Card><Card className="p-4 sm:p-5"><h2 className="font-bold">{t('settings.security')}</h2><p className="mt-1 text-sm text-stone-500">{t('settings.securityHint')}</p><div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" onClick={lock}><LockKeyhole size={17}/>{t('settings.lockVault')}</Button><Button variant="danger" onClick={() => void confirmSwitchAccount()}>{t('settings.switchAccount')}</Button></div><div className="mt-4 rounded-xl bg-stone-50 p-3 text-xs leading-5 text-stone-500 dark:bg-stone-950">{t('settings.securityQuestionsHint')}</div><div className="mt-3 rounded-xl bg-rose-50 p-3 text-xs leading-5 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{t('settings.switchAccountHint')}</div></Card></div>}

        {section === 'data' && <div className="space-y-5"><SectionHeading title={L.dataTitle} text={L.dataText}/><Card className="p-4 sm:p-5"><h2 className="font-bold">{t('settings.localStorage')}</h2><div className="mt-4 grid grid-cols-3 gap-3"><Metric label={t('settings.records')} value={String(storage.recordCount)}/><Metric label={t('settings.images')} value={String(storage.imageCount)}/><Metric label={t('settings.encryptedImageBytes')} value={bytesToHuman(storage.imageBytes)}/></div><div className="mt-4"><h3 className="text-sm font-bold">{t('settings.export')}</h3><p className="mt-1 text-xs text-stone-500">{t('settings.exportHint')}</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" onClick={exportJson}><Download size={16}/>JSON</Button><Button variant="secondary" onClick={exportCsv}><Download size={16}/>CSV</Button></div></div></Card><Card className="p-4 text-xs text-stone-500 sm:p-5"><div className="flex items-center gap-2 font-bold text-stone-700 dark:text-stone-200"><ExternalLink size={15}/>{t('settings.deploymentNote')}</div><p className="mt-2">{t('settings.deploymentText')}</p><div className="mt-3 flex flex-wrap gap-3"><a className="font-semibold text-blue-600 hover:underline dark:text-blue-400" href="./privacy.html" target="_blank" rel="noreferrer">{t('settings.privacy')}</a><a className="font-semibold text-blue-600 hover:underline dark:text-blue-400" href="./terms.html" target="_blank" rel="noreferrer">{t('settings.terms')}</a></div></Card></div>}
      </div>
    </div>
  </div>

  function DriveCard() {
    return <Card className="p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">{t('settings.driveSync')}</h2><p className="mt-1 max-w-2xl text-sm text-stone-500">{t('settings.driveHint')}</p></div>{googleConnectionState === 'connected' && <Badge tone="green">{t('common.connected')}</Badge>}{googleConnectionState === 'reconnecting' && <Badge tone="amber">{t('common.reconnecting')}</Badge>}{googleConnectionState === 'attention' && <Badge tone="red">{t('common.actionRequired')}</Badge>}{googleConnectionState === 'disconnected' && <Badge>{t('common.disconnected')}</Badge>}</div>{!googleConfigured && <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{t('settings.clientMissing')}</div>}{googleSession ? <div className="mt-4 flex flex-wrap items-center gap-3">{safeGoogleProfileImageUrl(googleSession.user.picture) && <img src={safeGoogleProfileImageUrl(googleSession.user.picture)} className="h-10 w-10 rounded-full" alt={t('settings.googleProfileAlt')}/>}<div className="mr-auto min-w-0"><div className="truncate text-sm font-bold">{googleSession.user.name}</div><div className="truncate text-xs text-stone-500">{googleSession.user.email}</div></div><Button variant="secondary" onClick={() => void syncNow()} disabled={syncBusy}><RefreshCw className={syncBusy ? 'animate-spin' : ''} size={17}/>{syncBusy ? syncMessage || t('common.syncing') : t('settings.syncNow')}</Button>{driveFolder && <Button variant="secondary" onClick={() => openTrustedExternalUrl(openDriveFolderUrl(driveFolder))}><FolderOpen size={17}/>{t('settings.openDrive')}</Button>}<Button variant="ghost" onClick={disconnectGoogle}><Unplug size={17}/>{t('settings.disconnect')}</Button></div> : (googleRememberedUser || googleBinding) ? <div className="mt-4 rounded-xl border border-stone-200/80 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-950/40"><div className="flex flex-wrap items-center gap-3"><div className="mr-auto min-w-0"><div className="truncate text-sm font-bold">{googleRememberedUser?.name ?? googleBinding?.name}</div><div className="truncate text-xs text-stone-500">{googleRememberedUser?.email ?? googleBinding?.email}</div></div><Button variant="secondary" onClick={() => void retryGoogleConnection()} disabled={!googleConfigured || googleConnectionState === 'reconnecting'}><RefreshCw className={googleConnectionState === 'reconnecting' ? 'animate-spin' : ''} size={17}/>{t('settings.reconnectGoogle')}</Button></div></div> : <div className="mt-4"><Button onClick={() => void connectGoogle()} disabled={!googleConfigured}><Cloud size={17}/>{t('settings.connectGoogle')}</Button></div>}{lastSync && <div className="mt-3 text-xs text-stone-500">{t('settings.lastSync', { pulledRecords: lastSync.pulledRecords, pulledImages: lastSync.pulledImages, pushedRecords: lastSync.pushedRecords, pushedImages: lastSync.pushedImages, conflicts: lastSync.conflictsResolved })}</div>}{error && <div className="mt-3 text-sm text-rose-600">{error}</div>}</Card>
  }

  function RememberSelect({ value, onChange, google = false }: { value: string; onChange: (value: string) => void; google?: boolean }) {
    return <Select value={value} onChange={(e) => onChange(e.target.value)}>{google && <option value="tab">{t('settings.googleRememberTab')}</option>}<option value="off">{google ? t('settings.googleRememberOff') : t('settings.vaultRememberOff')}</option>{!google && <option value="15m">{t('settings.duration15m')}</option>}<option value="1h">{t('settings.duration1h')}</option><option value="8h">{t('settings.duration8h')}</option><option value="1d">{t('settings.duration1d')}</option><option value="7d">{t('settings.duration7d')}</option><option value="30d">{t('settings.duration30d')}</option></Select>
  }
}

function SectionButton({ active, label, hint, icon, onClick }: { active: boolean; label: string; hint: string; icon: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex shrink-0 items-center gap-3 rounded-xl border px-3 py-3 text-left transition lg:w-full ${active ? 'border-stone-300 bg-white text-stone-950 shadow-sm dark:border-stone-700 dark:bg-stone-900 dark:text-white' : 'border-transparent text-stone-500 hover:bg-white/70 hover:text-stone-800 dark:hover:bg-stone-900/70 dark:hover:text-stone-200'}`}><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-stone-950 text-white dark:bg-white dark:text-stone-950' : 'bg-stone-100 text-stone-500 dark:bg-stone-900 dark:text-stone-400'}`}>{icon}</span><span className="min-w-0"><span className="block whitespace-nowrap text-sm font-semibold">{label}</span><span className="mt-0.5 hidden text-[11px] leading-4 text-stone-400 lg:block">{hint}</span></span></button>
}
function SectionHeading({ title, text }: { title: string; text: string }) { return <div><h2 className="text-lg font-semibold tracking-tight text-stone-950 dark:text-white">{title}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-stone-500">{text}</p></div> }
function SubNav({ value, onChange, items }: { value: string; onChange: (value: string) => void; items: Array<readonly [string, string]> }) { return <div className="flex gap-1 overflow-x-auto rounded-xl border border-stone-200 bg-white p-1 dark:border-stone-800 dark:bg-stone-950">{items.map(([id, label]) => <button key={id} type="button" onClick={() => onChange(id)} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold transition ${value === id ? 'bg-stone-950 text-white dark:bg-white dark:text-stone-950' : 'text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-900'}`}>{label}</button>)}</div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950"><div className="text-xs text-stone-500">{label}</div><div className="mt-1 font-semibold">{value}</div></div> }
