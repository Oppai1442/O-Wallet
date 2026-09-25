import type { OcrDetectedLine, OcrField, OcrValueType } from '../types'
import { parseDateTimeText, parseMoneyText } from './ocrParsing'

export interface OcrSemanticSuggestion {
  field: OcrField
  confidence: number
  valueType: OcrValueType
  reason: 'label' | 'context' | 'value-type' | 'identifier'
}

const LABELS: Array<{ field: Exclude<OcrField, 'generic' | 'ignore'>; terms: string[] }> = [
  { field: 'balanceAfter', terms: ['so du sau giao dich', 'so du kha dung', 'so du', 'available balance', 'remaining balance', 'balance after', 'balance'] },
  { field: 'amount', terms: ['so tien chuyen', 'so tien giao dich', 'so tien', 'transaction amount', 'transfer amount', 'amount'] },
  { field: 'occurredAt', terms: ['thoi gian giao dich', 'ngay giao dich', 'ngay gio', 'thoi gian', 'date & time', 'transaction time', 'transaction date', 'date', 'time'] },
  { field: 'merchant', terms: ['nguoi thu huong', 'nguoi nhan', 'nguoi chuyen', 'beneficiary', 'recipient', 'receiver', 'sender', 'merchant'] },
  { field: 'description', terms: ['noi dung chuyen tien', 'noi dung giao dich', 'noi dung', 'description', 'message', 'remark', 'memo'] },
]

const IGNORE_TERMS = [
  'ma tham chieu', 'ma giao dich', 'reference number', 'reference no', 'reference id',
  'transaction id', 'trace id', 'so tai khoan', 'account number', 'account no',
  'ma ngan hang', 'bank code', 'trang thai', 'status',
]

function normalized(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function includesTerm(text: string, terms: string[]) {
  return terms.find((term) => text.includes(term))
}

function labelSuggestion(text: string): OcrSemanticSuggestion | undefined {
  const value = normalized(text)
  if (!value) return undefined
  const ignored = includesTerm(value, IGNORE_TERMS)
  if (ignored) return { field: 'ignore', confidence: 0.98, valueType: 'digits', reason: 'identifier' }
  for (const entry of LABELS) {
    const term = includesTerm(value, entry.terms)
    if (!term) continue
    const valueType: OcrValueType = entry.field === 'amount' || entry.field === 'balanceAfter'
      ? 'money'
      : entry.field === 'occurredAt'
        ? 'datetime'
        : 'text'
    return { field: entry.field, confidence: 0.96, valueType, reason: 'label' }
  }
  return undefined
}

function inferredValueType(text: string): OcrValueType {
  if (parseDateTimeText(text)) return 'datetime'
  if (parseMoneyText(text) !== undefined) return 'money'
  if (/^\D*\d[\d\s._-]{5,}\D*$/.test(text)) return 'digits'
  return 'text'
}

function labelContext(lines: OcrDetectedLine[], index: number) {
  for (let offset = 1; offset <= 2; offset += 1) {
    const line = lines[index - offset]
    if (!line) continue
    const suggestion = labelSuggestion(line.text)
    if (suggestion) return { ...suggestion, confidence: Math.max(0.72, suggestion.confidence - (offset - 1) * 0.08), reason: 'context' as const }
  }
  return undefined
}

export function suggestOcrLine(lines: OcrDetectedLine[], index: number): OcrSemanticSuggestion | undefined {
  const line = lines[index]
  if (!line) return undefined
  const direct = labelSuggestion(line.text)
  const valueType = inferredValueType(line.text)

  if (direct?.field === 'ignore') return direct

  const context = labelContext(lines, index)
  if (context) {
    if (context.field === 'ignore') return { ...context, valueType }
    if ((context.field === 'amount' || context.field === 'balanceAfter') && valueType === 'money') return { ...context, valueType }
    if (context.field === 'occurredAt' && valueType === 'datetime') return { ...context, valueType }
    if ((context.field === 'merchant' || context.field === 'description') && valueType === 'text') return { ...context, valueType }
  }

  if (direct) return { ...direct, valueType }
  if (valueType === 'datetime') return { field: 'occurredAt', confidence: 0.78, valueType, reason: 'value-type' }
  if (valueType === 'digits') return { field: 'ignore', confidence: 0.64, valueType, reason: 'identifier' }
  if (valueType === 'money') {
    const priorMoney = lines.slice(0, index).filter((candidate) => inferredValueType(candidate.text) === 'money').length
    return {
      field: priorMoney === 0 ? 'amount' : 'balanceAfter',
      confidence: priorMoney === 0 ? 0.62 : 0.48,
      valueType,
      reason: 'value-type',
    }
  }
  return undefined
}

export function suggestOcrMappings(lines: OcrDetectedLine[], minConfidence = 0.76) {
  const mappings: Record<string, OcrField | ''> = {}
  for (let index = 0; index < lines.length; index += 1) {
    const suggestion = suggestOcrLine(lines, index)
    if (suggestion && suggestion.confidence >= minConfidence) mappings[lines[index].id] = suggestion.field
  }
  return mappings
}
