import { WalletProvider, useWallet } from './WalletContext'
import { Onboarding } from './components/Onboarding'
import { Shell } from './components/Shell'
import { Unlock } from './components/Unlock'

function AppBody() {
  const { status } = useWallet()
  if (status === 'loading') return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading encrypted vault…</div>
  if (status === 'new') return <Onboarding />
  if (status === 'locked') return <Unlock />
  return <Shell />
}

export default function App() {
  return <WalletProvider><AppBody /></WalletProvider>
}
