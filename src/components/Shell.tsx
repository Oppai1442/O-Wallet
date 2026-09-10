import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { BarChart3, ChevronUp, ExternalLink, Home, LockKeyhole, Mic, Plus, ReceiptText, RefreshCw, Settings as SettingsIcon, Users, Wallet } from 'lucide-react'
import { useWallet } from '../WalletContext'
import { useI18n } from '../i18n'
import { Analytics } from './Analytics'
import { Dashboard } from './Dashboard'
import { Settings } from './Settings'
import { Transactions } from './Transactions'
import { SharedWalletProfiles } from './SharedWalletProfiles'
import { Button } from './ui'

const TransactionModal = lazy(() => import('./TransactionModal').then((module) => ({ default: module.TransactionModal })))

type Page = 'home' | 'transactions' | 'shared' | 'analytics' | 'settings'

const PAGE_PARAM = 'page'
const ACTION_PARAM = 'action'
const ADD_ACTION = 'add'
const VOICE_ACTION = 'voice'
const HOLD_FOR_VOICE_MS = 460
const validPages: Page[] = ['home', 'transactions', 'shared', 'analytics', 'settings']

function readPageFromUrl(): Page {
  const value = new URLSearchParams(window.location.search).get(PAGE_PARAM)
  return validPages.includes(value as Page) ? value as Page : 'home'
}

function readAddFromUrl() {
  const action = new URLSearchParams(window.location.search).get(ACTION_PARAM)
  return action === ADD_ACTION || action === VOICE_ACTION
}

function readVoiceFromUrl() {
  return new URLSearchParams(window.location.search).get(ACTION_PARAM) === VOICE_ACTION
}

function writeUrl({ page, add, voice, mode = 'push' }: { page: Page; add?: boolean; voice?: boolean; mode?: 'push' | 'replace' }) {
  const url = new URL(window.location.href)
  url.searchParams.set(PAGE_PARAM, page)
  if (voice) url.searchParams.set(ACTION_PARAM, VOICE_ACTION)
  else if (add) url.searchParams.set(ACTION_PARAM, ADD_ACTION)
  else url.searchParams.delete(ACTION_PARAM)
  const nextUrl = `${url.pathname}${url.search}${url.hash}`
  if (mode === 'replace') window.history.replaceState({}, '', nextUrl)
  else window.history.pushState({}, '', nextUrl)
}

function pageHref(page: Page) {
  const url = new URL(window.location.href)
  url.searchParams.set(PAGE_PARAM, page)
  url.searchParams.delete(ACTION_PARAM)
  return `${url.pathname}${url.search}${url.hash}`
}

function Main({ page }: { page: Page }) {
  if (page === 'transactions') return <Transactions />
  if (page === 'shared') return <SharedWalletProfiles />
  if (page === 'analytics') return <Analytics />
  if (page === 'settings') return <Settings />
  return <Dashboard />
}

export function Shell() {
  const { googleSession, googleRememberedUser, googleConnectionState, syncBusy, syncMessage, syncNow, retryGoogleConnection, lock } = useWallet()
  const { t, language } = useI18n()
  const [page, setPage] = useState<Page>(() => readPageFromUrl())
  const [showAdd, setShowAdd] = useState(() => readAddFromUrl())
  const [voiceOnOpen, setVoiceOnOpen] = useState(() => readVoiceFromUrl())
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [fabHolding, setFabHolding] = useState(false)
  const contentScrollRef = useRef<HTMLDivElement>(null)
  const mobileTouchStartY = useRef<number | null>(null)
  const fabHoldTimer = useRef<number | undefined>(undefined)
  const fabPointerActive = useRef(false)
  const sharedProfileActive = page === 'shared'
  const holdHint = language === 'vi' ? 'Giữ để nói' : 'Hold for voice'

  useEffect(() => {
    const current = new URLSearchParams(window.location.search).get(PAGE_PARAM)
    if (!validPages.includes(current as Page)) writeUrl({ page: readPageFromUrl(), add: readAddFromUrl(), mode: 'replace' })
    const onPopState = () => {
      setPage(readPageFromUrl())
      setShowAdd(readAddFromUrl())
      setVoiceOnOpen(readVoiceFromUrl())
      setMobileMenuOpen(false)
      contentScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => { void import('./TransactionModal') }, 900)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => () => {
    if (fabHoldTimer.current) window.clearTimeout(fabHoldTimer.current)
  }, [])

  const nav: Array<{ id: Page; label: string; icon: typeof Home }> = [
    { id: 'home', label: t('nav.home'), icon: Home },
    { id: 'transactions', label: t('nav.transactions'), icon: ReceiptText },
    { id: 'shared', label: t('nav.shared'), icon: Users },
    { id: 'analytics', label: t('nav.analytics'), icon: BarChart3 },
    { id: 'settings', label: t('nav.settings'), icon: SettingsIcon },
  ]

  function navigatePage(nextPage: Page) {
    if (nextPage === page && !showAdd) { setMobileMenuOpen(false); return }
    setPage(nextPage)
    setShowAdd(false)
    setVoiceOnOpen(false)
    setMobileMenuOpen(false)
    writeUrl({ page: nextPage })
    contentScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }

  function openAdd() {
    if (sharedProfileActive) return
    setMobileMenuOpen(false)
    setVoiceOnOpen(false)
    setShowAdd(true)
    writeUrl({ page, add: true })
  }

  function openVoice() {
    if (sharedProfileActive) return
    setMobileMenuOpen(false)
    setVoiceOnOpen(true)
    setShowAdd(true)
    writeUrl({ page, voice: true })
  }

  function closeAdd() {
    setShowAdd(false)
    setVoiceOnOpen(false)
    writeUrl({ page, add: false, mode: 'replace' })
  }

  function onMobileTouchStart(event: React.TouchEvent) {
    mobileTouchStartY.current = event.touches[0]?.clientY ?? null
  }

  function onMobileTouchEnd(event: React.TouchEvent) {
    const start = mobileTouchStartY.current
    mobileTouchStartY.current = null
    if (start === null) return
    const end = event.changedTouches[0]?.clientY ?? start
    if (start - end > 32) setMobileMenuOpen(true)
    else if (end - start > 32) setMobileMenuOpen(false)
  }

  function startFabHold(event: React.PointerEvent<HTMLButtonElement>) {
    if (sharedProfileActive) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    fabPointerActive.current = true
    setFabHolding(true)
    if (fabHoldTimer.current) window.clearTimeout(fabHoldTimer.current)
    fabHoldTimer.current = window.setTimeout(() => {
      if (!fabPointerActive.current) return
      fabPointerActive.current = false
      fabHoldTimer.current = undefined
      setFabHolding(false)
      navigator.vibrate?.([28, 20, 45])
      openVoice()
    }, HOLD_FOR_VOICE_MS)
  }

  function finishFabHold() {
    if (sharedProfileActive || !fabPointerActive.current) return
    fabPointerActive.current = false
    if (fabHoldTimer.current) window.clearTimeout(fabHoldTimer.current)
    fabHoldTimer.current = undefined
    setFabHolding(false)
    openAdd()
  }

  function cancelFabHold() {
    fabPointerActive.current = false
    if (fabHoldTimer.current) window.clearTimeout(fabHoldTimer.current)
    fabHoldTimer.current = undefined
    setFabHolding(false)
  }

  const moreActive = page === 'shared' || page === 'analytics' || page === 'settings'

  return (
    <div className="h-[100dvh] overflow-hidden bg-transparent text-stone-900 dark:text-stone-100">
      <aside className="fixed inset-y-0 left-0 z-40 hidden h-[100dvh] w-20 flex-col overflow-hidden border-r border-stone-200/80 bg-white p-3 dark:border-stone-800 dark:bg-stone-950 md:flex xl:w-64 xl:p-4">
        <div className="shrink-0"><div className="flex items-center justify-center gap-3 py-2 xl:justify-start xl:px-2"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white"><Wallet size={21} /></div><div className="hidden xl:block"><div className="font-semibold tracking-tight">O-Wallet</div><div className="text-xs text-stone-500">{t('app.shortTagline')}</div></div></div></div>
        <nav className="mt-8 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-0.5">{nav.map((item) => <a key={item.id} href={pageHref(item.id)} title={item.label} onClick={(event) => { event.preventDefault(); navigatePage(item.id) }} className={`flex w-full items-center justify-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition xl:justify-start ${page === item.id ? 'bg-stone-100 text-stone-950 dark:bg-stone-900 dark:text-white' : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-900'}`}><item.icon size={18} /><span className="hidden xl:inline">{item.label}</span></a>)}</nav>
        <div className="shrink-0 space-y-2 border-t border-stone-200/70 bg-white pt-3 dark:border-stone-800 dark:bg-stone-950"><Button className="w-full px-0 xl:px-4" title={sharedProfileActive ? t('nav.shared') : t('nav.addTransaction')} onClick={openAdd} disabled={sharedProfileActive}><Plus size={17} /><span className="hidden xl:inline">{t('nav.addTransaction')}</span></Button><Button variant="secondary" className="w-full justify-center px-0 xl:justify-start xl:px-4" title={t('voice.entryButton')} onClick={openVoice} disabled={sharedProfileActive}><Mic size={17} /><span className="hidden xl:inline">{t('voice.entryButton')}</span></Button><Button variant="ghost" className="w-full justify-center px-0 xl:justify-start xl:px-4" title={t('nav.lock')} onClick={lock}><LockKeyhole size={17} /><span className="hidden xl:inline">{t('nav.lock')}</span></Button></div>
      </aside>

      <div ref={contentScrollRef} className="h-[100dvh] overflow-y-auto overscroll-y-contain md:pl-20 xl:pl-64"><div className="flex min-h-full flex-col">
        <header className="sticky top-0 z-30 shrink-0 border-b border-stone-200/70 bg-[#f7f7f5]/92 px-4 py-3 backdrop-blur-xl dark:border-stone-800 dark:bg-[#0c0c0b]/92 sm:px-6"><div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3"><div className="flex items-center gap-2 md:hidden"><div className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white"><Wallet size={19} /></div><span className="font-semibold">O-Wallet</span></div><div className="hidden min-w-0 truncate text-xs text-stone-500 md:block">{googleConnectionState === 'connected' && googleSession && t('nav.driveConnected', { email: googleSession.user.email })}{googleConnectionState === 'reconnecting' && t('nav.driveReconnecting')}{googleConnectionState === 'attention' && t('nav.driveReconnectNeeded')}{googleConnectionState === 'disconnected' && t('nav.driveDisconnected')}</div><div className="ml-auto flex items-center gap-2">{googleConnectionState === 'connected' && googleSession && <Button variant="secondary" className="px-3" onClick={() => void syncNow()} disabled={syncBusy}><RefreshCw size={16} className={syncBusy ? 'animate-spin' : ''} /><span className="hidden sm:inline">{syncBusy ? syncMessage || t('common.syncing') : t('nav.sync')}</span></Button>}{googleConnectionState === 'reconnecting' && googleRememberedUser && <Button variant="secondary" className="px-3" disabled><RefreshCw size={16} className="animate-spin" /><span className="hidden sm:inline">{t('common.reconnecting')}</span></Button>}{googleConnectionState === 'attention' && googleRememberedUser && <Button variant="secondary" className="px-3" onClick={() => void retryGoogleConnection()}><RefreshCw size={16} /><span className="hidden sm:inline">{t('settings.reconnectGoogle')}</span></Button>}</div></div></header>
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-3 pb-8 pt-4 sm:px-5 sm:pt-5 lg:px-6"><Main page={page} /></main>
        <footer className="mx-auto w-full max-w-[1500px] shrink-0 px-3 pb-28 sm:px-5 md:pb-8 lg:px-6"><div className="flex items-center justify-center border-t border-stone-200/70 pt-5 text-xs text-stone-500 dark:border-stone-800"><a href="https://oppai1442.github.io/O-Project" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-900 dark:hover:text-stone-200"><span className="font-semibold">O-Project</span><span>·</span><span>{t('footer.moreProjects')}</span><ExternalLink size={13} /></a><span className="ml-2 text-[10px] text-stone-400">v0.18.1</span></div></footer>
      </div></div>

      {mobileMenuOpen && <><button aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/20 md:hidden" onClick={() => setMobileMenuOpen(false)} /><div className="safe-bottom fixed inset-x-2 bottom-[4.9rem] z-40 mx-auto max-w-xl rounded-2xl border border-stone-200 bg-white/98 p-3 shadow-2xl backdrop-blur-xl dark:border-stone-800 dark:bg-stone-950/98 md:hidden"><div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-300 dark:bg-stone-700" /><div className="grid grid-cols-3 gap-2">{nav.slice(2).map((item) => <button key={item.id} onClick={() => navigatePage(item.id)} className={`flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-xs font-semibold ${page === item.id ? 'bg-stone-100 text-blue-600 dark:bg-stone-900 dark:text-blue-400' : 'text-stone-600 dark:text-stone-300'}`}><item.icon size={20}/><span className="max-w-full truncate">{item.label}</span></button>)}</div><div className="mt-2 border-t border-stone-200 pt-2 dark:border-stone-800"><button onClick={() => { setMobileMenuOpen(false); lock() }} className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-stone-600 dark:text-stone-300"><LockKeyhole size={17}/>{t('nav.lock')}</button></div></div></>}

      <nav onTouchStart={onMobileTouchStart} onTouchEnd={onMobileTouchEnd} className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-3 pt-2 backdrop-blur-xl dark:border-stone-800 dark:bg-stone-950/95 md:hidden">
        <div className="relative mx-auto grid max-w-xl grid-cols-[1fr_84px_1fr] items-end gap-1">
          <MobileNav active={page === 'home'} href={pageHref('home')} icon={<Home size={20}/>} label={t('nav.home')} onClick={() => navigatePage('home')} />
          <div aria-hidden="true" className="h-12" />
          <MobileNav active={page === 'transactions'} href={pageHref('transactions')} icon={<ReceiptText size={20}/>} label={t('nav.transactions')} onClick={() => navigatePage('transactions')} />

          <button aria-label="Expand navigation" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((current) => !current)} className={`absolute right-1 top-0 flex h-7 w-10 -translate-y-[72%] items-center justify-center rounded-full border border-stone-200 bg-white shadow-sm transition dark:border-stone-800 dark:bg-stone-950 ${mobileMenuOpen || moreActive ? 'text-blue-600 dark:text-blue-400' : 'text-stone-400'}`}><ChevronUp size={17} className={`transition-transform duration-200 ${mobileMenuOpen ? 'rotate-180' : ''}`}/></button>

          {fabHolding && <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 -translate-y-[150%] whitespace-nowrap rounded-full bg-stone-950 px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg dark:bg-white dark:text-stone-950"><span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />{holdHint}</div>}

          <button aria-label={t('nav.addTransaction')} disabled={sharedProfileActive} onPointerDown={startFabHold} onPointerUp={finishFabHold} onPointerCancel={cancelFabHold} onContextMenu={(event) => event.preventDefault()} className={`absolute left-1/2 top-0 flex h-14 w-14 -translate-x-1/2 -translate-y-[32%] touch-none select-none items-center justify-center rounded-full border-4 border-white shadow-xl transition-all duration-150 dark:border-stone-950 ${sharedProfileActive ? 'bg-stone-300 text-stone-500 dark:bg-stone-800 dark:text-stone-500' : fabHolding ? 'scale-110 bg-blue-600 text-white shadow-blue-600/30' : 'bg-stone-950 text-white shadow-stone-950/25 dark:bg-white dark:text-stone-950'}`}>
            {fabHolding && <span className="absolute -inset-2 animate-pulse rounded-full border-2 border-blue-400/60" />}
            {fabHolding ? <Mic size={23}/> : <Plus size={25}/>} 
          </button>
        </div>
      </nav>

      <Suspense fallback={null}>{showAdd && !sharedProfileActive && <TransactionModal onClose={closeAdd} initialVoice={voiceOnOpen} />}</Suspense>
    </div>
  )
}

function MobileNav({ active, icon, label, href, onClick }: { active: boolean; icon: ReactNode; label: string; href: string; onClick: () => void }) {
  return <a href={href} onClick={(event) => { event.preventDefault(); onClick() }} className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[10px] font-semibold ${active ? 'text-blue-600 dark:text-blue-400' : 'text-stone-500'}`}>{icon}<span className="max-w-full truncate">{label}</span></a>
}
