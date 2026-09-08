import type { Account, AccountCatalogue } from '../types'

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
