import type { Worker } from 'tesseract.js'
import type {
  OcrBox,
  OcrDetectedLine,
  OcrField,
  OcrFieldEvidence,
  OcrFieldPattern,
  OcrRegion,
  OcrResult,
  OcrRuntimeDiagnostics,
  OcrTileResumeState,
  OcrTemplate,
  OcrTransactionBlock,
  OcrVisualFingerprint,
  ParsedTransactionCandidate,
} from '../types'
import { chooseOcrTileHeight, dedupeTransactionBlocks, isStrongTransactionBlock, sampleShape, shapeSimilarity, visualSeparatorPositions } from './ocrHeuristics'
import { normalizeOcrLine as normalizeLine, parseDateTimeText, parseMoneyText, parseTransactionText, stripFieldLabel } from './ocrParsing'
import { readRasterImageDimensions, SECURITY_LIMITS } from './security'

export { parseDateTimeText, parseMoneyText, stripFieldLabel } from './ocrParsing'

let workerPromise: Promise<Worker> | undefined
let progressSink: ((progress: number, status: string) => void) | undefined

function abortError() {
  const error = new Error('OCR cancelled')
  error.name = 'AbortError'
  return error
}

async function resetOcrWorker() {
  const current = workerPromise
  workerPromise = undefined
  progressSink = undefined
  if (!current) return
  try {
    const worker = await current
    await worker.terminate()
  } catch {
    // A failed/half-created worker is discarded; the next call recreates it.
  }
}

export async function terminateOcrWorker() {
  await resetOcrWorker()
}

async function getWorker(onProgress?: (progress: number, status: string) => void) {
  progressSink = onProgress
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) => createWorker(['vie', 'eng'], 1, {
      logger: (message) => {
        if (typeof message.progress === 'number') progressSink?.(message.progress, message.status ?? 'OCR')
      },
    }))
  }
  return workerPromise
}

function collectWords(blocks: unknown): OcrBox[] {
  const explicitWords: OcrBox[] = []
  const leafBoxes: OcrBox[] = []
  const seen = new Set<string>()

  const candidate = (obj: Record<string, unknown>): OcrBox | undefined => {
    if (typeof obj.text !== 'string' || !obj.bbox || typeof obj.bbox !== 'object') return undefined
    const bbox = obj.bbox as Record<string, unknown>
    if (!['x0', 'y0', 'x1', 'y1'].every((key) => typeof bbox[key] === 'number')) return undefined
    const value: OcrBox = {
      text: obj.text.trim(),
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
      bbox: {
        x0: bbox.x0 as number,
        y0: bbox.y0 as number,
        x1: bbox.x1 as number,
        y1: bbox.y1 as number,
      },
    }
    return value.text ? value : undefined
  }

  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const obj = node as Record<string, unknown>
    const value = candidate(obj)
    const structuralChildren = ['blocks', 'paragraphs', 'lines', 'words'].some((key) => Array.isArray(obj[key]) && (obj[key] as unknown[]).length > 0)
    if (value) {
      const key = `${value.text}|${value.bbox.x0}|${value.bbox.y0}|${value.bbox.x1}|${value.bbox.y1}`
      if (!seen.has(key)) {
        seen.add(key)
        if (Array.isArray(obj.symbols)) explicitWords.push(value)
        else if (!structuralChildren) leafBoxes.push(value)
      }
    }
    for (const child of Object.values(obj)) {
      if (Array.isArray(child)) child.forEach(visit)
    }
  }

  if (Array.isArray(blocks)) blocks.forEach(visit)
  return explicitWords.length ? explicitWords : leafBoxes
}

export async function recognizeImage(
  image: File | Blob,
  onProgress?: (progress: number, status: string) => void,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<OcrResult> {
  const signal = options?.signal
  if (signal?.aborted) throw abortError()
  const worker = await getWorker(onProgress)
  if (signal?.aborted) {
    await resetOcrWorker()
    throw abortError()
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let abortHandler: (() => void) | undefined
  const timeoutMs = Math.max(10_000, options?.timeoutMs ?? 45_000)

  const interruption = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error('OCR tile watchdog timeout')
      error.name = 'TimeoutError'
      reject(error)
    }, timeoutMs)
    if (signal) {
      abortHandler = () => reject(abortError())
      signal.addEventListener('abort', abortHandler, { once: true })
    }
  })

  try {
    const result = await Promise.race([
      worker.recognize(image, {}, { blocks: true }),
      interruption,
    ])
    return {
      text: (result.data.text ?? '').slice(0, SECURITY_LIMITS.maxOcrTextChars),
      boxes: collectWords(result.data.blocks).slice(0, SECURITY_LIMITS.maxOcrBoxes),
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError' || (error as Error)?.name === 'TimeoutError') await resetOcrWorker()
    throw error
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    if (signal && abortHandler) signal.removeEventListener('abort', abortHandler)
  }
}

export function parseTransactionFromOcr(result: OcrResult): ParsedTransactionCandidate {
  return parseTransactionText(result.text)
}

function regionBox(region: OcrRegion, width: number, height: number) {
  return {
    x0: region.x * width,
    y0: region.y * height,
    x1: (region.x + region.width) * width,
    y1: (region.y + region.height) * height,
  }
}

interface GroupedLine {
  y: number
  height: number
  words: OcrBox[]
}

function groupBoxesIntoLines(boxes: OcrBox[]) {
  const sorted = [...boxes].sort((a, b) => {
    const ay = (a.bbox.y0 + a.bbox.y1) / 2
    const by = (b.bbox.y0 + b.bbox.y1) / 2
    const averageHeight = Math.max(8, ((a.bbox.y1 - a.bbox.y0) + (b.bbox.y1 - b.bbox.y0)) / 2)
    if (Math.abs(ay - by) > averageHeight * 0.55) return ay - by
    return a.bbox.x0 - b.bbox.x0
  })
  const lines: GroupedLine[] = []
  for (const box of sorted) {
    const y = (box.bbox.y0 + box.bbox.y1) / 2
    const h = Math.max(1, box.bbox.y1 - box.bbox.y0)
    const line = lines.find((item) => Math.abs(item.y - y) <= Math.max(item.height, h) * 0.6)
    if (line) {
      line.words.push(box)
      line.y = (line.y + y) / 2
      line.height = Math.max(line.height, h)
    } else lines.push({ y, height: h, words: [box] })
  }
  return lines.sort((a, b) => a.y - b.y)
}

function lineText(line: GroupedLine) {
  return line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0).map((word) => word.text).join(' ').trim()
}

function textFromBoxes(boxes: OcrBox[]) {
  return groupBoxesIntoLines(boxes).map(lineText).filter(Boolean).join('\n').trim()
}

export function buildDetectedLines(result: OcrResult, width: number, height: number): OcrDetectedLine[] {
  if (!width || !height) return []
  return groupBoxesIntoLines(result.boxes).map((line, index) => {
    const words = line.words
    const x0 = Math.min(...words.map((word) => word.bbox.x0))
    const y0 = Math.min(...words.map((word) => word.bbox.y0))
    const x1 = Math.max(...words.map((word) => word.bbox.x1))
    const y1 = Math.max(...words.map((word) => word.bbox.y1))
    const confidence = words.reduce((sum, word) => sum + word.confidence, 0) / Math.max(1, words.length)
    return {
      id: `line-${index}-${Math.round(x0)}-${Math.round(y0)}`,
      text: lineText(line),
      confidence,
      x: Math.max(0, x0 / width),
      y: Math.max(0, y0 / height),
      width: Math.min(1, Math.max(0, (x1 - x0) / width)),
      height: Math.min(1, Math.max(0, (y1 - y0) / height)),
    }
  }).filter((line) => line.text)
}

export function extractRegionTexts(result: OcrResult, regions: OcrRegion[], width: number, height: number) {
  return regions.map((region) => {
    const target = regionBox(region, width, height)
    const boxes = result.boxes.filter((box) => {
      const cx = (box.bbox.x0 + box.bbox.x1) / 2
      const cy = (box.bbox.y0 + box.bbox.y1) / 2
      return cx >= target.x0 && cx <= target.x1 && cy >= target.y0 && cy <= target.y1
    })
    return { region, text: textFromBoxes(boxes) }
  })
}

function cleanRegionText(text: string, region: OcrRegion) {
  const flattened = normalizeLine(text.split(/\r?\n/).filter(Boolean).join(' '))
  if (!flattened) return flattened
  if (region.stripLabel === false || region.field === 'generic' || region.field === 'ignore') return flattened
  return stripFieldLabel(flattened, region.field)
}

export function parseTransactionFromRegions(
  result: OcrResult,
  regions: OcrRegion[],
  width: number,
  height: number,
): ParsedTransactionCandidate {
  if (!regions.length) return parseTransactionFromOcr(result)
  const extracted = extractRegionTexts(result, regions, width, height)
  const selectedText = extracted
    .filter((item) => item.region.field !== 'ignore')
    .map((item) => item.text)
    .filter(Boolean)
    .join('\n')
  const base = selectedText ? parseTransactionFromOcr({ ...result, text: selectedText }) : parseTransactionFromOcr(result)
  const fieldText = (field: OcrField) => extracted
    .filter((item) => item.region.field === field && item.text)
    .map((item) => cleanRegionText(item.text, item.region))
    .filter(Boolean)
    .join(' ')
    .trim() || undefined

  const amountText = fieldText('amount')
  const timeText = fieldText('occurredAt')
  const merchantText = fieldText('merchant')
  const balanceText = fieldText('balanceAfter')
  const descriptionText = fieldText('description')

  return {
    ...base,
    amount: amountText ? parseMoneyText(amountText) ?? base.amount : base.amount,
    occurredAt: timeText ? parseDateTimeText(timeText) ?? base.occurredAt : base.occurredAt,
    merchant: merchantText || base.merchant,
    balanceAfter: balanceText ? parseMoneyText(balanceText) ?? base.balanceAfter : base.balanceAfter,
    description: descriptionText || base.description,
    rawText: extracted
      .filter((item) => item.region.field !== 'ignore')
      .map((item) => `[${item.region.field}] ${cleanRegionText(item.text, item.region)}`)
      .join('\n\n') || result.text,
  }
}


function canvasBlob(canvas: HTMLCanvasElement, type = 'image/png') {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('modal.errorOcr')), type)
  })
}

export async function readRasterDimensions(image: Blob) {
  const { width, height } = await readRasterImageDimensions(image)
  return { width, height }
}

export async function recognizeImageTiled(
  image: File | Blob,
  onProgress?: (progress: number, status: string) => void,
  options?: {
    tileHeight?: number
    overlap?: number
    signal?: AbortSignal
    watchdogMs?: number
    retries?: number
    resumeState?: OcrTileResumeState
    onTileCheckpoint?: (state: OcrTileResumeState) => void | Promise<void>
  },
): Promise<{ result: OcrResult; width: number; height: number; visual: OcrVisualFingerprint; diagnostics: OcrRuntimeDiagnostics }> {
  const startedAt = new Date().toISOString()
  const { width, height } = await readRasterDimensions(image)
  const memory = typeof navigator !== 'undefined' ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4) : 4
  const tileHeight = chooseOcrTileHeight(width, height, memory, options?.tileHeight)
  const overlap = Math.max(80, Math.min(tileHeight / 3, options?.overlap ?? Math.round(tileHeight * 0.10)))
  const retries = Math.max(0, Math.min(3, options?.retries ?? 1))
  const watchdogMs = Math.max(15_000, options?.watchdogMs ?? (tileHeight >= 3000 ? 65_000 : 45_000))
  const tileDurationsMs: number[] = []
  let retryCount = 0
  if (options?.signal?.aborted) throw abortError()
  if (height <= tileHeight * 1.35) {
    const started = performance.now()
    let result: OcrResult | undefined
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        result = await recognizeImage(image, onProgress, { signal: options?.signal, timeoutMs: watchdogMs })
        break
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') throw error
        lastError = error
        if (attempt >= retries) throw error
        retryCount += 1
        onProgress?.(0, `retry ${attempt + 1}/${retries}`)
      }
    }
    if (!result) throw lastError ?? new Error('modal.errorOcr')
    const visual = await fingerprintImage(image)
    tileDurationsMs.push(Math.max(0, performance.now() - started))
    return {
      result,
      width,
      height,
      visual,
      diagnostics: { width, height, tileHeight, overlap, tileCount: 1, retryCount, tileDurationsMs, startedAt, finishedAt: new Date().toISOString() },
    }
  }

  const step = tileHeight - overlap
  const starts: number[] = []
  for (let y = 0; y < height; y += step) {
    starts.push(y)
    if (y + tileHeight >= height) break
  }

  const profileBuckets = Math.max(64, Math.min(2048, Math.ceil(height / 96)))
  const resume = options?.resumeState
  const resumeCompatible = Boolean(
    resume
    && resume.width === width
    && resume.height === height
    && resume.tileHeight === tileHeight
    && resume.overlap === overlap
    && resume.nextTileIndex >= 0
    && resume.nextTileIndex <= starts.length
    && resume.visualProfileSum.length === profileBuckets
    && resume.visualProfileCount.length === profileBuckets,
  )
  const boxes: OcrBox[] = resumeCompatible ? [...resume!.boxes] : []
  const texts: string[] = resumeCompatible ? [...resume!.texts] : []
  const seen = new Set<string>()
  for (const box of boxes) {
    seen.add(`${normalizeLine(box.text).toLocaleLowerCase('vi-VN')}|${Math.round(box.bbox.x0 / 6)}|${Math.round(box.bbox.y0 / 6)}`)
  }
  const visualColors = new Map<string, number>(resumeCompatible ? resume!.visualColors : [])
  const visualProfileSum = resumeCompatible ? [...resume!.visualProfileSum] : Array.from({ length: profileBuckets }, () => 0)
  const visualProfileCount = resumeCompatible ? [...resume!.visualProfileCount] : Array.from({ length: profileBuckets }, () => 0)
  let visualLuma = resumeCompatible ? resume!.visualLuma : 0
  let visualCount = resumeCompatible ? resume!.visualCount : 0
  if (resumeCompatible) {
    retryCount = resume!.retryCount
    tileDurationsMs.push(...resume!.tileDurationsMs)
  }

  const sampleTileVisual = (canvas: HTMLCanvasElement, yOffset: number, skipTop: number) => {
    const sourceHeight = Math.max(1, canvas.height - skipTop)
    const sampleWidth = Math.min(72, canvas.width)
    const sampleHeight = Math.max(12, Math.min(96, Math.round(sourceHeight * sampleWidth / Math.max(1, canvas.width))))
    const sample = document.createElement('canvas')
    sample.width = sampleWidth
    sample.height = sampleHeight
    const context = sample.getContext('2d', { willReadFrequently: true })
    if (!context) return
    context.drawImage(canvas, 0, skipTop, canvas.width, sourceHeight, 0, 0, sampleWidth, sampleHeight)
    const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data
    for (let sy = 0; sy < sampleHeight; sy += 1) {
      const globalY = yOffset + skipTop + ((sy + 0.5) / sampleHeight) * sourceHeight
      const bucket = Math.max(0, Math.min(profileBuckets - 1, Math.floor(globalY / Math.max(1, height) * profileBuckets)))
      for (let sx = 0; sx < sampleWidth; sx += 2) {
        const offset = (sy * sampleWidth + sx) * 4
        const r = data[offset], g = data[offset + 1], b = data[offset + 2]
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
        visualLuma += luma
        visualCount += 1
        visualProfileSum[bucket] += luma
        visualProfileCount[bucket] += 1
        const key = quantizedColor(r, g, b)
        visualColors.set(key, (visualColors.get(key) ?? 0) + 1)
      }
    }
  }
  const resumeTileIndex = resumeCompatible ? resume!.nextTileIndex : 0
  for (let index = resumeTileIndex; index < starts.length; index += 1) {
    const y = starts[index]
    const h = Math.min(tileHeight, height - y)
    const bitmap = await createImageBitmap(image, 0, y, width, h)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = h
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('modal.errorOcr')
      context.drawImage(bitmap, 0, 0)
      sampleTileVisual(canvas, y, index === 0 ? 0 : Math.min(overlap, h - 1))
      const tile = await canvasBlob(canvas)
      const tileStarted = performance.now()
      let result: OcrResult | undefined
      let lastError: unknown
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        if (options?.signal?.aborted) throw abortError()
        try {
          result = await recognizeImage(tile, (progress, status) => {
            onProgress?.((index + progress) / starts.length, `${index + 1}/${starts.length} · ${status}`)
          }, { signal: options?.signal, timeoutMs: watchdogMs })
          break
        } catch (error) {
          if ((error as Error)?.name === 'AbortError') throw error
          lastError = error
          if (attempt >= retries) throw error
          retryCount += 1
          onProgress?.(index / starts.length, `${index + 1}/${starts.length} · retry ${attempt + 1}/${retries}`)
        }
      }
      if (!result) throw lastError ?? new Error('modal.errorOcr')
      tileDurationsMs.push(Math.max(0, performance.now() - tileStarted))
      texts.push(result.text)
      for (const box of result.boxes) {
        const shifted: OcrBox = { ...box, bbox: { ...box.bbox, y0: box.bbox.y0 + y, y1: box.bbox.y1 + y } }
        const key = `${normalizeLine(shifted.text).toLocaleLowerCase('vi-VN')}|${Math.round(shifted.bbox.x0 / 6)}|${Math.round(shifted.bbox.y0 / 6)}`
        if (seen.has(key)) continue
        seen.add(key)
        boxes.push(shifted)
      }
      if (options?.onTileCheckpoint) {
        await options.onTileCheckpoint({
          width,
          height,
          tileHeight,
          overlap,
          nextTileIndex: index + 1,
          boxes: boxes.slice(0, SECURITY_LIMITS.maxOcrBoxes).map((box) => ({ ...box, text: box.text.slice(0, 256) })),
          texts: texts.map((text) => text.slice(0, 4_000)),
          visualColors: [...visualColors.entries()],
          visualProfileSum: [...visualProfileSum],
          visualProfileCount: [...visualProfileCount],
          visualLuma,
          visualCount,
          retryCount,
          tileDurationsMs: [...tileDurationsMs],
          startedAt: resumeCompatible ? resume!.startedAt : startedAt,
        })
      }
    } finally {
      bitmap.close()
    }
  }
  const stitched = textFromBoxes(boxes)
  const colors = [...visualColors.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([rgb, amount]) => ({ rgb, weight: amount / Math.max(1, visualCount) }))
  const verticalLumaProfile = visualProfileSum.map((sum, index) => sum / Math.max(1, visualProfileCount[index]))
  return {
    result: { text: stitched || texts.join('\n'), boxes: boxes.slice(0, SECURITY_LIMITS.maxOcrBoxes) },
    width,
    height,
    visual: {
      colors,
      averageLuma: visualLuma / Math.max(1, visualCount),
      aspectRatio: width / Math.max(1, height),
      verticalLumaProfile,
    },
    diagnostics: {
      width,
      height,
      tileHeight,
      overlap,
      tileCount: starts.length,
      retryCount,
      tileDurationsMs,
      startedAt: resumeCompatible ? resume!.startedAt : startedAt,
      finishedAt: new Date().toISOString(),
    },
  }
}

function quantizedColor(r: number, g: number, b: number) {
  const q = (value: number) => Math.round(value / 32) * 32
  return `${Math.min(255, q(r))},${Math.min(255, q(g))},${Math.min(255, q(b))}`
}

export async function fingerprintImage(image: Blob): Promise<OcrVisualFingerprint> {
  const bitmap = await createImageBitmap(image)
  try {
    const sampleWidth = Math.min(96, bitmap.width)
    const sampleHeight = Math.max(1, Math.min(192, Math.round(bitmap.height * sampleWidth / Math.max(1, bitmap.width))))
    const canvas = document.createElement('canvas')
    canvas.width = sampleWidth
    canvas.height = sampleHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('modal.errorOcr')
    context.drawImage(bitmap, 0, 0, sampleWidth, sampleHeight)
    const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data
    const counts = new Map<string, number>()
    let luma = 0
    let count = 0
    for (let index = 0; index < data.length; index += 16) {
      const r = data[index], g = data[index + 1], b = data[index + 2]
      const key = quantizedColor(r, g, b)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      luma += 0.2126 * r + 0.7152 * g + 0.0722 * b
      count += 1
    }
    const colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([rgb, amount]) => ({ rgb, weight: amount / Math.max(1, count) }))
    const rowLuma = Array.from({ length: sampleHeight }, () => 0)
    const rowCount = Array.from({ length: sampleHeight }, () => 0)
    for (let y = 0; y < sampleHeight; y += 1) {
      for (let x = 0; x < sampleWidth; x += 4) {
        const index = (y * sampleWidth + x) * 4
        const r = data[index], g = data[index + 1], b = data[index + 2]
        rowLuma[y] += 0.2126 * r + 0.7152 * g + 0.0722 * b
        rowCount[y] += 1
      }
      rowLuma[y] /= Math.max(1, rowCount[y])
    }
    const buckets = Math.max(32, Math.min(128, Math.ceil(bitmap.height / 48)))
    const verticalLumaProfile = Array.from({ length: buckets }, (_, bucket) => {
      const start = Math.floor(bucket * sampleHeight / buckets)
      const end = Math.max(start + 1, Math.floor((bucket + 1) * sampleHeight / buckets))
      let sum = 0
      let rows = 0
      for (let y = start; y < Math.min(sampleHeight, end); y += 1) {
        sum += rowLuma[y]
        rows += 1
      }
      return sum / Math.max(1, rows)
    })
    return { colors, averageLuma: luma / Math.max(1, count), aspectRatio: bitmap.width / Math.max(1, bitmap.height), verticalLumaProfile }
  } finally {
    bitmap.close()
  }
}

function valueTypeForField(field: OcrField): OcrFieldPattern['valueType'] {
  if (field === 'amount' || field === 'balanceAfter') return 'money'
  if (field === 'occurredAt') return 'datetime'
  return 'text'
}

function lineLooksLikeValue(line: string, type: OcrFieldPattern['valueType']) {
  if (type === 'money') return Boolean(parseMoneyText(line))
  if (type === 'datetime') return Boolean(parseDateTimeText(line))
  if (type === 'digits') return /^\D*\d[\d\s.-]{4,}\D*$/.test(line)
  return line.trim().length >= 2
}

function inferAnchor(lines: OcrDetectedLine[], index: number, field: OcrField) {
  const line = lines[index]
  const stripped = stripFieldLabel(line.text, field)
  if (stripped !== normalizeLine(line.text)) {
    const prefixLength = Math.max(0, line.text.length - stripped.length)
    const prefix = normalizeLine(line.text.slice(0, prefixLength).replace(/[:：\-–—]+$/g, ''))
    if (prefix.length >= 2) return { text: prefix, relation: 'same-row-right' as const }
  }
  const previous = lines[index - 1]
  if (previous && line.y - (previous.y + previous.height) < Math.max(0.08, line.height * 3) && !lineLooksLikeValue(previous.text, valueTypeForField(field))) {
    return { text: previous.text, relation: 'below' as const }
  }
  return undefined
}

export function buildPatternTemplate(
  name: string,
  lines: OcrDetectedLine[],
  mappings: Record<string, OcrField | ''>,
  visualFingerprint?: OcrVisualFingerprint,
  existingId?: string,
): OcrTemplate {
  const mapped = lines.map((line, index) => ({ line, index, field: mappings[line.id] })).filter((item) => item.field && item.field !== 'ignore' && item.field !== 'generic') as Array<{ line: OcrDetectedLine; index: number; field: Exclude<OcrField, 'ignore' | 'generic'> }>
  const fieldPatterns: OcrFieldPattern[] = mapped.map(({ line, index, field }) => {
    const type = valueTypeForField(field)
    const anchor = inferAnchor(lines, index, field)
    const sameTypeBefore = mapped.filter((item) => item.index < index && valueTypeForField(item.field) === type).length
    return {
      id: crypto.randomUUID(),
      field,
      valueType: type,
      anchorText: anchor?.text,
      anchorTexts: anchor?.text ? [anchor.text] : [],
      relation: anchor?.relation ?? 'nearest',
      ordinal: sameTypeBefore,
      sampleShape: sampleShape(line.text),
      sampleShapes: [sampleShape(line.text)],
      successes: 1,
      failures: 0,
    }
  })
  const identityAnchors = [...new Set(fieldPatterns.map((pattern) => pattern.anchorText).filter((value): value is string => Boolean(value && value.length >= 2)))].slice(0, 12)
  const now = new Date().toISOString()
  return {
    id: existingId ?? crypto.randomUUID(),
    name,
    schemaVersion: 2,
    aspectRatio: visualFingerprint?.aspectRatio,
    aspectRatios: visualFingerprint ? [visualFingerprint.aspectRatio] : [],
    regions: [],
    fieldPatterns,
    visualFingerprint,
    visualFingerprints: visualFingerprint ? [visualFingerprint] : [],
    blockPattern: { anchorTexts: identityAnchors.slice(0, 4), repeat: true },
    identityAnchors,
    createdAt: now,
    updatedAt: now,
  }
}

export function mergePatternTemplateEvidence(existing: OcrTemplate, learned: OcrTemplate): OcrTemplate {
  if (existing.schemaVersion !== 2 || learned.schemaVersion !== 2) return learned
  const currentPatterns = existing.fieldPatterns ?? []
  const learnedPatterns = learned.fieldPatterns ?? []
  const mergedPatterns: OcrFieldPattern[] = learnedPatterns.map((next) => {
    const prior = currentPatterns.find((item) => item.field === next.field)
    if (!prior) return next
    const anchors = [...new Set([...(prior.anchorTexts ?? (prior.anchorText ? [prior.anchorText] : [])), ...(next.anchorTexts ?? (next.anchorText ? [next.anchorText] : []))])].slice(-8)
    const shapes = [...new Set([...(prior.sampleShapes ?? (prior.sampleShape ? [prior.sampleShape] : [])), ...(next.sampleShapes ?? (next.sampleShape ? [next.sampleShape] : []))])].slice(-8)
    return {
      ...prior,
      ...next,
      id: prior.id,
      anchorText: next.anchorText ?? prior.anchorText,
      anchorTexts: anchors,
      relation: next.relation ?? prior.relation,
      ordinal: next.ordinal ?? prior.ordinal,
      sampleShape: next.sampleShape ?? prior.sampleShape,
      sampleShapes: shapes,
      successes: (prior.successes ?? 0) + 1,
      failures: prior.failures ?? 0,
    }
  })
  for (const prior of currentPatterns) {
    if (!mergedPatterns.some((item) => item.field === prior.field)) mergedPatterns.push(prior)
  }
  const identityAnchors = [...new Set([
    ...(existing.identityAnchors ?? []),
    ...(learned.identityAnchors ?? []),
    ...mergedPatterns.flatMap((pattern) => pattern.anchorTexts ?? (pattern.anchorText ? [pattern.anchorText] : [])),
  ])].filter(Boolean).slice(-16)

  const aspectCandidates = [
    ...(existing.aspectRatios ?? (existing.aspectRatio ? [existing.aspectRatio] : [])),
    ...(learned.aspectRatios ?? (learned.aspectRatio ? [learned.aspectRatio] : [])),
  ].filter((value) => Number.isFinite(value) && value > 0)
  const aspectRatios: number[] = []
  for (const value of aspectCandidates) {
    if (!aspectRatios.some((existingValue) => Math.abs(existingValue - value) <= 0.03)) aspectRatios.push(value)
  }

  const visualCandidates = [
    ...(existing.visualFingerprints ?? (existing.visualFingerprint ? [existing.visualFingerprint] : [])),
    ...(learned.visualFingerprints ?? (learned.visualFingerprint ? [learned.visualFingerprint] : [])),
  ]
  const visualFingerprints: OcrVisualFingerprint[] = []
  for (const fingerprint of visualCandidates) {
    const duplicate = visualFingerprints.some((known) => colorSimilarity(known, fingerprint) >= 0.95 && Math.abs(known.averageLuma - fingerprint.averageLuma) <= 8)
    if (!duplicate) visualFingerprints.push(fingerprint)
  }
  const cappedVisualFingerprints = visualFingerprints.slice(-6)

  const rollbackSnapshot = {
    aspectRatio: existing.aspectRatio,
    aspectRatios: existing.aspectRatios ? [...existing.aspectRatios] : undefined,
    fieldPatterns: existing.fieldPatterns ? existing.fieldPatterns.map((pattern) => ({ ...pattern, anchorTexts: pattern.anchorTexts ? [...pattern.anchorTexts] : undefined, sampleShapes: pattern.sampleShapes ? [...pattern.sampleShapes] : undefined })) : undefined,
    visualFingerprint: existing.visualFingerprint ? structuredClone(existing.visualFingerprint) : undefined,
    visualFingerprints: existing.visualFingerprints ? structuredClone(existing.visualFingerprints) : undefined,
    blockPattern: existing.blockPattern ? { ...existing.blockPattern, anchorTexts: existing.blockPattern.anchorTexts ? [...existing.blockPattern.anchorTexts] : undefined } : undefined,
    identityAnchors: existing.identityAnchors ? [...existing.identityAnchors] : undefined,
  }

  return {
    ...existing,
    ...learned,
    id: existing.id,
    createdAt: existing.createdAt,
    rollbackSnapshot,
    aspectRatio: learned.aspectRatio ?? existing.aspectRatio,
    aspectRatios: aspectRatios.slice(-8),
    visualFingerprint: learned.visualFingerprint ?? existing.visualFingerprint,
    visualFingerprints: cappedVisualFingerprints,
    fieldPatterns: mergedPatterns,
    identityAnchors,
    blockPattern: { anchorTexts: identityAnchors.slice(0, 6), repeat: true },
    updatedAt: new Date().toISOString(),
  }
}

function colorSimilarity(a?: OcrVisualFingerprint, b?: OcrVisualFingerprint) {
  if (!a || !b) return 0
  const lookup = new Map(b.colors.map((item) => [item.rgb, item.weight]))
  const overlap = a.colors.reduce((sum, item) => sum + Math.min(item.weight, lookup.get(item.rgb) ?? 0), 0)
  const luma = 1 - Math.min(1, Math.abs(a.averageLuma - b.averageLuma) / 255)
  return overlap * 0.75 + luma * 0.25
}

export function rankOcrTemplates(
  templates: OcrTemplate[],
  result: OcrResult,
  width: number,
  height: number,
  visual?: OcrVisualFingerprint,
) {
  const text = normalizeLine(result.text).toLocaleLowerCase('vi-VN')
  return templates.map((template) => {
    if (template.enabled === false || template.schemaVersion !== 2) return { template, score: 0 }
    const anchors = template.identityAnchors ?? []
    const anchorScore = anchors.length ? anchors.filter((anchor) => text.includes(normalizeLine(anchor).toLocaleLowerCase('vi-VN'))).length / anchors.length : 0
    const longCapture = height > width * 3
    const currentAspect = width / Math.max(1, height)
    const knownAspects = template.aspectRatios?.length
      ? template.aspectRatios
      : template.aspectRatio
        ? [template.aspectRatio]
        : []
    const aspect = longCapture
      ? 0.5
      : knownAspects.length
        ? Math.max(...knownAspects.map((known) => 1 - Math.min(1, Math.abs(known - currentAspect) / Math.max(0.2, Math.abs(known)))))
        : 0.5
    const knownVisuals = template.visualFingerprints?.length
      ? template.visualFingerprints
      : template.visualFingerprint
        ? [template.visualFingerprint]
        : []
    const visualScore = visual && knownVisuals.length ? Math.max(...knownVisuals.map((known) => colorSimilarity(known, visual))) : 0
    const score = anchorScore * 0.55 + visualScore * 0.30 + aspect * 0.15
    return { template, score, anchorScore, visualScore, aspectScore: aspect }
  }).sort((a, b) => b.score - a.score)
}

function patternShapeScore(line: string, pattern: OcrFieldPattern) {
  const target = sampleShape(line)
  const shapes = pattern.sampleShapes?.length ? pattern.sampleShapes : pattern.sampleShape ? [pattern.sampleShape] : []
  return shapes.length ? Math.max(...shapes.map((shape) => shapeSimilarity(target, shape))) : 0
}

function candidateValueFromLine(line: string, pattern: OcrFieldPattern) {
  if (pattern.valueType === 'money') return parseMoneyText(line)
  if (pattern.valueType === 'datetime') return parseDateTimeText(line)
  return stripFieldLabel(line, pattern.field)
}

function findPatternLine(lines: OcrDetectedLine[], pattern: OcrFieldPattern) {
  const anchors = pattern.anchorTexts?.length ? pattern.anchorTexts : pattern.anchorText ? [pattern.anchorText] : []
  if (anchors.length) {
    const normalizedAnchors = anchors.map((value) => normalizeLine(value).toLocaleLowerCase('vi-VN'))
    const anchorIndex = lines.findIndex((line) => {
      const text = normalizeLine(line.text).toLocaleLowerCase('vi-VN')
      return normalizedAnchors.some((anchor) => text.includes(anchor))
    })
    if (anchorIndex >= 0) {
      const anchor = lines[anchorIndex]
      if (pattern.relation === 'same-row-right' && lineLooksLikeValue(anchor.text, pattern.valueType)) return anchor
      if (pattern.relation === 'below') return lines.slice(anchorIndex + 1).find((line) => line.y >= anchor.y && line.y - anchor.y < 0.16 && lineLooksLikeValue(line.text, pattern.valueType))
      if (pattern.relation === 'above') return [...lines.slice(0, anchorIndex)].reverse().find((line) => anchor.y - line.y < 0.16 && lineLooksLikeValue(line.text, pattern.valueType))
      const nearby = lines.filter((line, index) => index !== anchorIndex && Math.abs(line.y - anchor.y) < 0.12 && lineLooksLikeValue(line.text, pattern.valueType))
      if (nearby.length) return nearby.sort((a, b) => Math.abs(a.y - anchor.y) - Math.abs(b.y - anchor.y))[0]
    }
  }
  const values = lines.filter((line) => lineLooksLikeValue(line.text, pattern.valueType))
  if (!values.length) return undefined
  const ordinal = Math.max(0, pattern.ordinal ?? 0)
  const ranked = values.map((line, index) => ({
    line,
    score: patternShapeScore(line.text, pattern) * 0.7 + (index === ordinal ? 0.3 : 0),
  })).sort((a, b) => b.score - a.score)
  return ranked[0]?.line ?? values[ordinal]
}

export function parseTransactionWithTemplate(
  result: OcrResult,
  template: OcrTemplate,
  width: number,
  height: number,
): ParsedTransactionCandidate {
  if (template.schemaVersion !== 2 || !template.fieldPatterns?.length) {
    return template.regions.length ? parseTransactionFromRegions(result, template.regions, width, height) : parseTransactionFromOcr(result)
  }
  const lines = buildDetectedLines(result, width, height)
  const base = parseTransactionFromOcr(result)
  const values: Partial<Record<OcrField, unknown>> = {}
  for (const pattern of template.fieldPatterns) {
    const line = findPatternLine(lines, pattern)
    if (!line) continue
    values[pattern.field] = candidateValueFromLine(line.text, pattern)
  }
  return {
    ...base,
    amount: typeof values.amount === 'number' ? values.amount : base.amount,
    occurredAt: typeof values.occurredAt === 'string' ? values.occurredAt : base.occurredAt,
    merchant: typeof values.merchant === 'string' ? values.merchant : base.merchant,
    balanceAfter: typeof values.balanceAfter === 'number' ? values.balanceAfter : base.balanceAfter,
    description: typeof values.description === 'string' ? values.description : base.description,
  }
}

function normalizedFieldText(value?: string) {
  return normalizeLine(value ?? '').toLocaleLowerCase('vi-VN')
}

function buildFieldEvidence(
  result: OcrResult,
  candidate: ParsedTransactionCandidate,
  width: number,
  height: number,
  sourceY: number,
  template?: OcrTemplate,
): Partial<Record<OcrField, OcrFieldEvidence>> {
  const lines = buildDetectedLines(result, width, height)
  const evidence: Partial<Record<OcrField, OcrFieldEvidence>> = {}

  const add = (field: OcrField, line: OcrDetectedLine | undefined, method: OcrFieldEvidence['method']) => {
    if (!line || field === 'generic' || field === 'ignore') return
    evidence[field] = {
      field,
      text: line.text,
      confidence: Math.max(0, Math.min(1, line.confidence / 100)),
      bbox: {
        x: line.x * width,
        y: sourceY + line.y * height,
        width: line.width * width,
        height: Math.max(1, line.height * height),
      },
      method,
    }
  }

  if (template?.schemaVersion === 2) {
    for (const pattern of template.fieldPatterns ?? []) {
      const line = findPatternLine(lines, pattern)
      if (line) add(pattern.field, line, 'template')
    }
  }

  const findAmount = (value: number | undefined) => value === undefined ? undefined : lines.find((line) => {
    const parsed = parseMoneyText(line.text)
    return parsed !== undefined && Math.abs(parsed - value) <= 0.01
  })
  const findTime = (value: string | undefined) => {
    if (!value) return undefined
    const expected = Date.parse(value)
    return lines.find((line) => {
      const parsed = parseDateTimeText(line.text)
      return parsed && Number.isFinite(expected) && Math.abs(Date.parse(parsed) - expected) <= 60_000
    })
  }
  const findText = (value: string | undefined) => {
    const target = normalizedFieldText(value)
    if (!target) return undefined
    return lines.find((line) => {
      const text = normalizedFieldText(line.text)
      return text.includes(target) || target.includes(text)
    })
  }

  if (!evidence.amount) add('amount', findAmount(candidate.amount), 'value-match')
  if (!evidence.occurredAt) add('occurredAt', findTime(candidate.occurredAt), 'value-match')
  if (!evidence.merchant) add('merchant', findText(candidate.merchant), 'value-match')
  if (!evidence.balanceAfter) add('balanceAfter', findAmount(candidate.balanceAfter), 'value-match')
  if (!evidence.description) add('description', findText(candidate.description), 'value-match')
  return evidence
}

function blockResultFromLines(lines: OcrDetectedLine[], result: OcrResult, width: number, height: number) {
  if (!lines.length) return undefined
  const y0 = Math.max(0, Math.min(...lines.map((line) => line.y)) * height)
  const y1 = Math.min(height, Math.max(...lines.map((line) => line.y + line.height)) * height)
  const boxes = result.boxes.filter((box) => {
    const cy = (box.bbox.y0 + box.bbox.y1) / 2
    return cy >= y0 && cy <= y1
  }).map((box) => ({ ...box, bbox: { ...box.bbox, y0: box.bbox.y0 - y0, y1: box.bbox.y1 - y0 } }))
  return { result: { text: textFromBoxes(boxes), boxes }, y0, y1 }
}

export function detectTransactionBlocks(
  result: OcrResult,
  width: number,
  height: number,
  template?: OcrTemplate,
  visual?: OcrVisualFingerprint,
): OcrTransactionBlock[] {
  const lines = buildDetectedLines(result, width, height).sort((a, b) => a.y - b.y)
  if (!lines.length) return []
  const dateIndices = lines.map((line, index) => parseDateTimeText(line.text) ? index : -1).filter((index) => index >= 0)
  const anchorTexts = template?.schemaVersion === 2 ? (template.blockPattern?.anchorTexts ?? []) : []
  const anchorIndices = anchorTexts.length
    ? lines.map((line, index) => anchorTexts.some((anchor) => normalizeLine(line.text).toLocaleLowerCase('vi-VN').includes(normalizeLine(anchor).toLocaleLowerCase('vi-VN'))) ? index : -1).filter((index) => index >= 0)
    : []
  const starts = [...new Set((anchorIndices.length >= 2 ? anchorIndices : dateIndices.length >= 2 ? dateIndices : [0]))].sort((a, b) => a - b)
  const groups: OcrDetectedLine[][] = []
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]
    const end = starts[index + 1] ?? lines.length
    const slice = lines.slice(start, end)
    if (slice.length) groups.push(slice)
  }

  if (groups.length === 1 && height > width * 3) {
    const inferred: OcrDetectedLine[][] = []
    let current: OcrDetectedLine[] = []
    for (const line of lines) {
      const previous = current[current.length - 1]
      const gapPx = previous ? (line.y - (previous.y + previous.height)) * height : 0
      const medianLinePx = Math.max(12, line.height * height)
      if (current.length >= 2 && gapPx > medianLinePx * 2.8) {
        inferred.push(current)
        current = []
      }
      current.push(line)
    }
    if (current.length) inferred.push(current)
    if (inferred.length > 1) groups.splice(0, groups.length, ...inferred)
  }

  if (groups.length === 1 && height > width * 2.2) {
    const separators = visualSeparatorPositions(visual)
    if (separators.length) {
      const visualGroups: OcrDetectedLine[][] = []
      let current: OcrDetectedLine[] = []
      let separatorIndex = 0
      for (const line of lines) {
        const center = line.y + line.height / 2
        while (separatorIndex < separators.length && center > separators[separatorIndex]) {
          if (current.length >= 2) visualGroups.push(current)
          current = []
          separatorIndex += 1
        }
        current.push(line)
      }
      if (current.length >= 2) visualGroups.push(current)
      if (visualGroups.length > 1) groups.splice(0, groups.length, ...visualGroups)
    }
  }

  const detected: OcrTransactionBlock[] = []
  for (const group of groups) {
    const block = blockResultFromLines(group, result, width, height)
    if (!block) continue
    const candidate = template ? parseTransactionWithTemplate(block.result, template, width, Math.max(1, block.y1 - block.y0)) : parseTransactionFromOcr(block.result)
    const confidence = group.reduce((sum, line) => sum + line.confidence, 0) / Math.max(1, group.length)
    if (!isStrongTransactionBlock(candidate, confidence, Boolean(template))) continue
    const blockHeight = Math.max(1, block.y1 - block.y0)
    detected.push({
      candidate,
      bbox: { x: 0, y: block.y0, width, height: blockHeight },
      confidence,
      templateId: template?.id,
      fieldEvidence: buildFieldEvidence(block.result, candidate, width, blockHeight, block.y0, template),
    })
  }

  return dedupeTransactionBlocks(detected)
}
