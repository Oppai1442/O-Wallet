import type { Account, Transaction } from '../types'
import { isFutureTransaction } from './scheduling'

export function accountBalance(account: Account, transactions: Transaction[], now = Date.now()) {
  let balance = account.openingBalance
  for (const tx of transactions) {
    if (tx.deleted || isFutureTransaction(tx, now)) continue
    if (tx.type === 'income' && tx.accountId === account.id) balance += tx.amount
    if (tx.type === 'expense' && tx.accountId === account.id) balance -= tx.amount
    if (tx.type === 'transfer') {
      if (tx.accountId === account.id) balance -= tx.amount
      if (tx.destinationAccountId === account.id) balance += tx.amount
    }
  }
  return balance
}

export function totalBalance(accounts: Account[], transactions: Transaction[], now = Date.now()) {
  return accounts.reduce((sum, account) => sum + accountBalance(account, transactions, now), 0)
}
