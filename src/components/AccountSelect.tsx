import type { Account, AccountCatalogue } from '../types'
import { accountCurrencies, groupedAccounts } from '../lib/accounts'
import { Select } from './ui'
import { useI18n } from '../i18n'

export function AccountSelect({ accounts, catalogues, value, onChange, excludeId, includeEmpty = false }: {
  accounts: Account[]
  catalogues: AccountCatalogue[]
  value: string
  onChange: (value: string) => void
  excludeId?: string
  includeEmpty?: boolean
}) {
  const { t } = useI18n()
  const available = accounts.filter((item) => item.id !== excludeId && (!item.archived || item.id === value))
  const { groups, uncategorized } = groupedAccounts(available, catalogues)
  const selected = accounts.find((account) => account.id === value)
  const currencies = selected ? accountCurrencies(selected) : []
  // A source selector has no excludeId. CurrencyPicker uses this marker only inside
  // transaction modals; ordinary settings/account selectors are unaffected.
  const sourceMarker = excludeId === undefined ? currencies.join(',') : undefined

  return <div data-account-currency-source={sourceMarker}>
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {includeEmpty && <option value="">—</option>}
      {groups.filter((group) => group.accounts.length > 0).map((group) => <optgroup key={group.catalogue.id} label={group.catalogue.name}>{group.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</optgroup>)}
      {uncategorized.length > 0 && <optgroup label={groups.length ? t('accounts.uncategorized') : t('settings.accounts')}>{uncategorized.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</optgroup>}
    </Select>
  </div>
}
