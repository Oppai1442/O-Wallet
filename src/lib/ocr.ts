import type { Worker } from 'tesseract.js'
import type { OcrBox, OcrField, OcrRegion, OcrResult, ParsedTransactionCandidate, TransactionType } from '../types'

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
    text: result.data.text ?? '',
    boxes: collectWords(result.data.blocks),
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

export function parseDateTimeText(text: string) {
  const patterns = [
    /(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+|,\s*)(\d{1,2}):(\d{2})(?::(\d{2}))?/,
    /(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s+|,\s*)(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/,
  ]

  let match = text.match(patterns[0])
  if (match) {
    const [, day, month, year, hour, minute, second = '0'] = match
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }

  match = text.match(patterns[1])
  if (match) {
    const [, hour, minute, second = '0', day, month, year] = match
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
    if (!Number.isNaN(date.getTime())) return date.toISOString()
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

  const merchantIndex = lower.findIndex((line) => /người nhận|nguoi nhan|merchant|đơn vị|don vi|recipient|đến|den:/.test(line))
  const merchant = merchantIndex >= 0 ? lines[merchantIndex + 1] || lines[merchantIndex] : undefined

  const descIndex = lower.findIndex((line) => /nội dung|noi dung|description|remark|message/.test(line))
  const description = descIndex >= 0 ? lines[descIndex + 1] || lines[descIndex] : undefined

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

function textFromBoxes(boxes: OcrBox[]) {
  const sorted = [...boxes].sort((a, b) => {
    const ay = (a.bbox.y0 + a.bbox.y1) / 2
    const by = (b.bbox.y0 + b.bbox.y1) / 2
    const averageHeight = Math.max(8, ((a.bbox.y1 - a.bbox.y0) + (b.bbox.y1 - b.bbox.y0)) / 2)
    if (Math.abs(ay - by) > averageHeight * 0.55) return ay - by
    return a.bbox.x0 - b.bbox.x0
  })
  const lines: Array<{ y: number; height: number; words: OcrBox[] }> = []
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
  return lines
    .sort((a, b) => a.y - b.y)
    .map((line) => line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0).map((word) => word.text).join(' '))
    .join('\n')
    .trim()
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
  const first = (field: OcrField) => extracted.find((item) => item.region.field === field && item.text)?.text
  const amountText = first('amount')
  const timeText = first('occurredAt')
  const merchantText = first('merchant')
  const balanceText = first('balanceAfter')
  const descriptionText = first('description')

  return {
    ...base,
    amount: amountText ? parseMoneyText(amountText) ?? base.amount : base.amount,
    occurredAt: timeText ? parseDateTimeText(timeText) ?? base.occurredAt : base.occurredAt,
    merchant: merchantText ? normalizeLine(merchantText.split(/\r?\n/).filter(Boolean).join(' ')) : base.merchant,
    balanceAfter: balanceText ? parseMoneyText(balanceText) ?? base.balanceAfter : base.balanceAfter,
    description: descriptionText ? normalizeLine(descriptionText.split(/\r?\n/).filter(Boolean).join(' ')) : base.description,
    rawText: extracted
      .filter((item) => item.region.field !== 'ignore')
      .map((item) => `[${item.region.field}] ${item.text}`)
      .join('\n\n') || result.text,
  }
}
