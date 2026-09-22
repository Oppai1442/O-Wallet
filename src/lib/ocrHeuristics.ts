export const OCR_HEURISTIC_THRESHOLDS = {
  templateMinScore: 0.40,
  templateMinAnchorScore: 0.20,
  templateMinVisualScore: 0.62,
  autoLearnMinTemplateScore: 0.45,
  preserveBlockMinOverlap: 0.55,
  dedupeBlockMinOverlap: 0.60,
  visualSeparatorMinDelta: 8,
  visualSeparatorStdDevMultiplier: 1.25,
  visualSeparatorMinSpacing: 0.03,
  templateBlockMinEvidence: 2,
  templateBlockMinConfidence: 18,
  genericBlockMinEvidence: 3,
  genericBlockMinConfidence: 22,
} as const

export interface HeuristicFingerprint {
  verticalLumaProfile?: number[]
}

export interface HeuristicCandidate {
  amount?: number
  occurredAt?: string
  merchant?: string
  description?: string
  balanceAfter?: number
}

export interface HeuristicBlock {
  candidate: HeuristicCandidate
  bbox: { y: number; height: number }
  confidence: number
}

export interface TemplateRankEvidence {
  score?: number
  anchorScore?: number
  visualScore?: number
}

export function ocrPatternReliability(successes = 0, failures = 0) {
  const safeSuccesses = Number.isFinite(successes) && successes > 0 ? successes : 0
  const safeFailures = Number.isFinite(failures) && failures > 0 ? failures : 0
  return (safeSuccesses + 1) / (safeSuccesses + safeFailures + 2)
}

export function chooseOcrTileHeight(width: number, height: number, deviceMemory = 4, requested?: number) {
  if (requested !== undefined) return Math.max(900, Math.min(4200, Math.round(requested)))
  const memory = Number.isFinite(deviceMemory) && deviceMemory > 0 ? deviceMemory : 4
  const pixelScale = width >= 2400 ? 0.72 : width >= 1600 ? 0.86 : 1
  const base = memory <= 2 ? 1400 : memory <= 4 ? 2000 : memory >= 8 ? 3200 : 2500
  const longPenalty = height > 40_000 ? 0.86 : 1
  return Math.max(1100, Math.min(3600, Math.round(base * pixelScale * longPenalty)))
}

export function mapDetectedLinesToRegions(
  lines: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  regions: Array<{ field: string; x: number; y: number; width: number; height: number }>,
) {
  const mappings: Record<string, string> = {}
  for (const line of lines) {
    const cx = line.x + line.width / 2
    const cy = line.y + line.height / 2
    const matches = regions
      .filter((region) => cx >= region.x && cx <= region.x + region.width && cy >= region.y && cy <= region.y + region.height)
      .sort((a, b) => (a.width * a.height) - (b.width * b.height))
    if (matches[0]) mappings[line.id] = matches[0].field
  }
  return mappings
}

export function sampleShape(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[A-Za-z]+/g, 'A')
    .replace(/\d+/g, '0')
    .slice(0, 80)
}

export function shapeSimilarity(left: string, right: string) {
  if (!left || !right) return 0
  const max = Math.max(left.length, right.length)
  if (!max) return 1
  let same = 0
  const min = Math.min(left.length, right.length)
  for (let index = 0; index < min; index += 1) if (left[index] === right[index]) same += 1
  return same / max
}

export function visualSeparatorPositions(visual: HeuristicFingerprint | undefined) {
  const profile = visual?.verticalLumaProfile
  if (!profile || profile.length < 8) return [] as number[]
  const deltas = profile.slice(1).map((value, index) => Math.abs(value - profile[index]))
  const mean = deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length)
  const variance = deltas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, deltas.length)
  const threshold = mean + Math.sqrt(variance) * OCR_HEURISTIC_THRESHOLDS.visualSeparatorStdDevMultiplier
  const candidates: number[] = []
  for (let index = 1; index < profile.length; index += 1) {
    if (deltas[index - 1] < Math.max(OCR_HEURISTIC_THRESHOLDS.visualSeparatorMinDelta, threshold)) continue
    const normalizedY = index / profile.length
    if (normalizedY > 0.03 && normalizedY < 0.97) candidates.push(normalizedY)
  }
  return candidates.filter((value, index, all) => index === 0 || value - all[index - 1] > OCR_HEURISTIC_THRESHOLDS.visualSeparatorMinSpacing)
}

export function transactionEvidence(candidate: HeuristicCandidate) {
  let score = 0
  if (candidate.amount !== undefined) score += 2
  if (candidate.occurredAt) score += 2
  if (candidate.merchant) score += 1
  if (candidate.description) score += 1
  if (candidate.balanceAfter !== undefined) score += 1
  return score
}

export function isStrongTransactionBlock(candidate: HeuristicCandidate, confidence: number, hasTemplate: boolean) {
  const evidence = transactionEvidence(candidate)
  return hasTemplate
    ? evidence >= OCR_HEURISTIC_THRESHOLDS.templateBlockMinEvidence && confidence >= OCR_HEURISTIC_THRESHOLDS.templateBlockMinConfidence
    : evidence >= OCR_HEURISTIC_THRESHOLDS.genericBlockMinEvidence && confidence >= OCR_HEURISTIC_THRESHOLDS.genericBlockMinConfidence
}

export function bboxOverlapRatio(left?: { y: number; height: number }, right?: { y: number; height: number }) {
  if (!left || !right) return 0
  const start = Math.max(left.y, right.y)
  const end = Math.min(left.y + left.height, right.y + right.height)
  const overlap = Math.max(0, end - start)
  return overlap / Math.max(1, Math.min(left.height, right.height))
}

export function isCredibleTemplateMatch(evidence: TemplateRankEvidence | undefined) {
  if (!evidence) return false
  return (evidence.score ?? 0) >= OCR_HEURISTIC_THRESHOLDS.templateMinScore
    && (
      (evidence.anchorScore ?? 0) >= OCR_HEURISTIC_THRESHOLDS.templateMinAnchorScore
      || (evidence.visualScore ?? 0) >= OCR_HEURISTIC_THRESHOLDS.templateMinVisualScore
    )
}

export function canAutoLearnTemplate(templateScore: number | undefined, mappedFields: string[]) {
  if ((templateScore ?? 0) < OCR_HEURISTIC_THRESHOLDS.autoLearnMinTemplateScore) return false
  const fields = new Set(mappedFields.filter(Boolean))
  if (fields.size < 2) return false
  return fields.has('amount') || fields.has('occurredAt')
}

export function dedupeTransactionBlocks<T extends HeuristicBlock>(detected: T[]) {
  const deduped: T[] = []
  for (const block of [...detected].sort((a, b) => a.bbox.y - b.bbox.y)) {
    const duplicateIndex = deduped.findIndex((existing) => {
      if (bboxOverlapRatio(existing.bbox, block.bbox) < OCR_HEURISTIC_THRESHOLDS.dedupeBlockMinOverlap) return false
      const sameAmount = existing.candidate.amount !== undefined
        && block.candidate.amount !== undefined
        && Math.abs(existing.candidate.amount - block.candidate.amount) <= 0.01
      const leftTime = existing.candidate.occurredAt ? Date.parse(existing.candidate.occurredAt) : Number.NaN
      const rightTime = block.candidate.occurredAt ? Date.parse(block.candidate.occurredAt) : Number.NaN
      const sameTime = Number.isFinite(leftTime) && Number.isFinite(rightTime)
        ? Math.abs(leftTime - rightTime) <= 2 * 60_000
        : !existing.candidate.occurredAt && !block.candidate.occurredAt
      return sameAmount && sameTime
    })
    if (duplicateIndex < 0) deduped.push(block)
    else if (block.confidence > deduped[duplicateIndex].confidence) deduped[duplicateIndex] = block
  }
  return deduped
}
