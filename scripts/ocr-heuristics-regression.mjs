import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const outDir = path.join(root, '.tmp', 'ocr-heuristics-regression')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const tsc = process.platform === 'win32'
  ? path.join(root, 'node_modules', '.bin', 'tsc.cmd')
  : path.join(root, 'node_modules', '.bin', 'tsc')

execFileSync(tsc, [
  'src/lib/ocrHeuristics.ts',
  'src/lib/ocrParsing.ts',
  '--ignoreConfig',
  '--target', 'ES2022',
  '--module', 'ESNext',
  '--moduleResolution', 'Bundler',
  '--skipLibCheck',
  '--outDir', outDir,
], { cwd: root, stdio: 'inherit' })

const mod = await import(pathToFileURL(path.join(outDir, 'ocrHeuristics.js')).href + `?t=${Date.now()}`)
const parser = await import(pathToFileURL(path.join(outDir, 'ocrParsing.js')).href + `?t=${Date.now()}`)
const {
  OCR_HEURISTIC_THRESHOLDS,
  bboxOverlapRatio,
  canAutoLearnTemplate,
  dedupeTransactionBlocks,
  isCredibleTemplateMatch,
  sampleShape,
  shapeSimilarity,
  transactionEvidence,
  visualSeparatorPositions,
} = mod
const {
  normalizeOcrLine,
  parseDateTimeText,
  parseMoneyText,
  parseTransactionText,
  stripFieldLabel,
} = parser

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected}`)
}

// Semantic parsing fixtures cover common VI/EN banking text without image files.
assert.equal(normalizeOcrLine('  Số   tiền:   150.000 VND  '), 'Số tiền: 150.000 VND')
assert.equal(parseMoneyText('Số tiền: 1.250.000 VND'), 1250000)
assert.equal(parseMoneyText('Amount 1,250,000 VND'), 1250000)
assert.equal(parseMoneyText('- 99.000 đ'), 99000)
assert.equal(stripFieldLabel('Người nhận: NGUYEN VAN A', 'merchant'), 'NGUYEN VAN A')
assert.equal(stripFieldLabel('Description: Lunch', 'description'), 'Lunch')

const viDate = parseDateTimeText('21/09/2026 17:45')
assert.ok(viDate && !Number.isNaN(Date.parse(viDate)))
const viMonthDate = parseDateTimeText('21 thg 9, 2026 17:45')
assert.ok(viMonthDate && !Number.isNaN(Date.parse(viMonthDate)))
const enDate = parseDateTimeText('September 21, 2026 17:45')
assert.ok(enDate && !Number.isNaN(Date.parse(enDate)))
assert.equal(parseDateTimeText('31/02/2026 10:00'), undefined)

const transfer = parseTransactionText(`
Chuyển khoản
Số tiền: 1.250.000 VND
Người nhận: NGUYEN VAN A
Thời gian: 21/09/2026 17:45
Nội dung: tien an
Số dư sau giao dịch: 8.750.000 VND
`)
assert.equal(transfer.amount, 1250000)
assert.equal(transfer.merchant, 'NGUYEN VAN A')
assert.equal(transfer.description, 'tien an')
assert.equal(transfer.balanceAfter, 8750000)
assert.ok(transfer.occurredAt)
assert.ok(['expense', 'transfer'].includes(transfer.type))

const income = parseTransactionText(`
Incoming transfer
Amount: 500,000 VND
Recipient: JOHN DOE
Date & Time: 21 Sep 2026 10:30
Description: refund
`)
assert.equal(income.amount, 500000)
assert.equal(income.merchant, 'JOHN DOE')
assert.equal(income.description, 'refund')
assert.equal(income.type, 'income')

// Shape normalization stays layout-oriented instead of memorizing literal values.
assert.equal(sampleShape('NGUYEN VAN A 123456'), 'A A A 0')
assert.equal(sampleShape('Số tiền: 1.250.000 VND'), 'A A: 0.0.0 A')
assert.ok(shapeSimilarity('A A: 0 A', 'A A: 0 A') > 0.99)
assert.ok(shapeSimilarity('A A: 0 A', '0-0-0') < 0.35)

// Template credibility requires score plus either semantic or strong visual evidence.
assert.equal(isCredibleTemplateMatch({ score: 0.39, anchorScore: 1, visualScore: 1 }), false)
assert.equal(isCredibleTemplateMatch({ score: 0.50, anchorScore: 0.25, visualScore: 0.1 }), true)
assert.equal(isCredibleTemplateMatch({ score: 0.50, anchorScore: 0, visualScore: 0.70 }), true)
assert.equal(isCredibleTemplateMatch({ score: 0.50, anchorScore: 0.05, visualScore: 0.40 }), false)

// Auto-learning cannot poison a template from weak matches or weak corrections.
assert.equal(canAutoLearnTemplate(0.44, ['amount', 'merchant']), false)
assert.equal(canAutoLearnTemplate(0.80, ['merchant', 'description']), false)
assert.equal(canAutoLearnTemplate(0.80, ['amount', 'merchant']), true)
assert.equal(canAutoLearnTemplate(0.80, ['occurredAt', 'description']), true)

// Overlap preservation survives small segmentation drift but rejects unrelated blocks.
near(bboxOverlapRatio({ y: 100, height: 200 }, { y: 120, height: 190 }), 180 / 190)
assert.ok(bboxOverlapRatio({ y: 100, height: 200 }, { y: 180, height: 180 }) >= OCR_HEURISTIC_THRESHOLDS.preserveBlockMinOverlap)
assert.equal(bboxOverlapRatio({ y: 100, height: 100 }, { y: 230, height: 100 }), 0)

// Transaction evidence rewards canonical banking fields.
assert.equal(transactionEvidence({}), 0)
assert.equal(transactionEvidence({ amount: 100000 }), 2)
assert.equal(transactionEvidence({ amount: 100000, occurredAt: '2026-09-21T10:00:00.000Z' }), 4)
assert.equal(transactionEvidence({ amount: 100000, merchant: 'A', description: 'B', balanceAfter: 200000 }), 5)

// Synthetic visual profile: repeated hard card transitions must produce separators.
const profile = []
for (let card = 0; card < 8; card += 1) {
  const value = card % 2 === 0 ? 235 : 205
  for (let i = 0; i < 16; i += 1) profile.push(value)
}
const separators = visualSeparatorPositions({ verticalLumaProfile: profile })
assert.ok(separators.length >= 5, `expected repeated separators, got ${separators.length}`)
assert.ok(separators.every((value) => value > 0.03 && value < 0.97))

// Flat/noisy-but-low-amplitude surfaces should not hallucinate card boundaries.
const flat = Array.from({ length: 128 }, (_, index) => 220 + Math.sin(index) * 2)
assert.equal(visualSeparatorPositions({ verticalLumaProfile: flat }).length, 0)

// Overlapping detections of the same transaction collapse to the higher-confidence block.
const sameTime = '2026-09-21T10:00:00.000Z'
const deduped = dedupeTransactionBlocks([
  { candidate: { amount: 150000, occurredAt: sameTime }, bbox: { y: 100, height: 220 }, confidence: 70, id: 'low' },
  { candidate: { amount: 150000, occurredAt: '2026-09-21T10:01:00.000Z' }, bbox: { y: 120, height: 210 }, confidence: 91, id: 'high' },
  { candidate: { amount: 250000, occurredAt: sameTime }, bbox: { y: 115, height: 205 }, confidence: 95, id: 'different-amount' },
  { candidate: { amount: 150000, occurredAt: '2026-09-21T12:00:00.000Z' }, bbox: { y: 110, height: 205 }, confidence: 96, id: 'different-time' },
])
assert.equal(deduped.length, 3)
assert.ok(deduped.some((item) => item.id === 'high'))
assert.ok(!deduped.some((item) => item.id === 'low'))
assert.ok(deduped.some((item) => item.id === 'different-amount'))
assert.ok(deduped.some((item) => item.id === 'different-time'))

// Non-overlapping identical transactions are distinct rows in a long capture.
const separateRows = dedupeTransactionBlocks([
  { candidate: { amount: 150000, occurredAt: sameTime }, bbox: { y: 100, height: 150 }, confidence: 90, id: 'row-1' },
  { candidate: { amount: 150000, occurredAt: sameTime }, bbox: { y: 400, height: 150 }, confidence: 90, id: 'row-2' },
])
assert.equal(separateRows.length, 2)

fs.rmSync(outDir, { recursive: true, force: true })
console.log('OCR heuristic regression PASS')
