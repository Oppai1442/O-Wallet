import type { Account, AppSettings, Category, TransactionType, VoiceAccentCorrection, VoiceInputField, VoiceInputLanguage } from '../types'
import { categoryPath, selectableCategories } from './categories'

export const DEFAULT_VOICE_FIELDS: VoiceInputField[] = [
  'type',
  'amount',
  'date',
  'time',
  'account',
  'destinationAccount',
  'category',
  'merchant',
  'description',
]

export function defaultVoiceLanguage(appLanguage?: string): VoiceInputLanguage {
  return appLanguage === 'en' ? 'en-US' : 'vi-VN'
}

export function getVoiceSettings(settings?: AppSettings) {
  const configuredLanguage = settings?.voiceInput?.language
  const language: VoiceInputLanguage = configuredLanguage === 'en-US' || configuredLanguage === 'vi-VN'
    ? configuredLanguage
    : defaultVoiceLanguage(settings?.language)
  const allowed = new Set<VoiceInputField>(DEFAULT_VOICE_FIELDS)
  const fieldOrder = [...new Set((settings?.voiceInput?.fieldOrder ?? []).filter((field): field is VoiceInputField => allowed.has(field as VoiceInputField)))]
  const corrections = (settings?.voiceInput?.corrections ?? [])
    .filter((item) => typeof item?.heard === 'string' && typeof item?.expected === 'string')
    .filter((item) => item.heard.trim().length > 0 && item.expected.trim().length > 0)
    .slice(-120)
  return {
    language,
    fieldOrder: fieldOrder.length ? fieldOrder : DEFAULT_VOICE_FIELDS,
    corrections,
    calibrationCompletedAt: settings?.voiceInput?.calibrationCompletedAt,
  }
}

export function speechRecognitionSupported() {
  const scope = window as typeof window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
  return Boolean(scope.SpeechRecognition || scope.webkitSpeechRecognition)
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s:/.+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function applyVoiceCorrections(raw: string, corrections: VoiceAccentCorrection[]) {
  let output = raw.trim()
  const sorted = [...corrections]
    .filter((item) => item.heard.trim() && item.expected.trim())
    .sort((a, b) => b.heard.length - a.heard.length)
  for (const correction of sorted) {
    const heard = correction.heard.trim()
    const expected = correction.expected.trim()
    const index = normalize(output).indexOf(normalize(heard))
    if (index < 0) continue
    // Whole-phrase replacements are the most reliable accent adaptation we can do
    // without training an acoustic model. For substring replacements, fall back to a
    // conservative case-insensitive textual replacement when the original text matches.
    if (normalize(output) === normalize(heard)) {
      output = expected
      continue
    }
    const escaped = heard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    output = output.replace(new RegExp(escaped, 'ig'), expected)
  }
  return output
}

export interface SpeechRecognitionResultValue {
  transcript: string
  alternatives: string[]
}

export function recognizeSpeech({
  language,
  phrases = [],
  corrections = [],
  signal,
  onInterim,
  timeoutMs = 9000,
}: {
  language: VoiceInputLanguage
  phrases?: string[]
  corrections?: VoiceAccentCorrection[]
  signal?: AbortSignal
  onInterim?: (value: string) => void
  timeoutMs?: number
}): Promise<SpeechRecognitionResultValue> {
  const scope = window as typeof window & {
    SpeechRecognition?: new () => any
    webkitSpeechRecognition?: new () => any
    SpeechRecognitionPhrase?: new (phrase: string, boost?: number) => unknown
  }
  const Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition
  if (!Recognition) return Promise.reject(new Error('error.voiceUnsupported'))

  return new Promise((resolve, reject) => {
    const recognition = new Recognition()
    recognition.lang = language
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 3

    const cleanedPhrases = [...new Set(phrases.map((item) => item.trim()).filter(Boolean))].slice(0, 80)
    if (cleanedPhrases.length && scope.SpeechRecognitionPhrase) {
      try {
        recognition.phrases = cleanedPhrases.map((phrase) => new scope.SpeechRecognitionPhrase!(phrase, 4.5))
      } catch {
        // Contextual biasing is experimental. Recognition still works without it.
      }
    }

    let settled = false
    let bestFinal = ''
    let latestInterim = ''
    let alternatives: string[] = []
    const settle = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      try { recognition.abort() } catch { /* ignore */ }
      if (error) reject(error)
      else if (!bestFinal.trim()) reject(new Error('error.voiceNoSpeech'))
      else {
        const corrected = applyVoiceCorrections(bestFinal, corrections)
        resolve({ transcript: corrected, alternatives: alternatives.map((item) => applyVoiceCorrections(item, corrections)) })
      }
    }
    const onAbort = () => settle(new Error('error.voiceCancelled'))
    signal?.addEventListener('abort', onAbort, { once: true })

    const timer = window.setTimeout(() => settle(new Error('error.voiceTimeout')), timeoutMs)
    recognition.onresult = (event: any) => {
      let interim = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const first = String(result?.[0]?.transcript ?? '').trim()
        if (!first) continue
        if (result.isFinal) {
          bestFinal = first
          alternatives = Array.from(result as ArrayLike<{ transcript?: string }>)
            .map((item) => String(item?.transcript ?? '').trim())
            .filter(Boolean)
        } else {
          interim = `${interim} ${first}`.trim()
        }
      }
      if (interim) { latestInterim = interim; onInterim?.(applyVoiceCorrections(interim, corrections)) }
      if (bestFinal) {
        try { recognition.stop() } catch { /* ignore */ }
      }
    }
    recognition.onerror = (event: any) => {
      const code = String(event?.error ?? '')
      if (code === 'not-allowed' || code === 'service-not-allowed') return settle(new Error('error.voicePermission'))
      if (code === 'no-speech') return settle(new Error('error.voiceNoSpeech'))
      if (code === 'aborted' && signal?.aborted) return settle(new Error('error.voiceCancelled'))
      settle(new Error('error.voiceRecognition'))
    }
    recognition.onspeechend = () => { try { recognition.stop() } catch { /* ignore */ } }
    recognition.onend = () => {
      if (!bestFinal && latestInterim.trim()) { bestFinal = latestInterim.trim(); alternatives = [bestFinal] }
      if (bestFinal) settle()
      else if (!settled) settle(new Error('error.voiceNoSpeech'))
    }
    try {
      recognition.start()
    } catch {
      settle(new Error('error.voiceRecognition'))
    }
  })
}

const VI_UNITS: Record<string, number> = {
  khong: 0, mot: 1, hai: 2, ba: 3, bon: 4, tu: 4, nam: 5, lam: 5, sau: 6, bay: 7, tam: 8, chin: 9,
}
const EN_SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16,
  seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
}

function parseVietnameseWords(raw: string) {
  const tokens = normalize(raw).split(' ').filter(Boolean)
  let total = 0
  let group = 0
  let current = 0
  let recognized = false
  for (const token of tokens) {
    if (token === 'linh' || token === 'le' || token === 'va' || token === 'dong') continue
    if (token in VI_UNITS) {
      current = VI_UNITS[token]
      recognized = true
      continue
    }
    if (token === 'muoi') {
      group += (current || 1) * 10
      current = 0
      recognized = true
      continue
    }
    if (token === 'tram') {
      group += (current || 1) * 100
      current = 0
      recognized = true
      continue
    }
    if (token === 'nghin' || token === 'ngan' || token === 'k') {
      group += current
      total += (group || 1) * 1000
      group = 0
      current = 0
      recognized = true
      continue
    }
    if (token === 'trieu') {
      group += current
      total += (group || 1) * 1_000_000
      group = 0
      current = 0
      recognized = true
      continue
    }
    if (token === 'ty') {
      group += current
      total += (group || 1) * 1_000_000_000
      group = 0
      current = 0
      recognized = true
      continue
    }
  }
  return recognized ? total + group + current : undefined
}

function parseEnglishWords(raw: string) {
  const tokens = normalize(raw).replaceAll('-', ' ').split(' ').filter(Boolean)
  let total = 0
  let group = 0
  let recognized = false
  for (const token of tokens) {
    if (token === 'and' || token === 'dollars' || token === 'dollar') continue
    if (token in EN_SMALL) {
      group += EN_SMALL[token]
      recognized = true
      continue
    }
    if (token === 'hundred') {
      group = (group || 1) * 100
      recognized = true
      continue
    }
    if (token === 'thousand' || token === 'k') {
      total += (group || 1) * 1000
      group = 0
      recognized = true
      continue
    }
    if (token === 'million') {
      total += (group || 1) * 1_000_000
      group = 0
      recognized = true
      continue
    }
    if (token === 'billion') {
      total += (group || 1) * 1_000_000_000
      group = 0
      recognized = true
      continue
    }
  }
  return recognized ? total + group : undefined
}

export function parseVoiceAmount(raw: string, language: VoiceInputLanguage) {
  const normalized = normalize(raw)
  const numeric = normalized.match(/(?:^|\s)(\d[\d.,]*)(?:\s*)(k|nghin|ngan|trieu|ty|thousand|million|billion)?(?:\s|$)/)
  if (numeric) {
    const base = Number(numeric[1].replace(/[.,](?=\d{3}(?:\D|$))/g, '').replace(',', '.'))
    if (Number.isFinite(base)) {
      const unit = numeric[2]
      const multiplier = unit === 'k' || unit === 'nghin' || unit === 'ngan' || unit === 'thousand' ? 1_000
        : unit === 'trieu' || unit === 'million' ? 1_000_000
          : unit === 'ty' || unit === 'billion' ? 1_000_000_000 : 1
      return base * multiplier
    }
  }
  return language === 'vi-VN' ? parseVietnameseWords(raw) : parseEnglishWords(raw)
}

function dateKey(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseVoiceDate(raw: string, language: VoiceInputLanguage, now = new Date()) {
  const text = normalize(raw)
  if (['hom nay', 'today'].includes(text)) return dateKey(now)
  if (['hom qua', 'yesterday'].includes(text)) { const d = new Date(now); d.setDate(d.getDate() - 1); return dateKey(d) }
  if (['ngay mai', 'tomorrow'].includes(text)) { const d = new Date(now); d.setDate(d.getDate() + 1); return dateKey(d) }

  const numeric = text.match(/(?:ngay\s*)?(\d{1,2})[\s/.\-]+(?:thang\s*)?(\d{1,2})(?:[\s/.\-]+(?:nam\s*)?(\d{2,4}))?/)
  if (numeric) {
    let year = numeric[3] ? Number(numeric[3]) : now.getFullYear()
    if (year < 100) year += 2000
    const month = Number(numeric[2])
    const day = Number(numeric[1])
    const d = new Date(year, month - 1, day)
    if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return dateKey(d)
  }

  if (language === 'vi-VN') {
    const tokens = text.split(' ').filter(Boolean)
    const monthIndex = tokens.indexOf('thang')
    if (monthIndex > 0) {
      const dayStart = tokens[0] === 'ngay' ? 1 : 0
      const day = parseVietnameseWords(tokens.slice(dayStart, monthIndex).join(' '))
      const yearIndex = tokens.indexOf('nam', monthIndex + 1)
      const monthEnd = yearIndex > monthIndex ? yearIndex : tokens.length
      const month = parseVietnameseWords(tokens.slice(monthIndex + 1, monthEnd).join(' '))
      let year = now.getFullYear()
      if (yearIndex > 0) {
        const yearText = tokens.slice(yearIndex + 1).join(' ')
        const numericYear = yearText.match(/\b\d{4}\b/)
        if (numericYear) year = Number(numericYear[0])
      }
      if (day && month && day <= 31 && month <= 12) {
        const d = new Date(year, month - 1, day)
        if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return dateKey(d)
      }
    }
  } else {
    const months: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 }
    const tokens = text.replaceAll('-', ' ').split(' ').filter(Boolean)
    const monthIndex = tokens.findIndex((token) => token in months)
    if (monthIndex >= 0) {
      const month = months[tokens[monthIndex]]
      const yearToken = tokens.find((token) => /^\d{4}$/.test(token))
      const year = yearToken ? Number(yearToken) : now.getFullYear()
      const before = tokens.slice(Math.max(0, monthIndex - 2), monthIndex).filter((token) => !/^\d{4}$/.test(token))
      const after = tokens.slice(monthIndex + 1).filter((token) => !/^\d{4}$/.test(token)).slice(0, 2)
      const numericDay = [...before, ...after].find((token) => /^\d{1,2}(?:st|nd|rd|th)?$/.test(token))
      const day = numericDay ? Number(numericDay.match(/\d{1,2}/)?.[0]) : parseEnglishWords((after.length ? after : before).join(' '))
      if (day && day <= 31) {
        const d = new Date(year, month - 1, day)
        if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return dateKey(d)
      }
    }
  }
  return undefined
}

export function parseVoiceTime(raw: string, language: VoiceInputLanguage, now = new Date()) {
  const text = normalize(raw)
  if (['bay gio', 'hien tai', 'now', 'right now'].includes(text)) {
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  }
  const clock = text.match(/\b(\d{1,2})[:h](\d{1,2})\b/)
  if (clock) {
    let hour = Number(clock[1])
    const minute = Number(clock[2])
    if (/\b(pm|chieu|toi)\b/.test(text) && hour < 12) hour += 12
    if (/\b(am|sang)\b/.test(text) && hour === 12) hour = 0
    if (hour <= 23 && minute <= 59) return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  let hour: number | undefined
  let minute = 0
  if (language === 'vi-VN') {
    const tokens = text.split(' ').filter(Boolean)
    const markerIndex = tokens.indexOf('gio')
    if (markerIndex > 0) {
      const hourTokens = tokens.slice(0, markerIndex).filter((token) => token !== 'luc')
      hour = parseVietnameseWords(hourTokens.join(' '))
      const suffix = tokens.slice(markerIndex + 1)
      const minuteTokens = suffix.filter((token) => !['phut', 'sang', 'chieu', 'toi'].includes(token))
      if (minuteTokens.includes('ruoi')) minute = 30
      else if (minuteTokens.length) minute = parseVietnameseWords(minuteTokens.join(' ')) ?? 0
    }
  } else {
    const tokens = text.replaceAll('-', ' ').split(' ').filter((token) => !['at', 'oclock', 'am', 'pm'].includes(token))
    if (tokens.length) {
      hour = /^\d{1,2}$/.test(tokens[0]) ? Number(tokens[0]) : parseEnglishWords(tokens[0])
      if (tokens.length > 1) {
        const minuteText = tokens.slice(1).join(' ')
        minute = /^\d{1,2}$/.test(tokens[1]) && tokens.length === 2 ? Number(tokens[1]) : parseEnglishWords(minuteText) ?? 0
      }
    }
  }
  if (hour !== undefined) {
    if (/\b(pm|chieu|toi)\b/.test(text) && hour < 12) hour += 12
    if (/\b(am|sang)\b/.test(text) && hour === 12) hour = 0
    if (hour <= 23 && minute <= 59) return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }
  return undefined
}

export function parseVoiceTransactionType(raw: string): TransactionType | undefined {
  const text = normalize(raw)
  if (/\b(chuyen|chuyen khoan|transfer)\b/.test(text)) return 'transfer'
  if (/\b(thu|thu nhap|income|receive|received)\b/.test(text)) return 'income'
  if (/\b(chi|chi tieu|expense|spend|spent)\b/.test(text)) return 'expense'
  return undefined
}

export interface VoiceOptionMatch {
  id: string
  label: string
  score: number
}

function tokenSet(value: string) {
  return new Set(normalize(value).split(' ').filter(Boolean))
}

function scoreLabel(query: string, label: string) {
  const q = normalize(query)
  const l = normalize(label)
  if (!q || !l) return 0
  if (q === l) return 1
  if (l.includes(q)) return Math.min(0.96, 0.78 + q.length / Math.max(l.length, 1) * 0.16)
  if (q.includes(l)) return 0.86
  const qa = tokenSet(q)
  const la = tokenSet(l)
  const overlap = [...qa].filter((token) => la.has(token)).length
  if (!overlap) return 0
  return overlap / Math.max(qa.size, la.size) * 0.72
}

export function matchAccountsByVoice(raw: string, accounts: Account[], limit = 4): VoiceOptionMatch[] {
  return accounts
    .filter((item) => !item.archived)
    .map((item) => ({ id: item.id, label: item.name, score: scoreLabel(raw, item.name) }))
    .filter((item) => item.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export function matchCategoriesByVoice(raw: string, categories: Category[], type: TransactionType, limit = 4): VoiceOptionMatch[] {
  return selectableCategories(categories, type)
    .map((item) => ({ id: item.id, label: categoryPath(item, categories), score: scoreLabel(raw, categoryPath(item, categories)) }))
    .filter((item) => item.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export function buildVoicePhrases(field: VoiceInputField, accounts: Account[], categories: Category[], type: TransactionType, language: VoiceInputLanguage) {
  const common = language === 'vi-VN'
    ? ['chi tiêu', 'thu nhập', 'chuyển khoản', 'hôm nay', 'hôm qua', 'ngày mai', 'tiền mặt']
    : ['expense', 'income', 'transfer', 'today', 'yesterday', 'tomorrow', 'cash']
  if (field === 'account' || field === 'destinationAccount') return [...common, ...accounts.map((item) => item.name)].slice(0, 80)
  if (field === 'category') return [...common, ...selectableCategories(categories, type).map((item) => categoryPath(item, categories))].slice(0, 80)
  return common
}

export function deriveCalibrationCorrections(heard: string, expected: string): VoiceAccentCorrection[] {
  const h = heard.trim()
  const e = expected.trim()
  if (!h || !e || normalize(h) === normalize(e)) return []
  const now = new Date().toISOString()
  const result: VoiceAccentCorrection[] = [{ heard: h, expected: e, updatedAt: now }]
  const hRaw = h.split(/\s+/).filter(Boolean)
  const eRaw = e.split(/\s+/).filter(Boolean)
  if (hRaw.length === eRaw.length && hRaw.length <= 16) {
    for (let i = 0; i < hRaw.length; i += 1) {
      if (normalize(hRaw[i]) === normalize(eRaw[i]) || normalize(hRaw[i]).length < 2) continue
      result.push({ heard: hRaw[i], expected: eRaw[i], updatedAt: now })
    }
  }
  return result
}

export function mergeVoiceCorrections(current: VoiceAccentCorrection[], incoming: VoiceAccentCorrection[]) {
  const map = new Map<string, VoiceAccentCorrection>()
  for (const item of [...current, ...incoming]) {
    const key = normalize(item.heard)
    if (!key) continue
    map.set(key, item)
  }
  return [...map.values()].slice(-120)
}
