import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Mic, RotateCcw, X } from 'lucide-react'
import type { Account, AppSettings, Category, TransactionType, VoiceInputField } from '../types'
import { useI18n } from '../i18n'
import {
  buildVoicePhrases,
  getVoiceSettings,
  matchAccountsByVoice,
  matchCategoriesByVoice,
  parseVoiceAmount,
  parseVoiceDate,
  parseVoiceTime,
  parseVoiceTransactionType,
  recognizeSpeech,
  speechRecognitionSupported,
  type VoiceOptionMatch,
} from '../lib/speech'
import { categoryPath } from '../lib/categories'
import { AccountSelect } from './AccountSelect'
import { CategoryPicker } from './CategoryPicker'
import { Button, Input, Textarea } from './ui'

export interface VoiceEntryDraft {
  type: TransactionType
  amount: string
  date: string
  time: string
  accountId: string
  destinationAccountId: string
  categoryId: string
  merchant: string
  description: string
}

function currentDateKey() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function currentTimeKey() {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

export function VoiceEntry({
  initial,
  settings,
  accounts,
  categories,
  onApply,
  onClose,
}: {
  initial: VoiceEntryDraft
  settings?: AppSettings
  accounts: Account[]
  categories: Category[]
  onApply: (draft: VoiceEntryDraft) => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const voice = getVoiceSettings(settings)
  const [draft, setDraft] = useState<VoiceEntryDraft>({
    ...initial,
    date: initial.date || currentDateKey(),
    time: initial.time || currentTimeKey(),
  })
  const fields = useMemo(() => voice.fieldOrder.filter((field) => field !== 'destinationAccount' || draft.type === 'transfer'), [voice.fieldOrder, draft.type])
  const [index, setIndex] = useState(0)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [heard, setHeard] = useState('')
  const [message, setMessage] = useState('')
  const [candidates, setCandidates] = useState<VoiceOptionMatch[]>([])
  const controllerRef = useRef<AbortController | undefined>(undefined)
  const supported = speechRecognitionSupported()
  const field = fields[Math.min(index, Math.max(0, fields.length - 1))] ?? 'amount'

  function patch(next: Partial<VoiceEntryDraft>) {
    setDraft((current) => ({ ...current, ...next }))
  }

  function valueLabel(target: VoiceInputField) {
    if (target === 'type') return t(`transaction.${draft.type}`)
    if (target === 'amount') return draft.amount ? Number(draft.amount).toLocaleString(locale) : t('voice.required')
    if (target === 'date') return draft.date || t('voice.defaultToday')
    if (target === 'time') return draft.time || t('voice.defaultNow')
    if (target === 'account') return accounts.find((item) => item.id === draft.accountId)?.name ?? t('common.none')
    if (target === 'destinationAccount') return accounts.find((item) => item.id === draft.destinationAccountId)?.name ?? t('common.none')
    if (target === 'category') {
      const category = categories.find((item) => item.id === draft.categoryId)
      return category ? categoryPath(category, categories) : t('common.none')
    }
    if (target === 'merchant') return draft.merchant || t('voice.emptyOptional')
    return draft.description || t('voice.emptyOptional')
  }

  function canAdvance(target: VoiceInputField) {
    if (target === 'amount') return Number(draft.amount) > 0
    if (target === 'account') return Boolean(draft.accountId)
    if (target === 'destinationAccount') return draft.type !== 'transfer' || Boolean(draft.destinationAccountId && draft.destinationAccountId !== draft.accountId)
    if (target === 'category') return true
    return true
  }

  function processTranscript(target: VoiceInputField, transcript: string) {
    setCandidates([])
    setMessage('')
    if (target === 'type') {
      const value = parseVoiceTransactionType(transcript)
      if (!value) return setMessage(t('voice.notUnderstood'))
      patch({ type: value })
      return
    }
    if (target === 'amount') {
      const value = parseVoiceAmount(transcript, voice.language)
      if (!value || value <= 0) return setMessage(t('voice.notUnderstood'))
      patch({ amount: String(Math.round(value * 100) / 100) })
      return
    }
    if (target === 'date') {
      const value = parseVoiceDate(transcript, voice.language)
      if (!value) return setMessage(t('voice.notUnderstood'))
      patch({ date: value })
      return
    }
    if (target === 'time') {
      const value = parseVoiceTime(transcript, voice.language)
      if (!value) return setMessage(t('voice.notUnderstood'))
      patch({ time: value })
      return
    }
    if (target === 'account' || target === 'destinationAccount') {
      const matches = matchAccountsByVoice(transcript, accounts.filter((item) => target !== 'destinationAccount' || item.id !== draft.accountId))
      if (!matches.length) return setMessage(t('voice.noMatch'))
      setCandidates(matches)
      if (matches.length === 1 || matches[0].score >= 0.9 || matches[0].score - (matches[1]?.score ?? 0) >= 0.25) {
        patch(target === 'account' ? { accountId: matches[0].id } : { destinationAccountId: matches[0].id })
      }
      return
    }
    if (target === 'category') {
      const matches = matchCategoriesByVoice(transcript, categories, draft.type)
      if (!matches.length) return setMessage(t('voice.noMatch'))
      setCandidates(matches)
      if (matches.length === 1 || matches[0].score >= 0.9 || matches[0].score - (matches[1]?.score ?? 0) >= 0.25) patch({ categoryId: matches[0].id })
      return
    }
    if (target === 'merchant') patch({ merchant: transcript.trim() })
    if (target === 'description') patch({ description: transcript.trim() })
  }

  async function listen() {
    if (!supported) return setMessage(t('voice.unsupported'))
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setListening(true)
    setInterim('')
    setHeard('')
    setMessage('')
    setCandidates([])
    try {
      const result = await recognizeSpeech({
        language: voice.language,
        phrases: [...buildVoicePhrases(field, accounts, categories, draft.type, voice.language), ...voice.corrections.map((item) => item.expected)],
        corrections: voice.corrections,
        signal: controller.signal,
        onInterim: setInterim,
      })
      setHeard(result.transcript)
      setInterim('')
      processTranscript(field, result.transcript)
    } catch (error) {
      if (error instanceof Error && error.message === 'error.voiceCancelled') return
      setMessage(t(error instanceof Error && error.message.startsWith('error.') ? error.message : 'error.voiceRecognition'))
    } finally {
      setListening(false)
    }
  }

  function chooseCandidate(candidate: VoiceOptionMatch) {
    if (field === 'account') patch({ accountId: candidate.id })
    else if (field === 'destinationAccount') patch({ destinationAccountId: candidate.id })
    else if (field === 'category') patch({ categoryId: candidate.id })
    setCandidates([])
  }

  function next() {
    if (!canAdvance(field)) return setMessage(t('voice.requiredHint'))
    setMessage('')
    setHeard('')
    setInterim('')
    setCandidates([])
    if (index >= fields.length - 1) {
      onApply(draft)
      return
    }
    setIndex((value) => value + 1)
  }

  function back() {
    controllerRef.current?.abort()
    setMessage('')
    setHeard('')
    setInterim('')
    setCandidates([])
    setIndex((value) => Math.max(0, value - 1))
  }

  function renderEditor() {
    if (field === 'type') return <div className="grid grid-cols-3 gap-2">{(['expense', 'income', 'transfer'] as TransactionType[]).map((value) => <button type="button" key={value} onClick={() => patch({ type: value })} className={`rounded-xl border px-3 py-3 text-sm font-semibold ${draft.type === value ? 'border-stone-950 bg-stone-950 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-950' : 'border-stone-200 text-stone-700 dark:border-stone-700 dark:text-stone-200'}`}>{t(`transaction.${value}`)}</button>)}</div>
    if (field === 'amount') return <Input type="number" inputMode="decimal" min="0" value={draft.amount} onChange={(event) => patch({ amount: event.target.value })} placeholder="150000" />
    if (field === 'date') return <Input type="date" value={draft.date} onChange={(event) => patch({ date: event.target.value })} />
    if (field === 'time') return <Input type="time" value={draft.time} onChange={(event) => patch({ time: event.target.value })} />
    if (field === 'account') return <AccountSelect accounts={accounts} catalogues={settings?.accountCatalogues ?? []} value={draft.accountId} onChange={(value) => patch({ accountId: value })} />
    if (field === 'destinationAccount') return <AccountSelect accounts={accounts} catalogues={settings?.accountCatalogues ?? []} value={draft.destinationAccountId} onChange={(value) => patch({ destinationAccountId: value })} excludeId={draft.accountId} />
    if (field === 'category') return <CategoryPicker categories={categories} type={draft.type} value={draft.categoryId} onChange={(value) => patch({ categoryId: value })} placeholder={t('categoryPicker.placeholder')} />
    if (field === 'merchant') return <Input value={draft.merchant} onChange={(event) => patch({ merchant: event.target.value })} />
    return <Textarea rows={3} value={draft.description} onChange={(event) => patch({ description: event.target.value })} />
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-stone-950/55 p-0 sm:items-center sm:p-4" onClick={(event) => { event.stopPropagation(); onClose() }}>
      <div className="w-full max-w-xl overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-stone-900 sm:rounded-3xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-800 sm:px-5">
          <div>
            <div className="text-sm font-semibold text-stone-950 dark:text-white">{t('voice.entryTitle')}</div>
            <div className="mt-0.5 text-xs text-stone-500">{t('voice.step', { current: index + 1, total: fields.length })}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"><X size={18} /></button>
        </div>

        <div className="p-4 sm:p-5">
          <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800"><div className="h-full rounded-full bg-stone-950 transition-all dark:bg-stone-100" style={{ width: `${Math.max(8, ((index + 1) / Math.max(fields.length, 1)) * 100)}%` }} /></div>

          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">{t(`voice.field.${field}`)}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-stone-950 dark:text-white">{valueLabel(field)}</div>
          <p className="mt-2 text-sm leading-6 text-stone-500">{t(`voice.help.${field}`)}</p>

          <div className="mt-5">{renderEditor()}</div>

          <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-4 text-center dark:border-stone-800 dark:bg-stone-950/60">
            <Button className="min-w-44" onClick={() => void listen()} disabled={listening || !supported}><Mic size={18} /> {listening ? t('voice.listening') : heard ? t('voice.listenAgain') : t('voice.listen')}</Button>
            {(interim || heard) && <div className="mt-3 text-sm text-stone-600 dark:text-stone-300">“{interim || heard}”</div>}
            {!supported && <div className="mt-2 text-xs text-amber-600 dark:text-amber-300">{t('voice.unsupported')}</div>}
            {message && <div className="mt-2 text-xs text-rose-600 dark:text-rose-300">{message}</div>}
          </div>

          {candidates.length > 0 && <div className="mt-3 space-y-2"><div className="text-xs font-medium text-stone-500">{t('voice.chooseMatch')}</div>{candidates.map((candidate) => <button type="button" key={candidate.id} onClick={() => chooseCandidate(candidate)} className="flex w-full items-center justify-between rounded-xl border border-stone-200 px-3 py-2.5 text-left text-sm text-stone-800 hover:bg-stone-50 dark:border-stone-800 dark:text-stone-100 dark:hover:bg-stone-800"><span className="min-w-0 truncate">{candidate.label}</span><span className="ml-3 text-xs text-stone-400">{Math.round(candidate.score * 100)}%</span></button>)}</div>}

          <div className="mt-6 flex items-center gap-2">
            <Button variant="secondary" onClick={back} disabled={index === 0}><ArrowLeft size={17} /> {t('common.back')}</Button>
            <Button variant="ghost" className="px-3" onClick={() => { setHeard(''); setInterim(''); setMessage(''); setCandidates([]) }}><RotateCcw size={16} /> {t('voice.clearResult')}</Button>
            <Button className="ml-auto" onClick={next} disabled={!canAdvance(field)}>{index >= fields.length - 1 ? <><Check size={17} /> {t('voice.apply')}</> : <>{t('common.next')} <ArrowRight size={17} /></>}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
