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

export function importSourcesMatch(left?: ExternalImportTrace, right?: ExternalImportTrace) {
  if (!left || !right) return false
  if (left.adapterId !== right.adapterId) return false
  const leftSources = sourceIdAliases(left.sourceId)
  const rightSources = sourceIdAliases(right.sourceId)
  if (![...leftSources].some((source) => rightSources.has(source))) return false

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
