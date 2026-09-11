import type { Account, AccountCatalogue } from '../types'

function cleanCurrency(value: string | undefined, fallback = 'VND') {
  return value?.trim().toUpperCase() || fallback
}

export function accountCurrencies(account: Account) {
  const legacy = cleanCurrency(account.currency)
  const configured = (account.currencies ?? []).map((value) => cleanCurrency(value)).filter(Boolean)
  return [...new Set(configured.length ? configured : [legacy])]
}

export function primaryAccountCurrency(account: Account) {
  return accountCurrencies(account)[0] ?? cleanCurrency(account.currency)
}

export function accountOpeningBalance(account: Account, currency: string) {
  const code = cleanCurrency(currency)
  const explicit = account.openingBalances?.[code]
  if (Number.isFinite(explicit)) return Number(explicit)
  return code === cleanCurrency(account.currency) ? account.openingBalance : 0
}

export function withAccountPockets(account: Account, currencies: string[], openingBalances: Record<string, number>): Account {
  const normalized = [...new Set(currencies.map((value) => cleanCurrency(value)).filter(Boolean))]
  const nextCurrencies = normalized.length ? normalized : [cleanCurrency(account.currency)]
  const nextOpeningBalances = Object.fromEntries(nextCurrencies.map((code) => [code, Number(openingBalances[code]) || 0]))
  const primary = nextCurrencies[0]
  return {
    ...account,
    currency: primary,
    openingBalance: nextOpeningBalances[primary] ?? 0,
    currencies: nextCurrencies,
    openingBalances: nextOpeningBalances,
  }
}

export function catalogueName(id: string | undefined, catalogues: AccountCatalogue[]) {
  return id ? catalogues.find((item) => item.id === id)?.name : undefined
}

export function groupedAccounts(accounts: Account[], catalogues: AccountCatalogue[]) {
  const catalogueIds = new Set(catalogues.map((item) => item.id))
  const groups = catalogues.map((catalogue) => ({
    catalogue,
    accounts: accounts.filter((account) => account.catalogueId === catalogue.id),
  }))
  const uncategorized = accounts.filter((account) => !account.catalogueId || !catalogueIds.has(account.catalogueId))
  return { groups, uncategorized }
}
