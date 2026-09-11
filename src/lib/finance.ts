import type { Account, Transaction } from '../types'
import { isFutureTransaction } from './scheduling'

function amountForAccountCurrency(account: Account, tx: Transaction) {
  if (tx.currency.trim().toUpperCase() === account.currency.trim().toUpperCase()) return tx.amount
  if (tx.fx?.baseCurrency.trim().toUpperCase() === account.currency.trim().toUpperCase()) return tx.fx.convertedAmount
  return undefined
}

export function accountBalance(account: Account, transactions: Transaction[], now = Date.now()) {
  let balance = account.openingBalance
  for (const tx of transactions) {
    if (tx.deleted || isFutureTransaction(tx, now)) continue
    const amount = amountForAccountCurrency(account, tx)
    if (amount === undefined) continue
    if (tx.type === 'income' && tx.accountId === account.id) balance += amount
    if (tx.type === 'expense' && tx.accountId === account.id) balance -= amount
    if (tx.type === 'transfer') {
      if (tx.accountId === account.id) balance -= amount
      if (tx.destinationAccountId === account.id) balance += amount
    }
  }
  return balance
}

/**
 * Raw same-unit total retained only for legacy callers. Do not use this as a
 * multi-currency net-worth value; foreign account balances require valuation.
 */
export function totalBalance(accounts: Account[], transactions: Transaction[], now = Date.now()) {
  return accounts.filter((account) => !account.archived).reduce((sum, account) => sum + accountBalance(account, transactions, now), 0)
}
