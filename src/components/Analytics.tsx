import { useWallet } from '../WalletContext'
import { LedgerAnalytics } from './LedgerAnalytics'

export function Analytics() {
  const { transactions, categories, settings } = useWallet()
  return <LedgerAnalytics transactions={transactions} categories={categories} currency={settings?.defaultCurrency ?? 'VND'} />
}
