import { createWorker, type Worker } from 'tesseract.js'
import type { OcrBox, OcrResult, ParsedTransactionCandidate, TransactionType } from '../types'

let workerPromise: Promise<Worker> | undefined

function getWorker(onProgress?: (progress: number, status: string) => void) {
  if (!workerPromise) {
    workerPromise = createWorker(['vie', 'eng'], 1, {
      logger: (message) => {
        if (typeof message.progress === 'number') onProgress?.(message.progress, message.status ?? 'OCR')
      },
    })
  }
  return workerPromise
}

function collectWords(blocks: unknown): OcrBox[] {
  const result: OcrBox[] = []
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const obj = node as Record<string, unknown>
    if (typeof obj.text === 'string' && obj.bbox && typeof obj.bbox === 'object') {
      const bbox = obj.bbox as Record<string, unknown>
      if (['x0', 'y0', 'x1', 'y1'].every((key) => typeof bbox[key] === 'number')) {
        result.push({
          text: obj.text,
          confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
          bbox: {
            x0: bbox.x0 as number,
            y0: bbox.y0 as number,
            x1: bbox.x1 as number,
            y1: bbox.y1 as number,
          },
        })
      }
    }
    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) value.forEach(visit)
    }
  }
  if (Array.isArray(blocks)) blocks.forEach(visit)
  return result
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

function parseVndNumber(raw: string) {
  const normalized = raw
    .replace(/[^\d.,-]/g, '')
    .replace(/([.,])(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
  const value = Number(normalized)
  return Number.isFinite(value) ? Math.abs(value) : undefined
}

function normalizeLine(line: string) {
  return line.replace(/\s+/g, ' ').trim()
}

function parseDateTime(text: string) {
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
      const value = parseVndNumber(match[0])
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

  const occurredAt = parseDateTime(result.text)

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
