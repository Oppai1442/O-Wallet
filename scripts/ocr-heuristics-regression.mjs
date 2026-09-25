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
  'src/lib/fileFingerprint.ts',
  'src/lib/ocrCheckpoint.ts',
  'src/lib/importIdentity.ts',
  'src/lib/checkpointCodec.ts',
  '--ignoreConfig',
  '--target', 'ES2022',
  '--module', 'ESNext',
  '--moduleResolution', 'Bundler',
  '--skipLibCheck',
  '--outDir', outDir,
], { cwd: root, stdio: 'inherit' })

function findCompiled(name, dir = outDir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = findCompiled(name, target)
      if (nested) return nested
    } else if (entry.name === name) return target
  }
  return undefined
}

const heuristicFile = findCompiled('ocrHeuristics.js')
const parserFile = findCompiled('ocrParsing.js')
const fingerprintFile = findCompiled('fileFingerprint.js')
const checkpointFile = findCompiled('ocrCheckpoint.js')
const importIdentityFile = findCompiled('importIdentity.js')
const checkpointCodecFile = findCompiled('checkpointCodec.js')
assert.ok(heuristicFile, 'compiled ocrHeuristics.js not found')
assert.ok(parserFile, 'compiled ocrParsing.js not found')
assert.ok(fingerprintFile, 'compiled fileFingerprint.js not found')
assert.ok(checkpointFile, 'compiled ocrCheckpoint.js not found')
assert.ok(importIdentityFile, 'compiled importIdentity.js not found')
assert.ok(checkpointCodecFile, 'compiled checkpointCodec.js not found')

const mod = await import(pathToFileURL(heuristicFile).href + `?t=${Date.now()}`)
const parser = await import(pathToFileURL(parserFile).href + `?t=${Date.now()}`)
const fingerprintModule = await import(pathToFileURL(fingerprintFile).href + `?t=${Date.now()}`)
const checkpointModule = await import(pathToFileURL(checkpointFile).href + `?t=${Date.now()}`)
const importIdentityModule = await import(pathToFileURL(importIdentityFile).href + `?t=${Date.now()}`)
const checkpointCodecModule = await import(pathToFileURL(checkpointCodecFile).href + `?t=${Date.now()}`)
const {
  OCR_HEURISTIC_THRESHOLDS,
  bboxOverlapRatio,
  canAutoLearnTemplate,
  chooseOcrTileHeight,
  dedupeTransactionBlocks,
  isCredibleTemplateMatch,
  isOcrPatternQuarantined,
  isStrongTransactionBlock,
  ocrPatternReliability,
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

const { sourceFingerprint } = fingerprintModule
const { sanitizeOcrTileResumeState, sanitizeOcrTileResumeMap } = checkpointModule
const { buildImageImportBlockRowId, buildImageImportSemanticRowId, canonicalImageImportTransaction, imageImportBlockFingerprint, imageImportImageId, imageImportRecordId, imageImportTransactionHash, importSourcesMatch, sourceIdsMatch } = importIdentityModule
const { decodeCheckpointValue, encodeCheckpointValue, isCompressedCheckpoint } = checkpointCodecModule

const smallCheckpoint = { version: 2, drafts: [{ id: 'one', amount: '100000' }] }
const encodedSmallCheckpoint = await encodeCheckpointValue(smallCheckpoint, 12 * 1024 * 1024, 64 * 1024 * 1024)
assert.equal(isCompressedCheckpoint(encodedSmallCheckpoint), false, 'small checkpoints should avoid compression overhead')
assert.deepEqual(await decodeCheckpointValue(encodedSmallCheckpoint, 64 * 1024 * 1024), smallCheckpoint)

const largeCheckpoint = { version: 2, text: 'transaction-row-'.repeat(40_000) }
const encodedLargeCheckpoint = await encodeCheckpointValue(largeCheckpoint, 12 * 1024 * 1024, 64 * 1024 * 1024)
if (typeof CompressionStream !== 'undefined') {
  assert.equal(isCompressedCheckpoint(encodedLargeCheckpoint), true, 'large repetitive checkpoints should be compressed')
  assert.ok(encodedLargeCheckpoint.byteLength < JSON.stringify(largeCheckpoint).length / 10)
}
assert.deepEqual(await decodeCheckpointValue(encodedLargeCheckpoint, 64 * 1024 * 1024), largeCheckpoint)


const canonicalSigA = buildImageImportSemanticRowId({type:'expense',amount:100000,occurredAt:'2026-09-21T10:00:00.000Z',merchant:'  Nguyễn   Văn A '})
const canonicalSigB = buildImageImportSemanticRowId({type:'expense',amount:100000.0,occurredAt:'2026-09-21T10:00:00.000Z',merchant:'nguyễn văn a'})
assert.equal(canonicalSigA, canonicalSigB, 'semantic row signatures should canonicalize case and whitespace')
assert.notEqual(canonicalSigA, buildImageImportSemanticRowId({type:'expense',amount:200000,occurredAt:'2026-09-21T10:00:00.000Z',merchant:'nguyễn văn a'}))
assert.notEqual(canonicalSigA, buildImageImportSemanticRowId({type:'expense',amount:100000,occurredAt:'2026-09-21T10:01:00.000Z',merchant:'nguyễn văn a'}))

const canonicalTxA = canonicalImageImportTransaction({type:'transfer',amount:5000000,currency:'vnd',occurredAt:'2026-09-25T13:42:10.000Z',accountId:'main',merchant:' Nguyễn  Văn A ',description:'Chuyển tiền'})
const canonicalTxB = canonicalImageImportTransaction({type:'transfer',amount:5000000.0,currency:'VND',occurredAt:'2026-09-25T13:42:59.000Z',accountId:'main',merchant:'nguyen van a',description:'chuyen tien'})
assert.equal(canonicalTxA, canonicalTxB, 'transaction conflict canonicalization should ignore accents, case, spacing and seconds')
assert.equal(await imageImportTransactionHash({type:'transfer',amount:5000000,currency:'VND',occurredAt:'2026-09-25T13:42:10.000Z',accountId:'main',merchant:'NGUYEN VAN A',description:'CHUYEN TIEN'}), await imageImportTransactionHash({type:'transfer',amount:5000000,currency:'vnd',occurredAt:'2026-09-25T13:42:59.000Z',accountId:'main',merchant:'Nguyễn Văn A',description:'Chuyển tiền'}))
assert.notEqual(await imageImportTransactionHash({type:'transfer',amount:5000000,currency:'VND',occurredAt:'2026-09-25T13:42:10.000Z',accountId:'main',merchant:'A'}), await imageImportTransactionHash({type:'transfer',amount:6000000,currency:'VND',occurredAt:'2026-09-25T13:42:10.000Z',accountId:'main',merchant:'A'}))

const blockFpA = imageImportBlockFingerprint('  Amount: 100.000 VND\nRecipient: NGUYEN VAN A  ')
const blockFpB = imageImportBlockFingerprint('amount: 100.000 vnd recipient: nguyen van a')
assert.equal(blockFpA, blockFpB, 'raw block fingerprints should normalize case and whitespace')
const blockRow0 = buildImageImportBlockRowId('Amount: 100.000 VND Recipient: NGUYEN VAN A', 0)
const blockRow1 = buildImageImportBlockRowId('Amount: 100.000 VND Recipient: NGUYEN VAN A', 1)
assert.notEqual(blockRow0, blockRow1, 'identical OCR blocks must remain distinct by occurrence')

const importBase = { adapterId:'owallet-image-v2', sourceId:'sample-sha256-v1:10:' + 'a'.repeat(64) }
assert.equal(importSourcesMatch(
  {...importBase,sourceRowIds:['row:1','sig:expense:100:2026-09-21T10:00:00.000Z:cafe']},
  {...importBase,sourceRowIds:['row:1','sig:expense:200:2026-09-21T10:00:00.000Z:shop']},
), false, 'semantic signatures must override matching ordinal rows')
assert.equal(importSourcesMatch(
  {...importBase,sourceRowIds:['row:1','sig:expense:100:2026-09-21T10:00:00.000Z:cafe']},
  {...importBase,sourceRowIds:['row:8','sig:expense:100:2026-09-21T10:00:00.000Z:cafe']},
), true, 'matching semantic signatures must survive row reordering')
assert.equal(importSourcesMatch(
  {...importBase,sourceRowIds:['row:1','sig:expense:100:2026-09-21T10:00:00.000Z:cafe','occ:0']},
  {...importBase,sourceRowIds:['row:8','sig:expense:100:2026-09-21T10:00:00.000Z:cafe','occ:1']},
), false, 'identical semantic rows with different occurrences must stay distinct')
assert.equal(importSourcesMatch(
  {...importBase,sourceRowIds:['row:1','sig:expense:100:old-value','occ:0',blockRow0]},
  {...importBase,sourceRowIds:['row:9','sig:expense:999:corrected-value','occ:0',blockRow0]},
), true, 'matching raw block provenance should survive semantic corrections')
assert.equal(importSourcesMatch(
  {...importBase,sourceRowIds:['row:1','sig:expense:100:same','occ:0',blockRow0]},
  {...importBase,sourceRowIds:['row:2','sig:expense:100:same','occ:1',blockRow1]},
), false, 'raw block occurrence must prevent collapsing identical rows')
assert.equal(importSourcesMatch(
  {...importBase,sourceRowIds:['sig:expense:100:2026-09-21T10:00:00.000Z:cafe']},
  {...importBase,sourceRowIds:['row:8','sig:expense:100:2026-09-21T10:00:00.000Z:cafe','occ:1']},
), true, 'legacy semantic identities without occurrence remain backward compatible')
assert.equal(importSourcesMatch(
  {...importBase,sourceRowIds:['row:1']},
  {...importBase,sourceRowIds:['row:1','sig:expense:100:2026-09-21T10:00:00.000Z:cafe']},
), true, 'legacy ordinal identities remain backward compatible')
assert.equal(importSourcesMatch(
  {...importBase,sourceRowIds:['row:1']},
  {...importBase,sourceId:'different',sourceRowIds:['row:1']},
), false)
const validResume = {
  width:1080,height:80000,tileHeight:2000,overlap:200,nextTileIndex:3,
  boxes:[{text:'100.000 VND',confidence:90,bbox:{x0:10,y0:100,x1:300,y1:140}}],
  texts:['100.000 VND'],
  visualColors:[['32,32,32',12]],
  visualProfileSum:Array(834).fill(10),
  visualProfileCount:Array(834).fill(1),
  visualLuma:1200,visualCount:10,retryCount:0,tileDurationsMs:[1000,1100,900],startedAt:'2026-09-21T00:00:00.000Z'
}
assert.ok(sanitizeOcrTileResumeState(validResume), 'valid resume state should survive sanitization')
assert.equal(sanitizeOcrTileResumeState({...validResume,visualProfileCount:[1]}), undefined, 'profile length mismatch must be rejected')
assert.equal(sanitizeOcrTileResumeState({...validResume,boxes:[{...validResume.boxes[0],bbox:{x0:0,y0:0,x1:Number.NaN,y1:20}}]}), undefined, 'NaN bbox must be rejected')
assert.equal(sanitizeOcrTileResumeState({...validResume,boxes:[{...validResume.boxes[0],bbox:{x0:0,y0:0,x1:999999,y1:20}}]}), undefined, 'extreme bbox must be rejected')
const goodKey='sample-sha256-v1:123:'+ 'a'.repeat(64)
assert.deepEqual(Object.keys(sanitizeOcrTileResumeMap({[goodKey]:validResume})), [goodKey])
const compositeKey = 'sha256-v2:123:' + 'b'.repeat(64) + '|' + goodKey
assert.deepEqual(Object.keys(sanitizeOcrTileResumeMap({[compositeKey]:validResume})), [compositeKey])
assert.equal(Object.keys(sanitizeOcrTileResumeMap({'not-a-source-key':validResume})).length, 0)

const fpA = await sourceFingerprint(new Blob([new Uint8Array([1,2,3,4,5])]))
const fpB = await sourceFingerprint(new Blob([new Uint8Array([1,2,3,4,5])]))
const fpChanged = await sourceFingerprint(new Blob([new Uint8Array([1,2,3,4,6])]))
const fpLonger = await sourceFingerprint(new Blob([new Uint8Array([1,2,3,4,5,0])]))
assert.equal(fpA, fpB, 'same source must have stable fingerprint')
assert.notEqual(fpA, fpChanged, 'content changes must alter source fingerprint')
assert.notEqual(fpA, fpLonger, 'size changes must alter source fingerprint')
assert.ok(fpA.startsWith('sha256-v2:'), 'ordinary files should use strong SHA-256 as primary fingerprint')
assert.ok(fpA.includes('|sample-sha256-v1:'), 'ordinary files should retain the legacy sampled fingerprint alias')
const legacyAlias = fpA.split('|')[1]
assert.ok(legacyAlias)
assert.equal(sourceIdsMatch(fpA, legacyAlias), true, 'composite fingerprints must match their legacy alias')
assert.equal(sourceIdsMatch(legacyAlias, fpA), true, 'source alias matching must be symmetric')
const deterministicImageA = await imageImportImageId(fpA)
const deterministicImageB = await imageImportImageId(legacyAlias)
assert.equal(deterministicImageA, deterministicImageB, 'image ids must survive source fingerprint upgrades')
assert.match(deterministicImageA, /^ocr-image-[a-f0-9]{32}$/)
assert.equal(importSourcesMatch(
  {adapterId:'owallet-image-v2',sourceId:legacyAlias,sourceRowIds:['row:1']},
  {adapterId:'owallet-image-v2',sourceId:fpA,sourceRowIds:['row:1']},
), true, 'legacy transactions must match upgraded composite source ids')
const deterministicRow = ['row:3', 'sig:expense:100000:2026-09-21T10:00:00.000Z:cafe']
const deterministicA = await imageImportRecordId(fpA, deterministicRow)
const deterministicB = await imageImportRecordId(legacyAlias, [...deterministicRow].reverse())
assert.equal(deterministicA, deterministicB, 'record ids must survive fingerprint upgrades and row ordering')
assert.match(deterministicA, /^ocr-[a-f0-9]{32}$/)
assert.notEqual(deterministicA, await imageImportRecordId(fpA, ['sig:expense:200000:2026-09-21T10:00:00.000Z:cafe']))
assert.notEqual(
  await imageImportRecordId(fpA, ['sig:expense:100000:2026-09-21T10:00:00.000Z:cafe','occ:0']),
  await imageImportRecordId(fpA, ['sig:expense:100000:2026-09-21T10:00:00.000Z:cafe','occ:1']),
  'occurrence must disambiguate otherwise identical imported transactions',
)

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
assert.equal(transfer.type, 'transfer')

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

const accountNearAmount = parseTransactionText(`
Người nhận: TEST USER
Số tài khoản: 012345678901
Số tiền
250.000 VND
Thời gian: 21/09/2026 10:30
Nội dung: test
`)
assert.equal(accountNearAmount.amount, 250000, 'account number must not become transaction amount')

const referenceBeforeAmount = parseTransactionText(`
Reference: 987654321012345
Amount: + 75,000 VND
Date & Time: 21 Sep 2026 11:30
Description: payment
`)
assert.equal(referenceBeforeAmount.amount, 75000, 'reference ID must not outrank signed/currency amount')

// Deterministic parser fuzz: common bank formatting variants must converge.
const moneyVariants = [
  ['1.000 VND', 1000],
  ['1,000 VND', 1000],
  ['1 000 VND', 1000],
  ['250.000 VNĐ', 250000],
  ['250,000 đ', 250000],
  ['+ 1.250.000 VND', 1250000],
  ['-1,250,000 VND', 1250000],
]
for (const [text, expected] of moneyVariants) assert.equal(parseMoneyText(String(text)), expected)

const labelVariants = [
  'Số tiền: 250.000 VND',
  'So tien - 250.000 VND',
  'Amount: 250,000 VND',
  'Transaction amount 250,000 VND',
]
for (const line of labelVariants) {
  const parsed = parseTransactionText(`${line}\nThời gian: 21/09/2026 10:30\nNgười nhận: TEST`)
  assert.equal(parsed.amount, 250000, `amount variant failed: ${line}`)
}

const dateVariants = [
  '21/09/2026 10:30',
  '21-09-2026 10:30',
  '10:30 21/09/2026',
  '21 thg 9, 2026 10:30',
  '21 Sep 2026 10:30',
  'September 21, 2026 10:30',
]
for (const value of dateVariants) assert.ok(parseDateTimeText(value), `date variant failed: ${value}`)

for (const whitespace of [' ', '  ', '\t']) {
  const parsed = parseTransactionText(`Số tiền:${whitespace}99.000 VND\nNgười nhận:${whitespace}ABC\nThời gian:${whitespace}21/09/2026 10:30`)
  assert.equal(parsed.amount, 99000)
  assert.equal(parsed.merchant, 'ABC')
}

for (const identifier of ['012345678901', '987654321012345', '0000111122223333']) {
  const parsed = parseTransactionText(`Reference: ${identifier}\nAmount: 88,000 VND\nDate & Time: 21 Sep 2026 11:30\nDescription: test`)
  assert.equal(parsed.amount, 88000, `identifier confused with amount: ${identifier}`)
}

// Shape normalization stays layout-oriented instead of memorizing literal values.
assert.equal(sampleShape('NGUYEN VAN A 123456'), 'A A A 0')
assert.equal(sampleShape('Số tiền: 1.250.000 VND'), 'A A: 0.0.0 A')
assert.ok(shapeSimilarity('A A: 0 A', 'A A: 0 A') > 0.99)
assert.ok(shapeSimilarity('A A: 0 A', '0-0-0') < 0.35)

// Pattern reliability uses smoothed success/failure evidence and stays bounded.
near(ocrPatternReliability(0, 0), 0.5)
assert.ok(ocrPatternReliability(12, 1) > ocrPatternReliability(1, 12))
assert.ok(ocrPatternReliability(100, 0) < 1)
assert.ok(ocrPatternReliability(0, 100) > 0)
near(ocrPatternReliability(Number.NaN, -5), 0.5)
assert.equal(isOcrPatternQuarantined(0, 2), false)
assert.equal(isOcrPatternQuarantined(0, 3), true)
assert.equal(isOcrPatternQuarantined(5, 3), false)

// Adaptive tile policy stays bounded and scales down for weak devices/wide/very long images.
assert.equal(chooseOcrTileHeight(1080, 2400, 2), 1400)
assert.equal(chooseOcrTileHeight(1080, 2400, 8), 3200)
assert.ok(chooseOcrTileHeight(2400, 2400, 4) < chooseOcrTileHeight(1080, 2400, 4))
assert.ok(chooseOcrTileHeight(1080, 80000, 4) < chooseOcrTileHeight(1080, 20000, 4))
assert.equal(chooseOcrTileHeight(1080, 80000, 4, 500), 900)
assert.equal(chooseOcrTileHeight(1080, 80000, 4, 9000), 4200)

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

// Block acceptance rejects footer/header fragments and low-confidence noise.
assert.equal(isStrongTransactionBlock({ occurredAt: '2026-09-21T10:00:00.000Z' }, 90, false), false)
assert.equal(isStrongTransactionBlock({ amount: 100000 }, 90, false), false)
assert.equal(isStrongTransactionBlock({ amount: 100000, merchant: 'Cafe' }, 30, false), true)
assert.equal(isStrongTransactionBlock({ amount: 100000 }, 30, true), true)
assert.equal(isStrongTransactionBlock({ amount: 100000 }, 10, true), false)

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
