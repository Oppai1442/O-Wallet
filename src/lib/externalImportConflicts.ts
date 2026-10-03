import type { Transaction } from '../types'

export type ExternalImportConflictReason = 'same-source' | 'same-minute'
export type ExternalImportConflictDecision = 'replace' | 'ignore'

export interface ExternalImportConflict {
  id: string
  reason: ExternalImportConflictReason
  existing: Transaction
  incoming: Transaction
}

function amountKey(value: number) {
  return String(Math.round(value * 100) / 100)
}

function minuteKey(value: string) {
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? String(Math.floor(time / 60_000)) : value
}

export function externalImportTransactionKey(tx: Pick<Transaction, 'type' | 'amount' | 'currency' | 'occurredAt' | 'accountId' | 'destinationAccountId'>) {
  return [
    tx.type,
    amountKey(tx.amount),
    tx.currency.trim().toUpperCase(),
    minuteKey(tx.occurredAt),
    tx.accountId,
    tx.destinationAccountId ?? '',
  ].join('|')
}

function sameImportSource(left: Transaction, right: Transaction) {
  const a = left.importSource
  const b = right.importSource
  return Boolean(a && b && a.adapterId === b.adapterId && a.sourceId === b.sourceId)
}

export function findExternalImportConflicts(incoming: Transaction[], existing: Transaction[]) {
  const active = existing.filter((tx) => !tx.deleted)
  const byKey = new Map<string, Transaction[]>()
  for (const tx of active) {
    const key = externalImportTransactionKey(tx)
    const rows = byKey.get(key) ?? []
    rows.push(tx)
    byKey.set(key, rows)
  }

  const conflicts: ExternalImportConflict[] = []
  for (const candidate of incoming) {
    const sameSource = active.find((tx) => sameImportSource(candidate, tx))
    const sameMinute = byKey.get(externalImportTransactionKey(candidate))?.[0]
    const match = sameSource ?? sameMinute
    if (!match) continue
    conflicts.push({
      id: `${candidate.importSource?.adapterId ?? 'external'}:${candidate.importSource?.sourceId ?? candidate.id}:${match.id}`,
      reason: sameSource ? 'same-source' : 'same-minute',
      existing: match,
      incoming: candidate,
    })
  }
  return conflicts
}

export function replaceExternalImportConflict(conflict: ExternalImportConflict) {
  return {
    ...conflict.incoming,
    id: conflict.existing.id,
    createdAt: conflict.existing.createdAt,
    imageIds: Array.from(new Set([...conflict.existing.imageIds, ...conflict.incoming.imageIds])),
  } satisfies Transaction
}
