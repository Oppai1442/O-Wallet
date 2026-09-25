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

interface FuzzyContextMatch {
  start: number
  end: number
  score: number
  exact: boolean
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) return 0
  if (!left.length) return right.length
  if (!right.length) return left.length
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[right.length]
}

function fuzzyTextSimilarity(left: string, right: string) {
  if (!left || !right) return 0
  if (left === right) return 1
  return 1 - levenshteinDistance(left, right) / Math.max(left.length, right.length)
}

function normalizedTokenRanges(text: string) {
  const tokens: Array<{ text: string; start: number; end: number }> = []
  const expression = /[a-z0-9]+/g
  let match: RegExpExecArray | null
  while ((match = expression.exec(text))) tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length })
  return tokens
}

function fuzzyContextMatches(sourceText: string, contexts?: string[]) {
  const sourceTokens = normalizedTokenRanges(sourceText)
  if (!sourceTokens.length || !contexts?.length) return [] as FuzzyContextMatch[]
  const matches: FuzzyContextMatch[] = []
  for (const rawContext of contexts) {
    const context = normalized(rawContext)
    const targetTokens = context.split(' ').filter(Boolean)
    if (!context || !targetTokens.length) continue
    const minWindow = Math.max(1, targetTokens.length - 1)
    const maxWindow = targetTokens.length + 1
    const threshold = context.length >= 8 ? 0.72 : 0.82
    for (let startToken = 0; startToken < sourceTokens.length; startToken += 1) {
      for (let size = minWindow; size <= maxWindow && startToken + size <= sourceTokens.length; size += 1) {
        const start = sourceTokens[startToken].start
        const end = sourceTokens[startToken + size - 1].end
        const candidate = sourceText.slice(start, end)
        const tokenPenalty = Math.abs(size - targetTokens.length) * 0.04
        const score = Math.max(0, fuzzyTextSimilarity(candidate, context) - tokenPenalty)
        if (score < threshold) continue
        matches.push({ start, end, score, exact: candidate === context })
      }
    }
  }
  return matches
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || a.start - b.start)
    .filter((match, index, all) => index === all.findIndex((item) => item.start === match.start && item.end === match.end))
    .slice(0, 16)
}

export interface OcrContextExtraction {
  value: string
  confidence: number
  prefixScore?: number
  suffixScore?: number
  fuzzy: boolean
}

export function extractBetweenOcrContextsDetailed(line: string, prefixes?: string[], suffixes?: string[]): OcrContextExtraction | undefined {
  const source = comparableWithMap(line)
  if (!source.text || (!prefixes?.length && !suffixes?.length)) return undefined
  const prefixMatches = fuzzyContextMatches(source.text, prefixes)
  const suffixMatches = fuzzyContextMatches(source.text, suffixes)
  const requiresPrefix = Boolean(prefixes?.length)
  const requiresSuffix = Boolean(suffixes?.length)
  if ((requiresPrefix && !prefixMatches.length) || (requiresSuffix && !suffixMatches.length)) return undefined

  const pairs: Array<{ start: number; end: number; prefix?: FuzzyContextMatch; suffix?: FuzzyContextMatch; score: number }> = []
  const prefixOptions: Array<FuzzyContextMatch | undefined> = requiresPrefix ? prefixMatches : [undefined]
  const suffixOptions: Array<FuzzyContextMatch | undefined> = requiresSuffix ? suffixMatches : [undefined]
  for (const prefix of prefixOptions) {
    for (const suffix of suffixOptions) {
      const start = prefix?.end ?? 0
      const end = suffix?.start ?? source.text.length
      if (end <= start) continue
      const gapLength = end - start
      if (gapLength > 180) continue
      const scores = [prefix?.score, suffix?.score].filter((value): value is number => value !== undefined)
      const anchorScore = scores.reduce((sum, value) => sum + value, 0) / Math.max(1, scores.length)
      const boundedGapBonus = Math.max(0, 1 - Math.max(0, gapLength - 80) / 200) * 0.02
      pairs.push({ start, end, prefix, suffix, score: anchorScore + boundedGapBonus })
    }
  }
  const best = pairs.sort((a, b) => b.score - a.score || (a.end - a.start) - (b.end - b.start))[0]
  if (!best) return undefined

  let start = best.start >= source.map.length ? line.length : (source.map[best.start] ?? 0)
  let end = best.end >= source.map.length ? line.length : (source.map[best.end] ?? line.length)
  while (start < end && /[\s:：\-–—\[\](){}]/.test(line[start])) start += 1
  while (end > start && /[\s:：\-–—\[\](){}]/.test(line[end - 1])) end -= 1
  const value = line.slice(start, end).trim()
  if (!value) return undefined
  const prefixScore = best.prefix?.score
  const suffixScore = best.suffix?.score
  const confidenceParts = [prefixScore, suffixScore].filter((value): value is number => value !== undefined)
  const confidence = confidenceParts.reduce((sum, value) => sum + value, 0) / Math.max(1, confidenceParts.length)
  return {
    value,
    confidence,
    prefixScore,
    suffixScore,
    fuzzy: Boolean((best.prefix && !best.prefix.exact) || (best.suffix && !best.suffix.exact)),
  }
}

export function extractBetweenOcrContexts(line: string, prefixes?: string[], suffixes?: string[]) {
  return extractBetweenOcrContextsDetailed(line, prefixes, suffixes)?.value
}

