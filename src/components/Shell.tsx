import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { BarChart3, ExternalLink, Home, LockKeyhole, Plus, ReceiptText, RefreshCw, Settings as SettingsIcon, Wallet } from 'lucide-react'
import { useWallet } from '../WalletContext'
import { useI18n } from '../i18n'
import { Analytics } from './Analytics'
import { Dashboard } from './Dashboard'
import { Settings } from './Settings'
import { Transactions } from './Transactions'
import { Button } from './ui'

const TransactionModal = lazy(() => import('./TransactionModal').then((module) => ({ default: module.TransactionModal })))

type Page = 'home' | 'transactions' | 'analytics' | 'settings'

function Main({ page }: { page: Page }) {
  if (page === 'transactions') return <Transactions />
  if (page === 'analytics') return <Analytics />
  if (page === 'settings') return <Settings />
  return <Dashboard />
}

export function Shell() {
  const { googleSession, googleRememberedUser, googleConnectionState, syncBusy, syncMessage, syncNow, retryGoogleConnection, lock } = useWallet()
  const { t } = useI18n()
  const [page, setPage] = useState<Page>('home')
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    const preload = () => { void import('./TransactionModal') }
    const id = window.setTimeout(preload, 900)
    return () => window.clearTimeout(id)
  }, [])

  const nav: Array<{ id: Page; label: string; icon: typeof Home }> = [
    { id: 'home', label: t('nav.home'), icon: Home },
    { id: 'transactions', label: t('nav.transactions'), icon: ReceiptText },
    { id: 'analytics', label: t('nav.analytics'), icon: BarChart3 },
    { id: 'settings', label: t('nav.settings'), icon: SettingsIcon },
  ]

  return (
    <div className="min-h-[100dvh] bg-transparent text-slate-900 dark:text-slate-100">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-20 border-r border-slate-200/80 bg-white/90 p-3 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90 md:flex md:flex-col xl:w-64 xl:p-4">
        <div className="flex items-center justify-center gap-3 py-2 xl:justify-start xl:px-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white"><Wallet size={21} /></div>
          <div className="hidden xl:block"><div className="font-black tracking-tight">O-Wallet</div><div className="text-xs text-slate-500">{t('app.shortTagline')}</div></div>
        </div>
        <nav className="mt-8 space-y-1">
          {nav.map((item) => (
            <button key={item.id} title={item.label} onClick={() => setPage(item.id)} className={`flex w-full items-center justify-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition xl:justify-start ${page === item.id ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'}`}>
              <item.icon size={18} /> <span className="hidden xl:inline">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-2">
          <Button className="w-full px-0 xl:px-4" title={t('nav.addTransaction')} onClick={() => setShowAdd(true)}><Plus size={17} /><span className="hidden xl:inline">{t('nav.addTransaction')}</span></Button>
          <Button variant="ghost" className="w-full justify-center px-0 xl:justify-start xl:px-4" title={t('nav.lock')} onClick={lock}><LockKeyhole size={17} /><span className="hidden xl:inline">{t('nav.lock')}</span></Button>
        </div>
      </aside>

      <div className="md:pl-20 xl:pl-64">
        <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-[#f5f7fb]/88 px-4 py-3 backdrop-blur-xl dark:border-slate-800 dark:bg-[#0b0d12]/88 sm:px-6">
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3">
            <div className="flex items-center gap-2 md:hidden"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white"><Wallet size={19} /></div><span className="font-black">O-Wallet</span></div>
            <div className="hidden min-w-0 truncate text-xs text-slate-500 md:block">
              {googleConnectionState === 'connected' && googleSession && t('nav.driveConnected', { email: googleSession.user.email })}
              {googleConnectionState === 'reconnecting' && t('nav.driveReconnecting')}
              {googleConnectionState === 'attention' && t('nav.driveReconnectNeeded')}
              {googleConnectionState === 'disconnected' && t('nav.driveDisconnected')}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {googleConnectionState === 'connected' && googleSession && <Button variant="secondary" className="px-3" onClick={() => void syncNow()} disabled={syncBusy}><RefreshCw size={16} className={syncBusy ? 'animate-spin' : ''} /><span className="hidden sm:inline">{syncBusy ? syncMessage || t('common.syncing') : t('nav.sync')}</span></Button>}
              {googleConnectionState === 'reconnecting' && googleRememberedUser && <Button variant="secondary" className="px-3" disabled><RefreshCw size={16} className="animate-spin" /><span className="hidden sm:inline">{t('common.reconnecting')}</span></Button>}
              {googleConnectionState === 'attention' && googleRememberedUser && <Button variant="secondary" className="px-3" onClick={() => void retryGoogleConnection()}><RefreshCw size={16} /><span className="hidden sm:inline">{t('settings.reconnectGoogle')}</span></Button>}
              <Button className="hidden sm:inline-flex md:hidden" onClick={() => setShowAdd(true)}><Plus size={16} /> {t('common.add')}</Button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-3 pb-8 pt-4 sm:px-5 sm:pt-5 lg:px-6"><Main page={page} /></main>
        <footer className="mx-auto max-w-[1500px] px-3 pb-28 sm:px-5 md:pb-8 lg:px-6">
          <div className="flex items-center justify-center border-t border-slate-200/70 pt-5 text-xs text-slate-500 dark:border-slate-800">
            <a href="https://oppai1442.github.io/all/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-900 dark:hover:text-slate-200">
              <span className="font-semibold">{t('footer.projectHub')}</span>
              <span>·</span>
              <span>{t('footer.moreProjects')}</span>
              <ExternalLink size={13} />
            </a>
          </div>
        </footer>
      </div>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-2 pt-2 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95 md:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5 gap-1">
          {nav.slice(0, 2).map((item) => <MobileNav key={item.id} active={page === item.id} icon={<item.icon size={19} />} label={item.label} onClick={() => setPage(item.id)} />)}
          <button aria-label={t('nav.addTransaction')} onClick={() => setShowAdd(true)} className="mx-auto -mt-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"><Plus size={25} /></button>
          {nav.slice(2).map((item) => <MobileNav key={item.id} active={page === item.id} icon={<item.icon size={19} />} label={item.label} onClick={() => setPage(item.id)} />)}
        </div>
      </nav>

      <Suspense fallback={null}>{showAdd && <TransactionModal onClose={() => setShowAdd(false)} />}</Suspense>
    </div>
  )
}

function MobileNav({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button onClick={onClick} className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[10px] font-semibold ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'}`}>{icon}<span className="max-w-full truncate">{label}</span></button>
}
