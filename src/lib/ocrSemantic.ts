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

  if (direct?.field === 'ignore') {
    const hasOwnDigits = /\d/.test(line.text)
    if (hasOwnDigits) return direct
    return undefined
  }

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


export interface OcrCustomInputMatch {
  line: OcrDetectedLine
  field: OcrField
  confidence: number
  prefix?: string
  suffix?: string
  exactSubstring: boolean
}

function compactWords(value: string) {
  return normalized(value).split(' ').filter(Boolean)
}

function textSimilarity(left: string, right: string) {
  const a = new Set(compactWords(left))
  const b = new Set(compactWords(right))
  if (!a.size || !b.size) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  return intersection / Math.max(a.size, b.size)
}

function moneyCandidates(text: string) {
  const chunks = text.match(/[-+]?\d[\d\s.,]{1,24}(?:\s*(?:đ|₫|vnd|usd|eur))?/gi) ?? []
  return chunks.map((chunk) => parseMoneyText(chunk)).filter((value): value is number => value !== undefined)
}

function surroundingContext(lineText: string, expected: string) {
  const line = normalized(lineText)
  const target = normalized(expected)
  const index = target ? line.indexOf(target) : -1
  if (index < 0) return {}
  const before = line.slice(0, index).trim().split(' ').filter(Boolean)
  const after = line.slice(index + target.length).trim().split(' ').filter(Boolean)
  return {
    prefix: before.slice(-6).join(' ') || undefined,
    suffix: after.slice(0, 6).join(' ') || undefined,
  }
}

export function findOcrCustomInputMatch(lines: OcrDetectedLine[], field: OcrField, expected: string): OcrCustomInputMatch | undefined {
  const target = expected.trim()
  if (!target || field === 'generic' || field === 'ignore') return undefined
  const targetNormalized = normalized(target)
  const targetMoney = field === 'amount' || field === 'balanceAfter' ? parseMoneyText(target) : undefined
  const targetDate = field === 'occurredAt' ? parseDateTimeText(target) : undefined
  const ranked = lines.map((line) => {
    const lineNormalized = normalized(line.text)
    let score = 0
    let exactSubstring = false
    if (targetNormalized && lineNormalized.includes(targetNormalized)) {
      exactSubstring = true
      score = targetNormalized === lineNormalized ? 1 : 0.97
    } else if (targetMoney !== undefined && moneyCandidates(line.text).some((value) => Math.abs(value - targetMoney) <= 0.01)) {
      score = 0.96
    } else if (targetDate) {
      const parsed = parseDateTimeText(line.text)
      if (parsed && Math.abs(Date.parse(parsed) - Date.parse(targetDate)) <= 60_000) score = 0.95
    } else if (field === 'merchant' || field === 'description') {
      score = textSimilarity(line.text, target) * 0.88
    }
    return { line, score, exactSubstring }
  }).filter((item) => item.score >= 0.58).sort((a, b) => b.score - a.score || b.line.confidence - a.line.confidence)
  const best = ranked[0]
  if (!best) return undefined
  const context = best.exactSubstring ? surroundingContext(best.line.text, target) : {}
  return {
    line: best.line,
    field,
    confidence: Math.min(1, best.score * 0.85 + Math.max(0, Math.min(1, best.line.confidence / 100)) * 0.15),
    prefix: context.prefix,
    suffix: context.suffix,
    exactSubstring: best.exactSubstring,
  }
}

function comparableWithMap(value: string) {
  let normalizedText = ''
  const map: number[] = []
  let previousSpace = false
  for (let index = 0; index < value.length; index += 1) {
    const folded = value[index]
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/gi, 'd')
      .toLocaleLowerCase('vi-VN')
    for (const char of folded) {
      const isWord = /[a-z0-9]/.test(char)
      if (isWord) {
        normalizedText += char
        map.push(index)
        previousSpace = false
      } else if (!previousSpace && normalizedText.length) {
        normalizedText += ' '
        map.push(index)
        previousSpace = true
      }
    }
  }
  while (normalizedText.endsWith(' ')) {
    normalizedText = normalizedText.slice(0, -1)
    map.pop()
  }
  return { text: normalizedText, map }
}

export function extractBetweenOcrContexts(line: string, prefixes?: string[], suffixes?: string[]) {
  const source = comparableWithMap(line)
  const prefixMatches = (prefixes ?? []).map(normalized).filter(Boolean).map((prefix) => {
    const index = source.text.indexOf(prefix)
    return index < 0 ? undefined : { index, end: index + prefix.length }
  }).filter((value): value is { index: number; end: number } => Boolean(value)).sort((a, b) => b.end - a.end)
  const startNormalized = prefixMatches[0]?.end ?? 0
  const suffixMatches = (suffixes ?? []).map(normalized).filter(Boolean).map((suffix) => {
    const index = source.text.indexOf(suffix, startNormalized)
    return index < 0 ? undefined : { index }
  }).filter((value): value is { index: number } => Boolean(value)).sort((a, b) => a.index - b.index)
  const endNormalized = suffixMatches[0]?.index ?? source.text.length
  if ((!prefixMatches.length && !suffixMatches.length) || endNormalized <= startNormalized) return undefined
  let start = source.map[Math.min(startNormalized, source.map.length - 1)] ?? 0
  let end = endNormalized >= source.map.length ? line.length : (source.map[endNormalized] ?? line.length)
  while (start < end && /[\s:：\-–—\[\](){}]/.test(line[start])) start += 1
  while (end > start && /[\s:：\-–—\[\](){}]/.test(line[end - 1])) end -= 1
  const extracted = line.slice(start, end).trim()
  return extracted || undefined
}
