import type { OcrField, ParsedTransactionCandidate, TransactionType } from '../types'

export function normalizeOcrLine(line: string) {
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
  const normalized = normalizeOcrLine(raw)
  if (!normalized) return normalized
  for (const pattern of LABEL_PATTERNS[field]) {
    const stripped = normalized.replace(pattern, '').trim()
    if (stripped !== normalized) return stripped
  }
  return normalized
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

function validDate(year: number, month: number, day: number, hour: number, minute: number, second = 0) {
  const date = new Date(year, month - 1, day, hour, minute, second)
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
    || date.getHours() !== hour
    || date.getMinutes() !== minute
    || date.getSeconds() !== second
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
  const source = normalizeOcrLine(text)
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

function extractLabeledValue(lines: string[], index: number, field: OcrField) {
  const current = lines[index] ?? ''
  const stripped = stripFieldLabel(current, field)
  if (stripped && stripped !== current) return stripped
  const next = lines[index + 1]
  return next ? stripFieldLabel(next, field) : undefined
}

interface MoneyCandidate {
  value: number
  line: string
  index: number
  raw: string
  hasCurrency: boolean
  hasSign: boolean
  hasSeparator: boolean
  looksLikeIdentifier: boolean
}

function findMoneyCandidates(lines: string[]) {
  const out: MoneyCandidate[] = []
  const moneyRegex = /[-+]?\s*\d[\d.,\s]{2,}(?:\s*(?:VND|VNĐ|₫|đ))?/gi
  lines.forEach((line, index) => {
    for (const match of line.matchAll(moneyRegex)) {
      const raw = match[0].trim()
      const value = parseMoneyText(raw)
      if (!value || value < 100) continue
      const compactDigits = raw.replace(/\D/g, '')
      const hasCurrency = /(?:VND|VNĐ|₫|đ)/i.test(raw)
      const hasSign = /^[-+]/.test(raw.replace(/^\s+/, ''))
      const hasSeparator = /[.,]/.test(raw)
      const looksLikeIdentifier = !hasCurrency && !hasSign && !hasSeparator && compactDigits.length >= 8
      out.push({ value, line, index, raw, hasCurrency, hasSign, hasSeparator, looksLikeIdentifier })
    }
  })
  return out
}

function moneyCandidateScore(candidate: MoneyCandidate, labelIndex?: number) {
  let score = 0
  if (candidate.hasCurrency) score += 30
  if (candidate.hasSeparator) score += 12
  if (candidate.hasSign) score += 8
  if (candidate.looksLikeIdentifier) score -= 45
  if (labelIndex !== undefined) {
    const delta = candidate.index - labelIndex
    score += Math.max(-30, 30 - Math.abs(delta) * 18)
    if (delta >= 0) score += 6
    if (delta === 0) score += 8
  }
  return score
}

function bestMoneyCandidate(candidates: MoneyCandidate[], labelIndex?: number, excluded?: MoneyCandidate) {
  return candidates
    .filter((candidate) => candidate !== excluded)
    .map((candidate) => ({ candidate, score: moneyCandidateScore(candidate, labelIndex) }))
    .sort((a, b) => b.score - a.score || a.candidate.index - b.candidate.index)[0]?.candidate
}

export function parseTransactionText(text: string): ParsedTransactionCandidate {
  const lines = text.split(/\r?\n/).map(normalizeOcrLine).filter(Boolean)
  const lower = lines.map((line) => line.toLocaleLowerCase('vi-VN'))
  const money = findMoneyCandidates(lines)

  const balanceIndex = lower.findIndex((line) => /số dư|so du|balance|available balance/.test(line))
  const balanceMoney = balanceIndex >= 0
    ? bestMoneyCandidate(money.filter((candidate) => Math.abs(candidate.index - balanceIndex) <= 2), balanceIndex)
    : undefined

  const amountKeywordIndex = lower.findIndex((line) => /số tiền|so tien|amount|giá trị|gia tri|thanh toán|thanh toan/.test(line))
  let amountCandidate = amountKeywordIndex >= 0
    ? bestMoneyCandidate(money.filter((candidate) => Math.abs(candidate.index - amountKeywordIndex) <= 2), amountKeywordIndex, balanceMoney)
    : undefined
  if (!amountCandidate) amountCandidate = bestMoneyCandidate(money, undefined, balanceMoney)

  const expenseHints = /thanh toán|thanh toan|chuyển tiền|chuyen tien|debit|trừ|tru|payment|purchase|chi tiêu|chi tieu/
  const incomeHints = /nhận tiền|nhan tien|credit|cộng|cong|incoming|received|thu nhập|thu nhap/
  const transferHints = /chuyển khoản|chuyen khoan|transfer/

  const joined = lower.join(' | ')
  let type: TransactionType = 'expense'
  if (incomeHints.test(joined)) type = 'income'
  else if (transferHints.test(joined) && !expenseHints.test(joined)) type = 'transfer'

  const occurredAt = parseDateTimeText(text)

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
    rawText: text,
  }
}
