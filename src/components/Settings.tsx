import { useEffect, useMemo, useState } from 'react'
import { Cloud, ExternalLink, FolderOpen, LockKeyhole, Plus, RefreshCw, Unplug } from 'lucide-react'
import { useWallet } from '../WalletContext'
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
      <div><h1 className="text-2xl font-black tracking-tight text-slate-950 dark:text-white">Settings</h1><p className="mt-1 text-sm text-slate-500">Không có backend app riêng; Google token chỉ giữ trong memory của tab.</p></div>

      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-bold text-slate-900 dark:text-white">Google Drive sync</h2><p className="mt-1 max-w-2xl text-sm text-slate-500">O-Wallet tạo folder nhìn thấy được trong My Drive. File transaction và ảnh trong folder là ciphertext nhị phân.</p></div>
          {googleSession ? <Badge tone="green">Connected</Badge> : <Badge>Disconnected</Badge>}
        </div>
        {!googleConfigured && <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">Chưa có VITE_GOOGLE_CLIENT_ID. Xem .env.example.</div>}
        {googleSession ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {googleSession.user.picture && <img src={googleSession.user.picture} className="h-10 w-10 rounded-full" alt="Google profile" />}
            <div className="mr-auto"><div className="text-sm font-bold text-slate-800 dark:text-slate-100">{googleSession.user.name}</div><div className="text-xs text-slate-500">{googleSession.user.email}</div></div>
            <Button variant="secondary" onClick={() => void syncNow()} disabled={syncBusy}><RefreshCw className={syncBusy ? 'animate-spin' : ''} size={17} /> {syncBusy ? syncMessage || 'Sync…' : 'Sync now'}</Button>
            {driveFolder && <Button variant="secondary" onClick={() => window.open(openDriveFolderUrl(driveFolder), '_blank', 'noopener,noreferrer')}><FolderOpen size={17} /> Open Drive</Button>}
            <Button variant="ghost" onClick={disconnectGoogle}><Unplug size={17} /> Disconnect</Button>
          </div>
        ) : (
          <Button className="mt-4" onClick={() => void connectGoogle()} disabled={!googleConfigured}><Cloud size={17} /> Connect Google</Button>
        )}
        {lastSync && <div className="mt-3 text-xs text-slate-500">Lần sync cuối: pull {lastSync.pulledRecords} records / {lastSync.pulledImages} images, push {lastSync.pushedRecords} records / {lastSync.pushedImages} images, conflict {lastSync.conflictsResolved}.</div>}
        {error && <div className="mt-3 text-sm text-rose-600">{error}</div>}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <h2 className="font-bold text-slate-900 dark:text-white">Local encrypted storage</h2>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><div className="text-xs text-slate-500">Records</div><div className="mt-1 font-black text-slate-900 dark:text-white">{storage.recordCount}</div></div>
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><div className="text-xs text-slate-500">Images</div><div className="mt-1 font-black text-slate-900 dark:text-white">{storage.imageCount}</div></div>
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><div className="text-xs text-slate-500">Encrypted image bytes</div><div className="mt-1 font-black text-slate-900 dark:text-white">{bytesToHuman(storage.imageBytes)}</div></div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div><Label>Theme</Label><Select value={settings?.theme ?? 'system'} onChange={(e) => void updateSettings({ theme: e.target.value as ThemeMode })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></Select></div>
            <div><Label>Auto sync</Label><Select value={settings?.autoSync ? 'on' : 'off'} onChange={(e) => void updateSettings({ autoSync: e.target.value === 'on' })}><option value="on">On</option><option value="off">Off</option></Select></div>
            <div><Label>Image retention</Label><Select value={settings?.imageRetention.mode ?? 'forever'} onChange={(e) => void updateSettings({ imageRetention: { mode: e.target.value as 'forever' | 'days', days: settings?.imageRetention.days ?? 90 } })}><option value="forever">Forever</option><option value="days">X ngày</option></Select></div>
            {settings?.imageRetention.mode === 'days' && <div><Label>Số ngày giữ ảnh</Label><Input type="number" min="1" value={settings.imageRetention.days} onChange={(e) => void updateSettings({ imageRetention: { mode: 'days', days: Math.max(1, Number(e.target.value) || 1) } })} /></div>}
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="font-bold text-slate-900 dark:text-white">Security</h2>
          <p className="mt-1 text-sm text-slate-500">Lock xóa DEK khỏi React state. Ciphertext vẫn còn trong IndexedDB để mở lại nhanh.</p>
          <Button variant="secondary" className="mt-4" onClick={lock}><LockKeyhole size={17} /> Lock vault</Button>
          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500 dark:bg-slate-950">Security questions không tự decrypt data. Recovery key mới là secret dùng để unwrap DEK; câu hỏi chỉ là UX gate phụ.</div>
        </Card>
      </div>

      <Card className="p-4 sm:p-5">
        <div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900 dark:text-white">Accounts</h2><p className="text-xs text-slate-500">Multiple account + transfer.</p></div><Badge>{accounts.length}</Badge></div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {accountBalances.map(({ account, balance }) => <div key={account.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><div className="font-bold text-slate-800 dark:text-slate-100">{account.name}</div><div className="mt-1 text-sm text-slate-500">{formatMoney(balance, account.currency)}</div></div>)}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]"><Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Tên account, ví dụ MBBank" /><Input type="number" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} placeholder="Opening balance" /><Button onClick={addAccount}><Plus size={17} /> Add</Button></div>
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900 dark:text-white">Categories</h2><p className="text-xs text-slate-500">User-defined; default chỉ là seed.</p></div><Badge>{categories.length}</Badge></div>
        <div className="mt-4 flex flex-wrap gap-2">{categories.map((category) => <Badge key={category.id} tone={category.kind === 'income' ? 'green' : category.kind === 'expense' ? 'red' : 'slate'}>{category.name}</Badge>)}</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]"><Input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="Tên category" /><Select value={categoryKind} onChange={(e) => setCategoryKind(e.target.value as Category['kind'])}><option value="expense">Expense</option><option value="income">Income</option><option value="both">Both</option></Select><Button onClick={addCategory}><Plus size={17} /> Add</Button></div>
      </Card>

      <Card className="p-4 text-xs text-slate-500 sm:p-5">
        <div className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200"><ExternalLink size={15} /> Deployment note</div>
        <p className="mt-2">GitHub Pages chỉ host static assets. Node/Vite/Tailwind chỉ dùng ở build time; production không chạy Node server.</p>
      </Card>
    </div>
  )
}
