import type { VoiceAccentCorrection, VoiceInputLanguage } from '../types'
import { applyVoiceCorrections } from './speech'
import { reportDiagnostic } from './security'

export interface SpeechRecognitionResultValue {
  transcript: string
  alternatives: string[]
}

type RecognitionCtor = (new () => any) & {
  available?: (options: { langs: string[]; processLocally?: boolean; quality?: string }) => Promise<string>
}

type SpeechScope = typeof window & {
  SpeechRecognition?: RecognitionCtor
  webkitSpeechRecognition?: RecognitionCtor
  SpeechRecognitionPhrase?: new (phrase: string, boost?: number) => unknown
}

type RecognitionFailure = Error & { speechCode?: string }

function recognitionCtor() {
  const scope = window as SpeechScope
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition
}

export function speechRecognitionSupported() {
  return Boolean(recognitionCtor())
}

function failure(code: string, fallback = 'error.voiceRecognition') {
  const error = new Error(fallback) as RecognitionFailure
  error.speechCode = code
  return error
}

function errorKeyForCode(code: string) {
  if (code === 'not-allowed') return 'error.voicePermission'
  if (code === 'no-speech') return 'error.voiceNoSpeech'
  if (code === 'aborted') return 'error.voiceCancelled'
  return 'error.voiceRecognition'
}

function runRecognition({
  language,
  phrases,
  corrections,
  signal,
  onInterim,
  timeoutMs,
  processLocally,
  usePhrases,
}: {
  language: VoiceInputLanguage
  phrases: string[]
  corrections: VoiceAccentCorrection[]
  signal?: AbortSignal
  onInterim?: (value: string) => void
  timeoutMs: number
  processLocally: boolean
  usePhrases: boolean
}): Promise<SpeechRecognitionResultValue> {
  const scope = window as SpeechScope
  const Recognition = recognitionCtor()
  if (!Recognition) return Promise.reject(new Error('error.voiceUnsupported'))

  return new Promise((resolve, reject) => {
    const recognition = new Recognition()
    recognition.lang = language
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 3
    if ('processLocally' in recognition) recognition.processLocally = processLocally

    const cleanedPhrases = [...new Set(phrases.map((item) => item.trim()).filter(Boolean))].slice(0, 80)
    if (usePhrases && cleanedPhrases.length && scope.SpeechRecognitionPhrase) {
      try {
        recognition.phrases = cleanedPhrases.map((phrase) => new scope.SpeechRecognitionPhrase!(phrase, 4.5))
      } catch (error) {
        reportDiagnostic('voice-phrase-bias-init', error)
      }
    }

    let settled = false
    let bestFinal = ''
    let latestInterim = ''
    let alternatives: string[] = []
    let timer = 0

    const settle = (error?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      try { recognition.abort() } catch { /* ignore */ }
      if (error) reject(error)
      else if (!bestFinal.trim()) reject(new Error('error.voiceNoSpeech'))
      else {
        const corrected = applyVoiceCorrections(bestFinal, corrections)
        resolve({
          transcript: corrected,
          alternatives: alternatives.map((item) => applyVoiceCorrections(item, corrections)),
        })
      }
    }

    const onAbort = () => settle(new Error('error.voiceCancelled'))
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = window.setTimeout(() => settle(new Error('error.voiceTimeout')), timeoutMs)

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
      if (interim) {
        latestInterim = interim
        onInterim?.(applyVoiceCorrections(interim, corrections))
      }
      if (bestFinal) {
        try { recognition.stop() } catch { /* ignore */ }
      }
    }

    recognition.onerror = (event: any) => {
      const code = String(event?.error ?? 'unknown')
      const detail = String(event?.message ?? '')
      reportDiagnostic('voice-recognition', new Error(`${code}${detail ? `: ${detail}` : ''}`))
      if (code === 'aborted' && signal?.aborted) return settle(new Error('error.voiceCancelled'))
      settle(failure(code, errorKeyForCode(code)))
    }

    recognition.onspeechend = () => {
      try { recognition.stop() } catch { /* ignore */ }
    }

    recognition.onend = () => {
      if (!bestFinal && latestInterim.trim()) {
        bestFinal = latestInterim.trim()
        alternatives = [bestFinal]
      }
      if (bestFinal) settle()
      else if (!settled) settle(new Error('error.voiceNoSpeech'))
    }

    try {
      recognition.start()
    } catch (error) {
      reportDiagnostic('voice-recognition-start', error)
      settle(failure('start-failed'))
    }
  })
}

async function localRecognitionAvailable(language: VoiceInputLanguage) {
  const Recognition = recognitionCtor()
  if (!Recognition?.available) return false
  try {
    const status = await Recognition.available({ langs: [language], processLocally: true, quality: 'dictation' })
    return status === 'available'
  } catch (error) {
    reportDiagnostic('voice-local-availability', error)
    return false
  }
}

export async function recognizeSpeech({
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
  if (!speechRecognitionSupported()) throw new Error('error.voiceUnsupported')

  const attempt = (processLocally: boolean, usePhrases: boolean) => runRecognition({
    language,
    phrases,
    corrections,
    signal,
    onInterim,
    timeoutMs,
    processLocally,
    usePhrases,
  })

  try {
    return await attempt(false, true)
  } catch (error) {
    if (signal?.aborted) throw new Error('error.voiceCancelled')
    const code = (error as RecognitionFailure)?.speechCode

    if (code === 'phrases-not-supported') {
      return attempt(false, false)
    }

    if (code === 'network' || code === 'service-not-allowed' || code === 'language-not-supported' || code === 'language-unavailable') {
      if (await localRecognitionAvailable(language)) {
        try {
          return await attempt(true, false)
        } catch (localError) {
          if (signal?.aborted) throw new Error('error.voiceCancelled')
          const localCode = (localError as RecognitionFailure)?.speechCode
          if (localCode === 'not-allowed') throw new Error('error.voicePermission')
          throw failure(localCode || code)
        }
      }
    }

    throw error
  }
}

export function voiceRecognitionErrorText(error: unknown, locale: string) {
  const code = (error as RecognitionFailure)?.speechCode
  const vi = locale.toLowerCase().startsWith('vi')
  if (code === 'network') return vi
    ? 'Dịch vụ nhận dạng giọng nói của trình duyệt không kết nối được mạng. Mic vẫn có thể hoạt động bình thường.'
    : 'The browser speech-recognition service could not reach the network. Your microphone can still be working normally.'
  if (code === 'audio-capture') return vi
    ? 'Trình nhận dạng giọng nói không lấy được audio từ mic, dù mic test có thể vẫn chạy. Hãy thử đóng app/tab khác đang giữ mic rồi thử lại.'
    : 'Speech recognition could not capture microphone audio even though a microphone test may still work. Close other apps/tabs using the mic and try again.'
  if (code === 'language-not-supported' || code === 'language-unavailable') return vi
    ? 'Engine nhận dạng giọng nói hiện không hỗ trợ ngôn ngữ đã chọn trên thiết bị/trình duyệt này.'
    : 'The speech-recognition engine does not currently support the selected language on this browser/device.'
  if (code === 'service-not-allowed') return vi
    ? 'Trình duyệt đang chặn hoặc không cho phép dịch vụ nhận dạng giọng nói. Đây không nhất thiết là lỗi quyền microphone.'
    : 'The browser is blocking or disallowing its speech-recognition service. This is not necessarily a microphone-permission problem.'
  if (code === 'phrases-not-supported') return vi
    ? 'Engine không hỗ trợ contextual phrase biasing; O-Wallet đã thử lại mà không dùng tính năng này.'
    : 'The engine does not support contextual phrase biasing; O-Wallet retried without it.'
  return undefined
}
