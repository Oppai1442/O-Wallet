import { useEffect, useState } from 'react'
import { Bot, KeyRound, Save, Trash2 } from 'lucide-react'
import type { AppSettings } from '../types'
import type { WalletRepository } from '../lib/repository'
import { AI_OPENROUTER_KEY_SECRET, OPENROUTER_CHAT_ENDPOINT } from '../lib/ai'
import { localizeError, useI18n } from '../i18n'
import { Button, Card, Input, Label, Select } from './ui'

export function AiSettings({
  settings,
  repository,
  onSaveSettings,
}: {
  settings?: AppSettings
  repository?: WalletRepository
  onSaveSettings: (patch: Partial<AppSettings>) => Promise<void>
}) {
  const { t } = useI18n()
  const [endpoint, setEndpoint] = useState(settings?.aiVision?.endpoint ?? '')
  const [model, setModel] = useState(settings?.aiVision?.model ?? '')
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()

  useEffect(() => {
    setEndpoint(settings?.aiVision?.endpoint ?? '')
    setModel(settings?.aiVision?.model ?? '')
  }, [settings?.aiVision?.endpoint, settings?.aiVision?.model])

  useEffect(() => {
    let cancelled = false
    void repository?.getLocalSecret(AI_OPENROUTER_KEY_SECRET).then((value) => {
      if (!cancelled) setHasKey(Boolean(value))
    })
    return () => { cancelled = true }
  }, [repository])

  async function save() {
    if (!settings || !repository) return
    setBusy(true)
    setMessage(undefined)
    try {
      const cleanEndpoint = endpoint.trim()
      const cleanModel = model.trim()
      if (apiKey.trim()) {
        await repository.setLocalSecret(AI_OPENROUTER_KEY_SECRET, apiKey.trim())
        setHasKey(true)
        setApiKey('')
      }
      await onSaveSettings({
        aiVision: {
          provider: 'openrouter',
          endpoint: cleanEndpoint || undefined,
          model: cleanModel || undefined,
        },
      })
      setMessage(t('ai.saved'))
    } catch (error) {
      setMessage(localizeError(error, t, 'ai.saveError'))
    } finally {
      setBusy(false)
    }
  }

  async function removeKey() {
    if (!repository) return
    await repository.deleteLocalSecret(AI_OPENROUTER_KEY_SECRET)
    setApiKey('')
    setHasKey(false)
    setMessage(t('ai.keyRemoved'))
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-stone-100 p-2 text-stone-700 dark:bg-stone-800 dark:text-stone-200"><Bot size={19} /></div>
        <div className="min-w-0">
          <h2 className="font-bold text-stone-900 dark:text-white">{t('ai.title')}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-stone-500">{t('ai.settingsHint')}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <Label>{t('ai.provider')}</Label>
          <Select value="openrouter" disabled><option value="openrouter">OpenRouter</option></Select>
        </div>
        <div>
          <Label>{t('ai.endpoint')}</Label>
          <Input
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            placeholder={OPENROUTER_CHAT_ENDPOINT}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div>
          <Label>{t('ai.model')}</Label>
          <Input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="google/gemini-2.5-flash"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="mt-1.5 text-xs leading-5 text-stone-500">{t('ai.modelHint')}</p>
        </div>
        <div>
          <Label>{t('ai.apiKey')}</Label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={16} />
              <Input
                className="pl-9"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={hasKey ? t('ai.keySavedPlaceholder') : 'sk-or-v1-…'}
                autoComplete="new-password"
                spellCheck={false}
              />
            </div>
            {hasKey && <Button variant="ghost" className="px-3 text-rose-500" onClick={() => void removeKey()} title={t('ai.removeKey')}><Trash2 size={17} /></Button>}
          </div>
          <p className="mt-1.5 text-xs leading-5 text-stone-500">{t('ai.keyLocalHint')}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
        {t('ai.privacyWarning')}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={busy || !settings || !repository}><Save size={17} /> {busy ? t('ai.saving') : t('ai.save')}</Button>
        {message && <span className="text-sm text-stone-500">{message}</span>}
      </div>
    </Card>
  )
}
