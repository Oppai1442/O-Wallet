import type { ExternalImportTrace } from '../types'

export function importSourcesMatch(left?: ExternalImportTrace, right?: ExternalImportTrace) {
  if (!left || !right) return false
  if (left.adapterId !== right.adapterId || left.sourceId !== right.sourceId) return false

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
