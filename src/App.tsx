import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import { WalletProvider, useWallet } from './WalletContext'
import { LanguageProvider, useI18n } from './i18n'
import { Onboarding } from './components/Onboarding'
import { Shell } from './components/Shell'
import { Unlock } from './components/Unlock'

function DelayedLoader() {
  const { t } = useI18n()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setVisible(true), 140)
    return () => window.clearTimeout(id)
  }, [])

  if (!visible) return <div className="min-h-[100dvh]" aria-hidden="true" />

  return (
    <div className="ow-fade-in flex min-h-[100dvh] items-center justify-center px-4">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white"><Wallet size={20} /></div>
        <div><div className="font-black tracking-tight">O-Wallet</div><div className="text-xs text-slate-500">{t('app.loading')}</div></div>
      </div>
    </div>
  )
}

function AppBody() {
  const { status, googleAutoConnecting, refresh } = useWallet()
  const [localReady, setLocalReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (status !== 'unlocked') {
      setLocalReady(false)
      return () => { cancelled = true }
    }

    // Local IndexedDB rows are encrypted. Hydrate/decrypt them immediately after
    // unlocking so Drive availability never gates the first useful render.
    setLocalReady(false)
    void refresh()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLocalReady(true)
      })

    return () => { cancelled = true }
  }, [refresh, status])

  if (status === 'loading') return <DelayedLoader />
  if (status === 'new') return <div className="ow-fade-in"><Onboarding autoConnecting={googleAutoConnecting} /></div>
  if (status === 'locked') return <div className="ow-fade-in"><Unlock /></div>
  if (!localReady) return <DelayedLoader />
  return <div className="ow-fade-in"><Shell /></div>
}

export default function App() {
  return (
    <LanguageProvider>
      <WalletProvider><AppBody /></WalletProvider>
    </LanguageProvider>
  )
}
