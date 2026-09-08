import { WalletProvider, useWallet } from './WalletContext'
import { LanguageProvider, useI18n } from './i18n'
import { Onboarding } from './components/Onboarding'
import { Shell } from './components/Shell'
import { Unlock } from './components/Unlock'

function AppBody() {
  const { status } = useWallet()
  const { t } = useI18n()
  if (status === 'loading') return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">{t('app.loading')}</div>
  if (status === 'new') return <Onboarding />
  if (status === 'locked') return <Unlock />
  return <Shell />
}

export default function App() {
  return (
    <LanguageProvider>
      <WalletProvider><AppBody /></WalletProvider>
    </LanguageProvider>
  )
}
