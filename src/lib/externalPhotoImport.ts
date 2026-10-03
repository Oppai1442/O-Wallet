import type { ExternalImportPhotoReference } from './importers/types'

export interface ExternalPhotoMatch {
  reference: ExternalImportPhotoReference
  file: File
  fileIndex: number
  score: number
  reason: 'path' | 'name-size' | 'name'
}

export interface ExternalPhotoMatchResult {
  matches: ExternalPhotoMatch[]
  unmatched: ExternalImportPhotoReference[]
  ambiguous: ExternalImportPhotoReference[]
}

function normalizedPath(value: string | undefined) {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/\\/g, '/')
    .replace(/^[a-z]:/i, '')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLocaleLowerCase('en-US')
}

function basename(value: string | undefined) {
  const path = normalizedPath(value)
  return path.split('/').filter(Boolean).at(-1) ?? ''
}

function fileRelativePath(file: File) {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath
  return normalizedPath(relative || file.name)
}

function commonTrailingSegments(a: string, b: string) {
  const left = normalizedPath(a).split('/').filter(Boolean)
  const right = normalizedPath(b).split('/').filter(Boolean)
  let count = 0
  while (
    count < left.length
    && count < right.length
    && left[left.length - 1 - count] === right[right.length - 1 - count]
  ) count += 1
  return count
}

function scoreCandidate(reference: ExternalImportPhotoReference, file: File) {
  const selectedPath = fileRelativePath(file)
  const sourcePath = normalizedPath(reference.originalPath)
  const expectedName = basename(reference.fileName || reference.originalPath)
  const actualName = basename(selectedPath)
  if (!actualName || !expectedName || actualName !== expectedName) return undefined

  const sizeMatches = !reference.fileSize || reference.fileSize <= 0 || reference.fileSize === file.size
  const trailing = sourcePath ? commonTrailingSegments(sourcePath, selectedPath) : 0
  if (trailing >= 2 && sizeMatches) return { score: 140 + Math.min(trailing, 20), reason: 'path' as const }
  if (trailing >= 2) return { score: 125 + Math.min(trailing, 20), reason: 'path' as const }
  if (sizeMatches && reference.fileSize) return { score: 110, reason: 'name-size' as const }
  return { score: 80, reason: 'name' as const }
}

export function matchExternalPhotoReferences(
  references: ExternalImportPhotoReference[],
  files: File[],
): ExternalPhotoMatchResult {
  const matches: ExternalPhotoMatch[] = []
  const unmatched: ExternalImportPhotoReference[] = []
  const ambiguous: ExternalImportPhotoReference[] = []

  for (const reference of references) {
    const candidates = files
      .map((file, fileIndex) => {
        const scored = scoreCandidate(reference, file)
        return scored ? { reference, file, fileIndex, ...scored } : undefined
      })
      .filter((item): item is ExternalPhotoMatch => Boolean(item))
      .sort((a, b) => b.score - a.score)

    if (!candidates.length) {
      unmatched.push(reference)
      continue
    }
    if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
      ambiguous.push(reference)
      continue
    }
    matches.push(candidates[0])
  }

  return { matches, unmatched, ambiguous }
}

export async function externalPhotoImageId(adapterId: string, sourceId: string) {
  const input = new TextEncoder().encode(`external-photo:${adapterId}:${sourceId}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `import-image:${hex}`
}
