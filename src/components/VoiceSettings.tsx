import { useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Mic, RotateCcw } from 'lucide-react'
import type { AppSettings, VoiceInputField, VoiceInputLanguage } from '../types'
import { useI18n } from '../i18n'
import {
  DEFAULT_VOICE_FIELDS,
  deriveCalibrationCorrections,
  getVoiceSettings,
  mergeVoiceCorrections,
} from '../lib/speech'
import { recognizeSpeech, speechRecognitionSupported, voiceRecognitionErrorText } from '../lib/speechRecognition'
import { Button, Card, Select } from './ui'

const SAMPLES: Record<VoiceInputLanguage, Array<{ id: string; text: string }>> = {
  'vi-VN': [
    { id: 'amount', text: 'một trăm hai mươi lăm nghìn đồng' },
    { id: 'date', text: 'ngày hai mươi chín tháng mười' },
    { id: 'time', text: 'mười bảy giờ ba mươi ba phút' },
    { id: 'category', text: 'mua thuốc' },
    { id: 'account', text: 'MB Bank' },
  ],
  'en-US': [
    { id: 'amount', text: 'one hundred twenty five thousand' },
    { id: 'date', text: 'October twenty ninth' },
    { id: 'time', text: 'five thirty three PM' },
    { id: 'category', text: 'buy medicine' },
    { id: 'account', text: 'MB Bank' },
  ],
}

export function VoiceSettings({ settings, onSaveSettings }: {
  settings?: AppSettings
  onSaveSettings: (patch: Partial<AppSettings>) => Promise<void>
}) {
  const { t, locale } = useI18n()
  const initial = getVoiceSettings(settings)
  const [language, setLanguage] = useState<VoiceInputLanguage>(initial.language)
  const [fieldOrder, setFieldOrder] = useState<VoiceInputField[]>(initial.fieldOrder)
  const [corrections, setCorrections] = useState(initial.corrections)
  const [heard, setHeard] = useState<Record<string, string>>({})
  const [listeningId, setListeningId] = useState<string>()
  const [message, setMessage] = useState('')
  const controllerRef = useRef<AbortController | undefined>(undefined)
  const supported = speechRecognitionSupported()
  const samples = SAMPLES[language]

  const availableFields = useMemo(() => DEFAULT_VOICE_FIELDS.map((field) => ({ field, enabled: fieldOrder.includes(field) })), [fieldOrder])

  function toggleField(field: VoiceInputField) {
    setFieldOrder((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field])
  }

  function moveField(field: VoiceInputField, direction: -1 | 1) {
    setFieldOrder((current) => {
      const index = current.indexOf(field)
      if (index < 0) return current
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
  }

  async function calibrate(id: string, expected: string) {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setListeningId(id)
    setMessage('')
    setHeard((current) => ({ ...current, [id]: '' }))
    try {
      const result = await recognizeSpeech({
        language,
        phrases: samples.map((item) => item.text),
        signal: controller.signal,
        onInterim: (value) => setHeard((current) => ({ ...current, [id]: value })),
      })
      setHeard((current) => ({ ...current, [id]: result.transcript }))
      const learned = deriveCalibrationCorrections(result.transcript, expected)
      if (learned.length) setCorrections((current) => mergeVoiceCorrections(current, learned))
    } catch (error) {
      if (error instanceof Error && error.message === 'error.voiceCancelled') return
      setMessage(voiceRecognitionErrorText(error, locale) ?? t(error instanceof Error && error.message.startsWith('error.') ? error.message : 'error.voiceRecognition'))
    } finally {
      setListeningId(undefined)
    }
  }

  async function save() {
    await onSaveSettings({
      voiceInput: {
        language,
        fieldOrder: fieldOrder.length ? fieldOrder : DEFAULT_VOICE_FIELDS,
        corrections,
        calibrationCompletedAt: heard && Object.keys(heard).length ? new Date().toISOString() : settings?.voiceInput?.calibrationCompletedAt,
      },
    })
    setMessage(t('voice.saved'))
  }

  function resetCalibration() {
    controllerRef.current?.abort()
    setCorrections([])
    setHeard({})
    setMessage(t('voice.calibrationReset'))
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-stone-900 dark:text-white">{t('voice.settingsTitle')}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-stone-500">{t('voice.settingsHint')}</p>
        </div>
        <Mic size={20} className="text-stone-400" />
      </div>

      {!supported && <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{t('voice.unsupported')}</div>}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-xs font-medium text-stone-500">{t('voice.language')}</div>
            <Select value={language} onChange={(event) => setLanguage(event.target.value as VoiceInputLanguage)}>
              <option value="vi-VN">Tiếng Việt</option>
              <option value="en-US">English</option>
            </Select>
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold text-stone-800 dark:text-stone-100">{t('voice.fields')}</div>
            <p className="mb-3 text-xs leading-5 text-stone-500">{t('voice.fieldsHint')}</p>
            <div className="space-y-2">
              {availableFields.map(({ field, enabled }) => {
                const index = fieldOrder.indexOf(field)
                return <div key={field} className="flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2 dark:border-stone-800">
                  <button type="button" onClick={() => toggleField(field)} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${enabled ? 'border-stone-950 bg-stone-950 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-950' : 'border-stone-300 text-transparent dark:border-stone-700'}`}><Check size={14} /></button>
                  <span className="min-w-0 flex-1 text-sm font-medium text-stone-800 dark:text-stone-100">{t(`voice.field.${field}`)}</span>
                  {enabled && <>
                    <button type="button" className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 disabled:opacity-30 dark:hover:bg-stone-800" onClick={() => moveField(field, -1)} disabled={index <= 0}><ChevronUp size={15} /></button>
                    <button type="button" className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 disabled:opacity-30 dark:hover:bg-stone-800" onClick={() => moveField(field, 1)} disabled={index < 0 || index >= fieldOrder.length - 1}><ChevronDown size={15} /></button>
                  </>}
                </div>
              })}
            </div>
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-stone-800 dark:text-stone-100">{t('voice.calibration')}</div>
              <p className="mt-1 text-xs leading-5 text-stone-500">{t('voice.calibrationHint')}</p>
            </div>
            <Button variant="ghost" className="px-3" onClick={resetCalibration}><RotateCcw size={15} /> {t('voice.resetCalibration')}</Button>
          </div>
          <div className="mt-3 space-y-2">
            {samples.map((sample, index) => (
              <div key={sample.id} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300">{index + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-stone-900 dark:text-stone-100">“{sample.text}”</div>
                    {heard[sample.id] && <div className="mt-1 text-xs text-stone-500">{t('voice.heard')}: {heard[sample.id]}</div>}
                  </div>
                  <Button variant="secondary" className="shrink-0 px-3" disabled={!supported || Boolean(listeningId)} onClick={() => void calibrate(sample.id, sample.text)}><Mic size={15} /> {listeningId === sample.id ? t('voice.listening') : t('voice.readSample')}</Button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-stone-500">{t('voice.privacyHint')}</p>
          {corrections.length > 0 && <div className="mt-3 rounded-xl bg-stone-50 p-3 text-xs text-stone-500 dark:bg-stone-950"><span className="font-semibold text-stone-700 dark:text-stone-300">{t('voice.learnedCorrections', { count: corrections.length })}</span></div>}
        </div>
      </div>

      {message && <div className="mt-4 text-sm text-stone-600 dark:text-stone-300">{message}</div>}
      <div className="mt-5 flex justify-end"><Button onClick={() => void save()}>{t('voice.saveSettings')}</Button></div>
    </Card>
  )
}
