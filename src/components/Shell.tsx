import { useState, type ReactNode } from 'react'
import { BarChart3, Home, LockKeyhole, Plus, ReceiptText, RefreshCw, Settings as SettingsIcon, Wallet } from 'lucide-react'
import { useWallet } from '../WalletContext'
import { Analytics } from './Analytics'
import { Dashboard } from './Dashboard'
import { Settings } from './Settings'
import { Transactions } from './Transactions'
import { TransactionModal } from './TransactionModal'
import { Button } from './ui'

type Page = 'home' | 'transactions' | 'analytics' | 'settings'

const nav: Array<{ id: Page; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'transactions', label: 'Transactions', icon: ReceiptText },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]

function Main({ page }: { page: Page }) {
  if (page === 'transactions') return <Transactions />
  if (page === 'analytics') return <Analytics />
  if (page === 'settings') return <Settings />
  return <Dashboard />
}

export function Shell() {
  const { googleSession, syncBusy, syncMessage, syncNow, lock } = useWallet()
  const [page, setPage] = useState<Page>('home')
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div className="min-h-screen bg-transparent text-slate-900 dark:text-slate-100">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-slate-200/80 bg-white/90 p-4 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90 md:flex md:flex-col">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white"><Wallet size={21} /></div>
          <div><div className="font-black tracking-tight">O-Wallet</div><div className="text-xs text-slate-500">local-first</div></div>
        </div>
        <nav className="mt-8 space-y-1">
          {nav.map((item) => (
            <button key={item.id} onClick={() => setPage(item.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${page === item.id ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'}`}>
              <item.icon size={18} /> {item.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-2">
          <Button className="w-full" onClick={() => setShowAdd(true)}><Plus size={17} /> Add transaction</Button>
          <Button variant="ghost" className="w-full justify-start" onClick={lock}><LockKeyhole size={17} /> Lock</Button>
        </div>
      </aside>

      <div className="md:pl-64">
        <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-[#f5f7fb]/85 px-4 py-3 backdrop-blur-xl dark:border-slate-800 dark:bg-[#0b0d12]/85 sm:px-6">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <div className="flex items-center gap-2 md:hidden"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white"><Wallet size={19} /></div><span className="font-black">O-Wallet</span></div>
            <div className="hidden text-xs text-slate-500 md:block">{googleSession ? `Drive: ${googleSession.user.email}` : 'Drive chưa kết nối'}</div>
            <div className="ml-auto flex items-center gap-2">
              {googleSession && <Button variant="secondary" className="px-3" onClick={() => void syncNow()} disabled={syncBusy}><RefreshCw size={16} className={syncBusy ? 'animate-spin' : ''} /><span className="hidden sm:inline">{syncBusy ? syncMessage || 'Sync…' : 'Sync'}</span></Button>}
              <Button className="hidden sm:inline-flex md:hidden" onClick={() => setShowAdd(true)}><Plus size={16} /> Add</Button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 pb-28 pt-5 sm:px-6 md:pb-10 md:pt-6"><Main page={page} /></main>
      </div>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-2 pt-2 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95 md:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5 gap-1">
          {nav.slice(0, 2).map((item) => <MobileNav key={item.id} active={page === item.id} icon={<item.icon size={19} />} label={item.label} onClick={() => setPage(item.id)} />)}
          <button aria-label="Add transaction" onClick={() => setShowAdd(true)} className="mx-auto -mt-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"><Plus size={25} /></button>
          {nav.slice(2).map((item) => <MobileNav key={item.id} active={page === item.id} icon={<item.icon size={19} />} label={item.label} onClick={() => setPage(item.id)} />)}
        </div>
      </nav>

      {showAdd && <TransactionModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}

function MobileNav({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button onClick={onClick} className={`flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[10px] font-semibold ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'}`}>{icon}<span>{label}</span></button>
}
