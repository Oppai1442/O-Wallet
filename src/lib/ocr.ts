import type { Worker } from 'tesseract.js'
import type {
  OcrBox,
  OcrDetectedLine,
  OcrField,
  OcrFieldPattern,
  OcrRegion,
  OcrResult,
  OcrTemplate,
  OcrTransactionBlock,
  OcrVisualFingerprint,
  ParsedTransactionCandidate,
  TransactionType,
} from '../types'
import { SECURITY_LIMITS } from './security'

let workerPromise: Promise<Worker> | undefined
let progressSink: ((progress: number, status: string) => void) | undefined

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
): Promise<OcrResult> {
  const worker = await getWorker(onProgress)
  const result = await worker.recognize(image, {}, { blocks: true })
  return {
    text: (result.data.text ?? '').slice(0, SECURITY_LIMITS.maxOcrTextChars),
    boxes: collectWords(result.data.blocks).slice(0, SECURITY_LIMITS.maxOcrBoxes),
  }
}

export function parseMoneyText(raw: string) {
  const matches = raw.match(/[-+]?\s*\d[\d.,\s]{1,}(?:\s*(?:VND|VNĐ|₫|đ))?/gi) ?? []
  for (const match of matches) {
    const normalized = match
      .replace(/[^\d.,-]/g, '')
      .replace(/([.,])(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.')
    const value = Number(normalized)
    if (Number.isFinite(value) && Math.abs(value) >= 1) return Math.abs(value)
  }
  return undefined
}

function normalizeLine(line: string) {
  return line.replace(/\s+/g, ' ').trim()
}

const LABEL_PATTERNS: Record<OcrField, RegExp[]> = {
  amount: [
    /^(?:số\s*tiền|so\s*tien|amount|giá\s*trị|gia\s*tri|transaction\s*amount|số\s*tiền\s*giao\s*dịch)\s*[:：\-–—]?\s*/i,
  ],
  occurredAt: [
    /^(?:thời\s*gian|thoi\s*gian|ngày\s*giao\s*dịch|ngay\s*giao\s*dich|transaction\s*(?:date|time)|date\s*&?\s*time|ngày|ngay)\s*[:：\-–—]?\s*/i,
  ],
  merchant: [
    /^(?:tên\s*người\s*nhận|ten\s*nguoi\s*nhan|người\s*nhận|nguoi\s*nhan|recipient|beneficiary|merchant|đơn\s*vị|don\s*vi|người\s*thụ\s*hưởng|nguoi\s*thu\s*huong)\s*[:：\-–—]?\s*/i,
  ],
  balanceAfter: [
    /^(?:số\s*dư(?:\s*sau\s*giao\s*dịch)?|so\s*du(?:\s*sau\s*giao\s*dich)?|balance(?:\s*after)?|available\s*balance)\s*[:：\-–—]?\s*/i,
  ],
  description: [
    /^(?:nội\s*dung(?:\s*chuyển\s*khoản)?|noi\s*dung(?:\s*chuyen\s*khoan)?|description|remark|message|memo|diễn\s*giải|dien\s*giai)\s*[:：\-–—]?\s*/i,
  ],
  generic: [],
  ignore: [],
}

export function stripFieldLabel(raw: string, field: OcrField) {
  const normalized = normalizeLine(raw)
  if (!normalized) return normalized
  for (const pattern of LABEL_PATTERNS[field]) {
    const stripped = normalized.replace(pattern, '').trim()
    if (stripped !== normalized) return stripped
  }
  return normalized
}

function extractLabeledValue(lines: string[], index: number, field: OcrField) {
  const current = lines[index] ?? ''
  const stripped = stripFieldLabel(current, field)
  if (stripped && stripped !== current) return stripped
  const next = lines[index + 1]
  return next ? stripFieldLabel(next, field) : undefined
}

function validDate(year: number, month: number, day: number, hour: number, minute: number, second = 0) {
  const date = new Date(year, month - 1, day, hour, minute, second)
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
    || date.getHours() !== hour
    || date.getMinutes() !== minute
  ) return undefined
  return date.toISOString()
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

export function parseDateTimeText(text: string) {
  const source = normalizeLine(text)
  let match = source.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:\s+|,\s*)(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (match) {
    const [, day, month, year, hour, minute, second = '0'] = match
    return validDate(Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second))
  }

  match = source.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s+|,\s*)(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/)
  if (match) {
    const [, hour, minute, second = '0', day, month, year] = match
    return validDate(Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second))
  }

  // Vietnamese bank UIs commonly render dates as "29 thg 10, 2022 17:33".
  match = source.match(/(\d{1,2})\s*(?:thg|tháng|thang)\s*(\d{1,2})\s*,?\s*(\d{4})\s*(?:,|\s)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/i)
  if (match) {
    const [, day, month, year, hour, minute, second = '0'] = match
    return validDate(Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second))
  }

  match = source.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s*,?\s*(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (match) {
    const [, day, monthName, year, hour, minute, second = '0'] = match
    const month = MONTH_NAMES[monthName.toLowerCase()]
    if (month) return validDate(Number(year), month, Number(day), Number(hour), Number(minute), Number(second))
  }

  match = source.match(/([A-Za-z]{3,9})\s+(\d{1,2})\s*,?\s*(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (match) {
    const [, monthName, day, year, hour, minute, second = '0'] = match
    const month = MONTH_NAMES[monthName.toLowerCase()]
    if (month) return validDate(Number(year), month, Number(day), Number(hour), Number(minute), Number(second))
  }
  return undefined
}

function findMoneyCandidates(lines: string[]) {
  const out: Array<{ value: number; line: string; index: number }> = []
  const moneyRegex = /[-+]?\s*\d[\d.,\s]{2,}(?:\s*(?:VND|VNĐ|₫|đ))?/gi
  lines.forEach((line, index) => {
    for (const match of line.matchAll(moneyRegex)) {
      const value = parseMoneyText(match[0])
      if (value && value >= 100) out.push({ value, line, index })
    }
  })
  return out
}

export function parseTransactionFromOcr(result: OcrResult): ParsedTransactionCandidate {
  const lines = result.text.split(/\r?\n/).map(normalizeLine).filter(Boolean)
  const lower = lines.map((line) => line.toLocaleLowerCase('vi-VN'))
  const money = findMoneyCandidates(lines)

  const balanceIndex = lower.findIndex((line) => /số dư|so du|balance|available balance/.test(line))
  const balanceMoney = balanceIndex >= 0
    ? money.find((candidate) => Math.abs(candidate.index - balanceIndex) <= 1)
    : undefined

  const amountKeywordIndex = lower.findIndex((line) => /số tiền|so tien|amount|giá trị|gia tri|thanh toán|thanh toan/.test(line))
  let amountCandidate = amountKeywordIndex >= 0
    ? money.find((candidate) => Math.abs(candidate.index - amountKeywordIndex) <= 1 && candidate !== balanceMoney)
    : undefined
  if (!amountCandidate) amountCandidate = money.find((candidate) => candidate !== balanceMoney)

  const expenseHints = /thanh toán|thanh toan|chuyển tiền|chuyen tien|debit|trừ|tru|payment|purchase|chi tiêu|chi tieu/
  const incomeHints = /nhận tiền|nhan tien|credit|cộng|cong|incoming|received|thu nhập|thu nhap/
  const transferHints = /chuyển khoản|chuyen khoan|transfer/

  const joined = lower.join(' | ')
  let type: TransactionType = 'expense'
  if (incomeHints.test(joined)) type = 'income'
  else if (transferHints.test(joined) && !expenseHints.test(joined)) type = 'transfer'

  const occurredAt = parseDateTimeText(result.text)

  const merchantIndex = lower.findIndex((line) => /tên người nhận|ten nguoi nhan|người nhận|nguoi nhan|merchant|đơn vị|don vi|recipient|beneficiary|người thụ hưởng|nguoi thu huong/.test(line))
  const merchant = merchantIndex >= 0 ? extractLabeledValue(lines, merchantIndex, 'merchant') : undefined

  const descIndex = lower.findIndex((line) => /nội dung|noi dung|description|remark|message|memo|diễn giải|dien giai/.test(line))
  const description = descIndex >= 0 ? extractLabeledValue(lines, descIndex, 'description') : undefined

  return {
    type,
    amount: amountCandidate?.value,
    occurredAt,
    merchant,
    balanceAfter: balanceMoney?.value,
    description,
    rawText: result.text,
  }
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
  const bitmap = await createImageBitmap(image)
  try { return { width: bitmap.width, height: bitmap.height } } finally { bitmap.close() }
}

export async function recognizeImageTiled(
  image: File | Blob,
  onProgress?: (progress: number, status: string) => void,
  options?: { tileHeight?: number; overlap?: number },
): Promise<{ result: OcrResult; width: number; height: number }> {
  const { width, height } = await readRasterDimensions(image)
  const tileHeight = Math.max(900, options?.tileHeight ?? 2400)
  const overlap = Math.max(80, Math.min(tileHeight / 3, options?.overlap ?? 240))
  if (height <= tileHeight * 1.35) {
    return { result: await recognizeImage(image, onProgress), width, height }
  }

  const step = tileHeight - overlap
  const starts: number[] = []
  for (let y = 0; y < height; y += step) {
    starts.push(y)
    if (y + tileHeight >= height) break
  }

  const boxes: OcrBox[] = []
  const texts: string[] = []
  const seen = new Set<string>()
  for (let index = 0; index < starts.length; index += 1) {
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
      const tile = await canvasBlob(canvas)
      const result = await recognizeImage(tile, (progress, status) => {
        onProgress?.((index + progress) / starts.length, `${index + 1}/${starts.length} · ${status}`)
      })
      texts.push(result.text)
      for (const box of result.boxes) {
        const shifted: OcrBox = { ...box, bbox: { ...box.bbox, y0: box.bbox.y0 + y, y1: box.bbox.y1 + y } }
        const key = `${normalizeLine(shifted.text).toLocaleLowerCase('vi-VN')}|${Math.round(shifted.bbox.x0 / 6)}|${Math.round(shifted.bbox.y0 / 6)}`
        if (seen.has(key)) continue
        seen.add(key)
        boxes.push(shifted)
      }
    } finally {
      bitmap.close()
    }
  }
  const stitched = textFromBoxes(boxes)
  return {
    result: { text: stitched || texts.join('\n'), boxes: boxes.slice(0, SECURITY_LIMITS.maxOcrBoxes) },
    width,
    height,
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
    return { colors, averageLuma: luma / Math.max(1, count), aspectRatio: bitmap.width / Math.max(1, bitmap.height) }
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

function sampleShape(text: string) {
  return normalizeLine(text)
    .replace(/[A-ZÀ-Ỹ]/g, 'A')
    .replace(/[a-zà-ỹ]/g, 'a')
    .replace(/\d/g, '0')
    .replace(/A+/g, 'A')
    .replace(/a+/g, 'a')
    .replace(/0+/g, '0')
    .slice(0, 80)
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
      relation: anchor?.relation ?? 'nearest',
      ordinal: sameTypeBefore,
      sampleShape: sampleShape(line.text),
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
    regions: [],
    fieldPatterns,
    visualFingerprint,
    blockPattern: { anchorTexts: identityAnchors.slice(0, 4), repeat: true },
    identityAnchors,
    createdAt: now,
    updatedAt: now,
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
    if (template.schemaVersion !== 2) return { template, score: 0 }
    const anchors = template.identityAnchors ?? []
    const anchorScore = anchors.length ? anchors.filter((anchor) => text.includes(normalizeLine(anchor).toLocaleLowerCase('vi-VN'))).length / anchors.length : 0
    const aspect = template.aspectRatio ? 1 - Math.min(1, Math.abs(template.aspectRatio - width / Math.max(1, height)) / Math.max(0.2, Math.abs(template.aspectRatio))) : 0.5
    const visualScore = colorSimilarity(template.visualFingerprint, visual)
    return { template, score: anchorScore * 0.55 + visualScore * 0.30 + aspect * 0.15 }
  }).sort((a, b) => b.score - a.score)
}

function candidateValueFromLine(line: string, pattern: OcrFieldPattern) {
  if (pattern.valueType === 'money') return parseMoneyText(line)
  if (pattern.valueType === 'datetime') return parseDateTimeText(line)
  return stripFieldLabel(line, pattern.field)
}

function findPatternLine(lines: OcrDetectedLine[], pattern: OcrFieldPattern) {
  if (pattern.anchorText) {
    const anchorText = normalizeLine(pattern.anchorText).toLocaleLowerCase('vi-VN')
    const anchorIndex = lines.findIndex((line) => normalizeLine(line.text).toLocaleLowerCase('vi-VN').includes(anchorText))
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
  return values[Math.max(0, pattern.ordinal ?? 0)]
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

  return groups.map((group) => {
    const block = blockResultFromLines(group, result, width, height)
    if (!block) return undefined
    const candidate = template ? parseTransactionWithTemplate(block.result, template, width, Math.max(1, block.y1 - block.y0)) : parseTransactionFromOcr(block.result)
    const confidence = group.reduce((sum, line) => sum + line.confidence, 0) / Math.max(1, group.length)
    return {
      candidate,
      bbox: { x: 0, y: block.y0, width, height: Math.max(1, block.y1 - block.y0) },
      confidence,
      templateId: template?.id,
    } satisfies OcrTransactionBlock
  }).filter((block): block is OcrTransactionBlock => Boolean(block && (block.candidate.amount || block.candidate.occurredAt || block.candidate.merchant || block.candidate.description)))
}
