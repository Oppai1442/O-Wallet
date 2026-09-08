import type { Account, Transaction } from '../types'

export function accountBalance(account: Account, transactions: Transaction[]) {
  let balance = account.openingBalance
  for (const tx of transactions) {
    if (tx.deleted) continue
    if (tx.type === 'income' && tx.accountId === account.id) balance += tx.amount
    if (tx.type === 'expense' && tx.accountId === account.id) balance -= tx.amount
    if (tx.type === 'transfer') {
      if (tx.accountId === account.id) balance -= tx.amount
      if (tx.destinationAccountId === account.id) balance += tx.amount
    }
  }
  return balance
}

export function totalBalance(accounts: Account[], transactions: Transaction[]) {
  return accounts.reduce((sum, account) => sum + accountBalance(account, transactions), 0)
}
