function normalizedBlockText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ').trim()
}

function fnv1a64(value: string) {
  let hash = 0xcbf29ce484222325n
  const bytes = new TextEncoder().encode(value)
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

export function imageImportBlockFingerprint(rawText: string) {
  const normalized = normalizedBlockText(rawText)
  return normalized ? fnv1a64(normalized) : undefined
}

export function buildImageImportBlockRowId(rawText: string, occurrence = 0) {
  const fingerprint = imageImportBlockFingerprint(rawText)
  return fingerprint ? `blk:${fingerprint}:${Math.max(0, Math.floor(occurrence))}` : undefined
}

export function buildImageImportSemanticRowId(input: {
  type: 'expense' | 'income' | 'transfer'
  amount?: number
  occurredAt?: string
  merchant?: string
  description?: string
}) {
  const amount = input.amount !== undefined && Number.isFinite(input.amount)
    ? String(Math.round(input.amount * 100) / 100)
    : ''
  const time = input.occurredAt ?? ''
  const party = (input.merchant ?? input.description ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96)
  if (!amount || (!time && !party)) return undefined
  return `sig:${input.type}:${amount}:${time}:${party}`
}

import type { ExternalImportTrace } from '../types'

function sourceIdAliases(sourceId: string) {
  const parts = sourceId.split('|').map((value) => value.trim()).filter(Boolean)
  const fingerprint = /^(?:sample-sha256-v1|sha256-v2):\d+:[a-f0-9]{64}$/i
  if (parts.length > 1 && parts.every((value) => fingerprint.test(value))) return new Set(parts)
  return new Set([sourceId])
}

export function sourceIdsMatch(left: string, right: string) {
  const leftSources = sourceIdAliases(left)
  const rightSources = sourceIdAliases(right)
  return [...leftSources].some((source) => rightSources.has(source))
}

export function importSourcesMatch(left?: ExternalImportTrace, right?: ExternalImportTrace) {
  if (!left || !right) return false
  if (left.adapterId !== right.adapterId) return false
  if (!sourceIdsMatch(left.sourceId, right.sourceId)) return false

  const leftRows = left.sourceRowIds ?? []
  const rightRows = right.sourceRowIds ?? []
  if (!leftRows.length || !rightRows.length) return false

  const leftBlocks = leftRows.filter((id) => id.startsWith('blk:'))
  const rightBlocks = rightRows.filter((id) => id.startsWith('blk:'))
  if (leftBlocks.length && rightBlocks.length) {
    const rightBlockSet = new Set(rightBlocks)
    if (leftBlocks.some((id) => rightBlockSet.has(id))) return true
  }

  const leftSemantic = leftRows.filter((id) => id.startsWith('sig:'))
  const rightSemantic = rightRows.filter((id) => id.startsWith('sig:'))
  if (leftSemantic.length && rightSemantic.length) {
    const rightSemanticSet = new Set(rightSemantic)
    if (!leftSemantic.some((id) => rightSemanticSet.has(id))) return false

    const leftOccurrences = leftRows.filter((id) => id.startsWith('occ:'))
    const rightOccurrences = rightRows.filter((id) => id.startsWith('occ:'))
    if (leftOccurrences.length && rightOccurrences.length) {
      const rightOccurrenceSet = new Set(rightOccurrences)
      return leftOccurrences.some((id) => rightOccurrenceSet.has(id))
    }
    return true
  }

  const rightSet = new Set(rightRows)
  return leftRows.some((id) => rightSet.has(id))
}

function canonicalSourceId(sourceId: string) {
  const aliases = [...sourceIdAliases(sourceId)]
  return aliases.find((value) => value.startsWith('sample-sha256-v1:'))
    ?? aliases.find((value) => value.startsWith('sha256-v2:'))
    ?? aliases.sort()[0]
    ?? sourceId
}

function canonicalRowId(rowIds: string[]) {
  const semantic = rowIds.filter((id) => id.startsWith('sig:')).sort()
  const occurrence = rowIds.filter((id) => id.startsWith('occ:')).sort()
  if (semantic.length) return occurrence.length ? `${semantic[0]}|${occurrence[0]}` : semantic[0]
  const blocks = rowIds.filter((id) => id.startsWith('blk:')).sort()
  if (blocks.length) return blocks[0]
  return [...rowIds].filter((id) => !id.startsWith('occ:')).sort()[0] ?? 'row:unknown'
}

export async function imageImportRecordId(sourceId: string, rowIds: string[]) {
  const canonical = `owallet-image-v2|${canonicalSourceId(sourceId)}|${canonicalRowId(rowIds)}`
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)))
  const hex = [...digest.slice(0, 16)].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `ocr-${hex}`
}

export async function imageImportImageId(sourceId: string) {
  const canonical = `owallet-image-v2-image|${canonicalSourceId(sourceId)}`
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)))
  const hex = [...digest.slice(0, 16)].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `ocr-image-${hex}`
}


function canonicalTransactionText(value?: string) {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

export function canonicalImageImportTransaction(input: {
  type: 'expense' | 'income' | 'transfer'
  amount: number
  currency?: string
  occurredAt?: string
  accountId?: string
  merchant?: string
  description?: string
}) {
  const amount = Number.isFinite(input.amount) ? String(Math.round(input.amount * 100) / 100) : ''
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : undefined
  const minute = occurredAt && Number.isFinite(occurredAt.getTime())
    ? occurredAt.toISOString().slice(0, 16)
    : ''
  return [
    input.type,
    amount,
    (input.currency ?? '').trim().toUpperCase(),
    minute,
    input.accountId ?? '',
    canonicalTransactionText(input.merchant),
    canonicalTransactionText(input.description),
  ].join('|')
}

export async function imageImportTransactionHash(input: {
  type: 'expense' | 'income' | 'transfer'
  amount: number
  currency?: string
  occurredAt?: string
  accountId?: string
  merchant?: string
  description?: string
}) {
  const canonical = canonicalImageImportTransaction(input)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)))
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
}
