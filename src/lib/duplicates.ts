import type { Transaction } from '../types'

export type DuplicateLevel = 'exact' | 'possible'

export interface DuplicateMatch {
  level: DuplicateLevel
  transaction: Transaction
  score: number
}

function normalizedText(value?: string) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function textSimilarity(a?: string, b?: string) {
  const left = normalizedText(a)
  const right = normalizedText(b)
  if (!left && !right) return 1
  if (!left || !right) return 0
  if (left === right) return 1
  const aTokens = new Set(left.split(' ').filter(Boolean))
  const bTokens = new Set(right.split(' ').filter(Boolean))
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length
  const union = new Set([...aTokens, ...bTokens]).size
  return union ? intersection / union : 0
}

export function findDuplicateTransaction(
  candidate: Pick<Transaction, 'type' | 'amount' | 'occurredAt' | 'accountId' | 'merchant' | 'description'>,
  transactions: Transaction[],
): DuplicateMatch | undefined {
  const candidateTime = new Date(candidate.occurredAt).getTime()
  if (!Number.isFinite(candidateTime)) return undefined

  let best: DuplicateMatch | undefined
  for (const tx of transactions) {
    if (tx.deleted || tx.type !== candidate.type) continue
    if (Math.abs(tx.amount - candidate.amount) > 0.01) continue
    if (candidate.accountId && tx.accountId !== candidate.accountId) continue

    const txTime = new Date(tx.occurredAt).getTime()
    if (!Number.isFinite(txTime)) continue
    const delta = Math.abs(txTime - candidateTime)
    const merchantScore = textSimilarity(candidate.merchant, tx.merchant)
    const descriptionScore = textSimilarity(candidate.description, tx.description)
    const textScore = Math.max(merchantScore, descriptionScore)

    if (delta <= 2 * 60_000 && textScore >= 0.5) {
      return { level: 'exact', transaction: tx, score: 1 }
    }

    // OCR timestamps can be imperfect or absent. Same amount/account within a day plus
    // similar recipient/description is suspicious enough to surface for review.
    if (delta <= 24 * 60 * 60_000 && textScore >= 0.35) {
      const score = 0.55 + (0.25 * textScore) + (0.2 * (1 - delta / (24 * 60 * 60_000)))
      if (!best || score > best.score) best = { level: 'possible', transaction: tx, score }
    }
  }
  return best
}
