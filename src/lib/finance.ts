import type { Account, Transaction } from '../types'
import { accountCurrencies, accountOpeningBalance, primaryAccountCurrency } from './accounts'
import { isFutureTransaction } from './scheduling'

function cleanCurrency(value: string | undefined, fallback = 'VND') {
  return value?.trim().toUpperCase() || fallback
}

function destinationSide(tx: Transaction) {
  return {
    amount: Number.isFinite(tx.destinationAmount) && Number(tx.destinationAmount) > 0 ? Number(tx.destinationAmount) : tx.amount,
    currency: cleanCurrency(tx.destinationCurrency, tx.currency),
  }
}

export function accountBalanceByCurrency(account: Account, transactions: Transaction[], now = Date.now()) {
  const balances = new Map<string, number>()
  for (const currency of accountCurrencies(account)) balances.set(currency, accountOpeningBalance(account, currency))

  const ensure = (currency: string) => {
    const code = cleanCurrency(currency)
    if (!balances.has(code)) balances.set(code, accountOpeningBalance(account, code))
    return code
  }

  for (const tx of transactions) {
    if (tx.deleted || isFutureTransaction(tx, now)) continue
    const sourceSide = tx.accountId === account.id
    const destinationSideMatch = tx.type === 'transfer' && tx.destinationAccountId === account.id
    if (!sourceSide && !destinationSideMatch) continue

    if (sourceSide) {
      const sourceCurrency = ensure(tx.currency)
      if (tx.type === 'income') balances.set(sourceCurrency, (balances.get(sourceCurrency) ?? 0) + tx.amount)
      if (tx.type === 'expense') balances.set(sourceCurrency, (balances.get(sourceCurrency) ?? 0) - tx.amount)
      if (tx.type === 'transfer') balances.set(sourceCurrency, (balances.get(sourceCurrency) ?? 0) - tx.amount)
    }

    if (destinationSideMatch) {
      const destination = destinationSide(tx)
      const destinationCurrency = ensure(destination.currency)
      balances.set(destinationCurrency, (balances.get(destinationCurrency) ?? 0) + destination.amount)
    }
  }
  return balances
}

/** Legacy single-number helper: returns only the account's primary pocket. */
export function accountBalance(account: Account, transactions: Transaction[], now = Date.now()) {
  const primary = primaryAccountCurrency(account)
  return accountBalanceByCurrency(account, transactions, now).get(primary) ?? 0
}

/**
 * Raw same-unit total retained only for legacy callers. Do not use this as a
 * multi-currency net-worth value; use accountBalanceByCurrency and value each
 * currency explicitly instead.
 */
export function totalBalance(accounts: Account[], transactions: Transaction[], now = Date.now()) {
  return accounts.filter((account) => !account.archived).reduce((sum, account) => sum + accountBalance(account, transactions, now), 0)
}
