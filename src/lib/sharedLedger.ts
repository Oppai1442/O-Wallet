import type {
  Account,
  Category,
  SharedTransaction,
  SharedWalletArchive,
  SharedWalletControl,
  SharedWalletLedger,
  Transaction,
} from '../types'

export function defaultSharedLedger(currency = 'VND'): SharedWalletLedger {
  return {
    defaultCurrency: currency.trim().toUpperCase().slice(0, 12) || 'VND',
    accounts: [],
    categories: [],
    budgets: [],
    accountCatalogues: [],
    transactionRules: [],
    ocrTemplates: [],
    transactionDefaults: {},
  }
}

export function sharedLedgerOf(control: SharedWalletControl, fallbackCurrency = 'VND'): SharedWalletLedger {
  const fallback = defaultSharedLedger(fallbackCurrency)
  const ledger = control.ledger
  if (!ledger) return fallback
  return {
    ...fallback,
    ...ledger,
    defaultCurrency: typeof ledger.defaultCurrency === 'string' && ledger.defaultCurrency.trim()
      ? ledger.defaultCurrency.trim().toUpperCase().slice(0, 12)
      : fallback.defaultCurrency,
    accounts: Array.isArray(ledger.accounts) ? ledger.accounts : [],
    categories: Array.isArray(ledger.categories) ? ledger.categories : [],
    budgets: Array.isArray(ledger.budgets) ? ledger.budgets : [],
    accountCatalogues: Array.isArray(ledger.accountCatalogues) ? ledger.accountCatalogues : [],
    transactionRules: Array.isArray(ledger.transactionRules) ? ledger.transactionRules : [],
    ocrTemplates: Array.isArray(ledger.ocrTemplates) ? ledger.ocrTemplates : [],
    transactionDefaults: ledger.transactionDefaults && typeof ledger.transactionDefaults === 'object' ? ledger.transactionDefaults : {},
  }
}

export function sharedAccountBalances(ledger: SharedWalletLedger, transactions: SharedTransaction[], now = Date.now()) {
  const balances = new Map<string, number>()
  for (const account of ledger.accounts) {
    if (!account.deleted && !account.archived) balances.set(account.id, account.openingBalance)
  }
  for (const tx of transactions) {
    if (tx.deleted || Date.parse(tx.occurredAt) > now) continue
    if (tx.type === 'income') {
      if (tx.accountId && balances.has(tx.accountId)) balances.set(tx.accountId, (balances.get(tx.accountId) ?? 0) + tx.amount)
    } else if (tx.type === 'expense') {
      if (tx.accountId && balances.has(tx.accountId)) balances.set(tx.accountId, (balances.get(tx.accountId) ?? 0) - tx.amount)
    } else if (tx.type === 'transfer') {
      if (tx.accountId && balances.has(tx.accountId)) balances.set(tx.accountId, (balances.get(tx.accountId) ?? 0) - tx.amount)
      if (tx.destinationAccountId && balances.has(tx.destinationAccountId)) balances.set(tx.destinationAccountId, (balances.get(tx.destinationAccountId) ?? 0) + tx.amount)
    }
  }
  return balances
}

export function sharedTotals(transactions: SharedTransaction[], now = Date.now()) {
  let income = 0
  let expense = 0
  for (const tx of transactions) {
    if (tx.deleted || Date.parse(tx.occurredAt) > now) continue
    if (tx.type === 'income') income += tx.amount
    if (tx.type === 'expense') expense += tx.amount
  }
  return { income, expense, net: income - expense }
}

export function sharedTransactionAsPersonalShape(tx: SharedTransaction): Transaction {
  return {
    id: `${tx.createdByMemberId}:${tx.id}`,
    type: tx.type,
    amount: tx.amount,
    currency: tx.currency,
    occurredAt: tx.occurredAt,
    categoryId: tx.categoryId ?? '',
    accountId: tx.accountId ?? '',
    destinationAccountId: tx.destinationAccountId,
    merchant: tx.merchant,
    balanceAfter: tx.balanceAfter,
    description: tx.description,
    note: tx.note,
    tags: tx.tags,
    batch: tx.batch,
    imageIds: [],
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
    deleted: tx.deleted,
  }
}

export function sharedTransactionsAsPersonalShape(transactions: SharedTransaction[]) {
  return transactions.map(sharedTransactionAsPersonalShape)
}

export function buildSharedArchive(
  control: SharedWalletControl,
  transactions: SharedTransaction[],
  memberNames: Record<string, string>,
): SharedWalletArchive {
  const ledger = sharedLedgerOf(control, transactions[0]?.currency ?? 'VND')
  const balances = sharedAccountBalances(ledger, transactions)
  return {
    id: crypto.randomUUID(),
    originalGroupId: control.groupId,
    name: control.name,
    createdAt: control.createdAt,
    closedAt: control.lifecycle?.purgeAfter ?? new Date().toISOString(),
    archivedAt: new Date().toISOString(),
    ledger,
    transactions: transactions.map((tx) => ({ ...tx })),
    members: control.members.map((member) => ({ ...member })),
    memberNames: { ...memberNames },
    finalBalances: Object.fromEntries(balances),
    totals: sharedTotals(transactions),
  }
}

export function accountLabel(accountId: string | undefined, accounts: Account[]) {
  if (!accountId) return ''
  return accounts.find((account) => account.id === accountId)?.name ?? ''
}

export function categoryLabel(categoryId: string | undefined, categories: Category[]) {
  if (!categoryId) return ''
  return categories.find((category) => category.id === categoryId)?.name ?? ''
}
