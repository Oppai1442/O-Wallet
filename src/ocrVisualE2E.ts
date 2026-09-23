import { buildDetectedLines, buildPatternTemplate, detectTransactionBlocks, rankOcrTemplates, recognizeImageTiled } from './lib/ocr'
import type { OcrField, OcrResult } from './types'

type OcrCalibrationField = Exclude<OcrField, 'ignore' | 'generic'>

type OcrCalibrationInput = {
  name: string
  base64: string
  mimeType?: string
  languages?: string[]
  tileHeight?: number
  overlap?: number
  expect?: {
    minBlocks?: number
    maxBlocks?: number
    minBoxes?: number
    expectedAmounts?: number[]
    minAmountHits?: number
    minAverageBlockConfidence?: number
  }
  template?: {
    sourceBlock?: number
    hints: Array<{ contains: string; field: OcrCalibrationField }>
    minBlocks?: number
    minScore?: number
    minAmountHits?: number
  }
}

type OcrCalibrationResult = {
  name: string
  width: number
  height: number
  boxes: number
  blocks: number
  amountCount: number
  amountHits: number
  averageBlockConfidence: number
  tileCount: number
  retryCount: number
  template?: {
    blocks: number
    score: number
    amountCount: number
    amountHits: number
  }
}

declare global {
  interface Window {
    __OWALLET_OCR_E2E__?: {
      status: 'running' | 'pass' | 'fail'
      phase?: string
      progress?: number
      scenarios?: Array<{
        name: string
        textLength: number
        boxes: number
        blocks: number
        templateBlocks: number
        templateScore: number
        amounts: number[]
        tileCount: number
        retryCount: number
      }>
      error?: string
    }
    __OWALLET_OCR_CALIBRATE__?: (input: OcrCalibrationInput) => Promise<OcrCalibrationResult>
  }
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('synthetic canvas encode failed')), 'image/png')
  })
}

async function syntheticCapture({
  cards,
  dark,
  jitter,
}: {
  cards: number
  dark: boolean
  jitter: number
}) {
  const width = 720
  const cardHeight = 600
  const top = 30
  const height = top * 2 + cards * cardHeight
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('canvas 2d unavailable')

  ctx.fillStyle = dark ? '#111827' : '#f3f4f6'
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'top'

  for (let index = 0; index < cards; index += 1) {
    const y = top + index * cardHeight
    const shift = ((index % 3) - 1) * jitter
    ctx.fillStyle = dark ? '#1f2937' : '#ffffff'
    ctx.fillRect(24 + shift, y + 8, width - 48, cardHeight - 20)

    ctx.fillStyle = dark ? '#f9fafb' : '#111827'
    ctx.font = '700 28px Arial, sans-serif'
    ctx.fillText('Date:', 52 + shift, y + 65)
    ctx.font = '27px Arial, sans-serif'
    ctx.fillText(`21/09/2026 10:${String(10 + index).padStart(2, '0')}`, 180 + shift, y + 65)

    ctx.font = '700 28px Arial, sans-serif'
    ctx.fillText('Amount:', 52 + shift, y + 190)
    ctx.font = '30px Arial, sans-serif'
    ctx.fillText(`${(index + 1) * 100000} VND`, 190 + shift, y + 188)

    ctx.font = '700 27px Arial, sans-serif'
    ctx.fillText('Recipient:', 52 + shift, y + 315)
    ctx.font = '26px Arial, sans-serif'
    ctx.fillText(`TEST USER ${index + 1}`, 205 + shift, y + 315)

    ctx.font = '700 26px Arial, sans-serif'
    ctx.fillText('Description:', 52 + shift, y + 440)
    ctx.font = '25px Arial, sans-serif'
    ctx.fillText(`PAYMENT ${index + 1}`, 235 + shift, y + 440)

    ctx.strokeStyle = dark ? '#6b7280' : '#d1d5db'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(42, y + cardHeight - 22)
    ctx.lineTo(width - 42, y + cardHeight - 22)
    ctx.stroke()
  }

  return { blob: await canvasBlob(canvas), width, height }
}

function expectedAmountHits(amounts: number[], cards: number) {
  const expected = new Set(Array.from({ length: cards }, (_, index) => (index + 1) * 100000))
  return amounts.filter((amount) => expected.has(Math.round(amount))).length
}


function calibrationBlob(base64: string, mimeType = 'image/png') {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mimeType })
}

function calibrationAmountHits(actual: number[], expected: number[]) {
  const used = new Set<number>()
  let hits = 0
  for (const target of expected) {
    const match = actual.findIndex((value, index) => !used.has(index) && Math.abs(value - target) <= 0.01)
    if (match >= 0) {
      used.add(match)
      hits += 1
    }
  }
  return hits
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function assertMinimum(name: string, label: string, actual: number, expected?: number) {
  if (expected !== undefined && actual < expected) throw new Error(`${name}: ${label} below expectation (${actual}/${expected})`)
}

function assertMaximum(name: string, label: string, actual: number, expected?: number) {
  if (expected !== undefined && actual > expected) throw new Error(`${name}: ${label} above expectation (${actual}/${expected})`)
}

function resultForCalibrationBlock(result: OcrResult, y: number, height: number) {
  const y0 = Math.max(0, y)
  const y1 = Math.max(y0 + 1, y + height)
  const boxes = result.boxes.filter((box) => {
    const center = (box.bbox.y0 + box.bbox.y1) / 2
    return center >= y0 && center <= y1
  }).map((box) => ({
    ...box,
    bbox: {
      ...box.bbox,
      y0: box.bbox.y0 - y0,
      y1: box.bbox.y1 - y0,
    },
  }))
  return {
    text: boxes.map((box) => box.text).join(' '),
    boxes,
  }
}

async function runOcrCalibrationCase(input: OcrCalibrationInput): Promise<OcrCalibrationResult> {
  const name = input.name?.trim()
  if (!name) throw new Error('calibration case requires a name')
  if (!input.base64) throw new Error(`${name}: fixture payload is empty`)

  const languages = input.languages?.map((language) => language.trim()).filter(Boolean)
  const ocr = await recognizeImageTiled(calibrationBlob(input.base64, input.mimeType), undefined, {
    tileHeight: input.tileHeight,
    overlap: input.overlap,
    retries: 1,
    watchdogMs: 45_000,
    workerInitTimeoutMs: 30_000,
    languages: languages?.length ? languages : ['vie', 'eng'],
    langPath: new URL('./tessdata', window.location.href).href,
  })

  const blocks = detectTransactionBlocks(ocr.result, ocr.width, ocr.height, undefined, ocr.visual)
  const amounts = blocks.flatMap((block) => block.candidate.amount !== undefined ? [block.candidate.amount] : [])
  const expectedAmounts = input.expect?.expectedAmounts ?? []
  const amountHits = calibrationAmountHits(amounts, expectedAmounts)
  const averageBlockConfidence = average(blocks.map((block) => block.confidence))

  assertMinimum(name, 'OCR boxes', ocr.result.boxes.length, input.expect?.minBoxes)
  assertMinimum(name, 'transaction blocks', blocks.length, input.expect?.minBlocks)
  assertMaximum(name, 'transaction blocks', blocks.length, input.expect?.maxBlocks)
  assertMinimum(name, 'average block confidence', averageBlockConfidence, input.expect?.minAverageBlockConfidence)
  if (expectedAmounts.length) {
    assertMinimum(name, 'expected amount hits', amountHits, input.expect?.minAmountHits ?? expectedAmounts.length)
  }

  let templateResult: OcrCalibrationResult['template']
  if (input.template) {
    const sourceIndex = Math.max(0, Math.floor(input.template.sourceBlock ?? 0))
    const sourceBlock = blocks[sourceIndex]
    if (!sourceBlock) throw new Error(`${name}: template source block is unavailable`)

    const sourceResult = resultForCalibrationBlock(ocr.result, sourceBlock.bbox.y, sourceBlock.bbox.height)
    const sourceLines = buildDetectedLines(sourceResult, ocr.width, Math.max(1, sourceBlock.bbox.height))
    const mappings: Record<string, OcrField | ''> = {}
    for (const line of sourceLines) {
      const text = line.text.toLocaleLowerCase('vi-VN')
      const hint = input.template.hints.find((candidate) => {
        const needle = candidate.contains.trim().toLocaleLowerCase('vi-VN')
        return needle.length > 0 && text.includes(needle)
      })
      if (hint) mappings[line.id] = hint.field
    }
    if (Object.values(mappings).filter(Boolean).length < 2) {
      throw new Error(`${name}: template hints matched fewer than two OCR lines`)
    }

    const template = buildPatternTemplate(`Calibration ${name}`, sourceLines, mappings, ocr.visual)
    const ranked = rankOcrTemplates([template], ocr.result, ocr.width, ocr.height, ocr.visual)[0]
    if (!ranked) throw new Error(`${name}: template ranking returned no result`)

    const templateBlocks = detectTransactionBlocks(ocr.result, ocr.width, ocr.height, template, ocr.visual)
    const templateAmounts = templateBlocks.flatMap((block) => block.candidate.amount !== undefined ? [block.candidate.amount] : [])
    const templateAmountHits = calibrationAmountHits(templateAmounts, expectedAmounts)
    assertMinimum(name, 'template blocks', templateBlocks.length, input.template.minBlocks)
    assertMinimum(name, 'template score', ranked.score, input.template.minScore)
    if (expectedAmounts.length) {
      assertMinimum(name, 'template expected amount hits', templateAmountHits, input.template.minAmountHits ?? expectedAmounts.length)
    }
    templateResult = {
      blocks: templateBlocks.length,
      score: ranked.score,
      amountCount: templateAmounts.length,
      amountHits: templateAmountHits,
    }
  }

  return {
    name,
    width: ocr.width,
    height: ocr.height,
    boxes: ocr.result.boxes.length,
    blocks: blocks.length,
    amountCount: amounts.length,
    amountHits,
    averageBlockConfidence,
    tileCount: ocr.diagnostics.tileCount,
    retryCount: ocr.diagnostics.retryCount,
    template: templateResult,
  }
}

export function mountOcrCalibrationHarness(root: HTMLElement) {
  window.__OWALLET_OCR_E2E__ = undefined
  window.__OWALLET_OCR_CALIBRATE__ = runOcrCalibrationCase
  const main = document.createElement('main')
  main.style.fontFamily = 'system-ui'
  main.style.padding = '24px'
  const title = document.createElement('h1')
  title.textContent = 'O-Wallet OCR calibration harness'
  const status = document.createElement('p')
  status.id = 'status'
  status.textContent = 'Ready for sanitized real-world fixtures.'
  main.append(title, status)
  root.replaceChildren(main)
}

async function runScenario(name: string, cards: number, dark: boolean, jitter: number) {
  window.__OWALLET_OCR_E2E__ = { status: 'running', phase: `${name}:fixture` }
  const source = await syntheticCapture({ cards, dark, jitter })
  window.__OWALLET_OCR_E2E__ = { status: 'running', phase: `${name}:ocr`, progress: 0 }
  const ocr = await recognizeImageTiled(source.blob, (progress, status) => {
    window.__OWALLET_OCR_E2E__ = { status: 'running', phase: `${name}:ocr:${status}`, progress }
  }, {
    tileHeight: 900,
    overlap: 120,
    retries: 0,
    watchdogMs: 35_000,
    workerInitTimeoutMs: 30_000,
    languages: ['eng'],
    langPath: new URL('./tessdata', window.location.href).href,
  })
  window.__OWALLET_OCR_E2E__ = { status: 'running', phase: `${name}:segment`, progress: 1 }
  const blocks = detectTransactionBlocks(ocr.result, ocr.width, ocr.height, undefined, ocr.visual)
  const amounts = blocks.flatMap((block) => block.candidate.amount !== undefined ? [block.candidate.amount] : [])
  const hits = expectedAmountHits(amounts, cards)

  if (ocr.diagnostics.tileCount < 2) throw new Error(`${name}: tiled path not exercised`)
  if (ocr.result.boxes.length < cards * 6) throw new Error(`${name}: too few OCR boxes (${ocr.result.boxes.length})`)
  if (blocks.length < 2) throw new Error(`${name}: too few transaction blocks (${blocks.length}/${cards})`)
  if (hits < 2) throw new Error(`${name}: too few expected amount hits (${hits}/${cards})`)

  window.__OWALLET_OCR_E2E__ = { status: 'running', phase: `${name}:template`, progress: 1 }
  const firstCardHeight = Math.min(source.height, 600)
  const firstBoxes = ocr.result.boxes.filter((box) => ((box.bbox.y0 + box.bbox.y1) / 2) < firstCardHeight)
  const firstResult: OcrResult = {
    text: firstBoxes.map((box) => box.text).join(' '),
    boxes: firstBoxes,
  }
  const firstLines = buildDetectedLines(firstResult, ocr.width, firstCardHeight)
  const mappings: Record<string, OcrField | ''> = {}
  for (const line of firstLines) {
    const text = line.text.toLowerCase()
    if (text.includes('amount')) mappings[line.id] = 'amount'
    else if (text.includes('date')) mappings[line.id] = 'occurredAt'
    else if (text.includes('recipient')) mappings[line.id] = 'merchant'
    else if (text.includes('description')) mappings[line.id] = 'description'
  }
  if (Object.values(mappings).filter(Boolean).length < 2) throw new Error(`${name}: could not teach synthetic template from OCR lines`)

  const template = buildPatternTemplate('Synthetic Bank', firstLines, mappings, ocr.visual)
  const ranked = rankOcrTemplates([template], ocr.result, ocr.width, ocr.height, ocr.visual)[0]
  if (!ranked || ranked.score <= 0) throw new Error(`${name}: template ranking failed`)
  const templateBlocks = detectTransactionBlocks(ocr.result, ocr.width, ocr.height, template, ocr.visual)
  const templateAmounts = templateBlocks.flatMap((block) => block.candidate.amount !== undefined ? [block.candidate.amount] : [])
  if (templateBlocks.length < 2) throw new Error(`${name}: template path found too few blocks (${templateBlocks.length}/${cards})`)
  if (expectedAmountHits(templateAmounts, cards) < 2) throw new Error(`${name}: template path missed expected amounts`)

  return {
    name,
    textLength: ocr.result.text.length,
    boxes: ocr.result.boxes.length,
    blocks: blocks.length,
    templateBlocks: templateBlocks.length,
    templateScore: ranked.score,
    amounts: templateAmounts,
    tileCount: ocr.diagnostics.tileCount,
    retryCount: ocr.diagnostics.retryCount,
  }
}

export async function runOcrVisualE2E(root: HTMLElement) {
  window.__OWALLET_OCR_E2E__ = { status: 'running', phase: 'boot', progress: 0 }
  const main = document.createElement('main')
  main.style.fontFamily = 'system-ui'
  main.style.padding = '24px'
  const title = document.createElement('h1')
  title.textContent = 'O-Wallet OCR visual E2E'
  const statusNode = document.createElement('p')
  statusNode.id = 'status'
  statusNode.textContent = 'Running synthetic OCR…'
  main.append(title, statusNode)
  root.replaceChildren(main)
  try {
    const scenarios = []
    scenarios.push(await runScenario('tiled-light', 2, false, 12))
    window.__OWALLET_OCR_E2E__ = { status: 'pass', scenarios }
    const status = document.getElementById('status')
    if (status) status.textContent = 'PASS'
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error)
    window.__OWALLET_OCR_E2E__ = { status: 'fail', error: message }
    const status = document.getElementById('status')
    if (status) status.textContent = `FAIL: ${message}`
  }
}
