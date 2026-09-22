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
  return new Set(sourceId.split('|').map((value) => value.trim()).filter(Boolean))
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

  const leftSemantic = leftRows.filter((id) => id.startsWith('sig:'))
  const rightSemantic = rightRows.filter((id) => id.startsWith('sig:'))
  if (leftSemantic.length && rightSemantic.length) {
    const rightSet = new Set(rightSemantic)
    return leftSemantic.some((id) => rightSet.has(id))
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
  if (semantic.length) return semantic[0]
  return [...rowIds].sort()[0] ?? 'row:unknown'
}

export async function imageImportRecordId(sourceId: string, rowIds: string[]) {
  const canonical = `owallet-image-v2|${canonicalSourceId(sourceId)}|${canonicalRowId(rowIds)}`
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)))
  const hex = [...digest.slice(0, 16)].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `ocr-${hex}`
}
