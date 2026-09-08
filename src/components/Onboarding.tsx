import { useMemo, useState } from 'react'
import { CloudDownload, Copy, Download, KeyRound, ShieldCheck, Wallet } from 'lucide-react'
import { SECURITY_QUESTIONS } from '../constants'
import { questionLabel, useI18n } from '../i18n'
import { generateRecoveryKey } from '../lib/crypto'
import { useWallet } from '../WalletContext'
import { Button, Card, Input, Label, Select } from './ui'
import { LanguageSwitcher } from './LanguageSwitcher'

type SecurityQuestionId = (typeof SECURITY_QUESTIONS)[number]['id']

export function Onboarding() {
  const { createNewVault, restoreVaultConfigFromDrive, googleConfigured, error } = useWallet()
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [recoveryKey] = useState(() => generateRecoveryKey())
  const [q1, setQ1] = useState<SecurityQuestionId>(SECURITY_QUESTIONS[0].id)
  const [q2, setQ2] = useState<SecurityQuestionId>(SECURITY_QUESTIONS[1].id)
  const [a1, setA1] = useState('')
  const [a2, setA2] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [savedRecovery, setSavedRecovery] = useState(false)

  const valid = useMemo(() => password.length >= 8 && password === confirm && a1.trim() && a2.trim() && q1 !== q2 && savedRecovery, [password, confirm, a1, a2, q1, q2, savedRecovery])

  async function create() {
    if (!valid) return
    setBusy(true)
    try {
      await createNewVault({
        password,
        recoveryKey,
        questions: [
          { questionId: q1, answer: a1 },
          { questionId: q2, answer: a2 },
        ],
      })
    } finally {
      setBusy(false)
    }
  }

  function downloadRecovery() {
    const text = `${t('onboarding.recoveryFileHeading')}\n=====================\n\n${recoveryKey}\n\n${t('onboarding.recoveryFileNote')}\n`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'O-Wallet-recovery-code.txt'
    a.click()
    URL.revokeObjectURL(url)
    setSavedRecovery(true)
  }

  async function restore() {
    setBusy(true)
    try {
      await restoreVaultConfigFromDrive()
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="relative mx-auto flex min-h-screen max-w-6xl items-center px-4 py-10 sm:px-6">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6"><LanguageSwitcher compact /></div>
      <div className="grid w-full gap-8 lg:grid-cols-[1fr_1.05fr]">
        <section className="flex flex-col justify-center">
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20"><Wallet size={28} /></div>
          <h1 className="text-4xl font-black tracking-tight text-slate-950 dark:text-white sm:text-5xl">O-Wallet</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-600 dark:text-slate-300">{t('onboarding.tagline')}</p>
          <div className="mt-7 grid gap-3 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2 lg:grid-cols-1">
            <div className="flex items-center gap-3"><ShieldCheck className="text-emerald-500" size={20} /> {t('onboarding.noBackend')}</div>
            <div className="flex items-center gap-3"><KeyRound className="text-indigo-500" size={20} /> {t('onboarding.passwordLocal')}</div>
            <div className="flex items-center gap-3"><CloudDownload className="text-sky-500" size={20} /> {t('onboarding.crossDevice')}</div>
          </div>
          <Button variant="secondary" className="mt-8 w-fit" onClick={restore} disabled={!googleConfigured || busy}>
            <CloudDownload size={17} /> {t('onboarding.restore')}
          </Button>
          {!googleConfigured && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{t('onboarding.googleClientMissing')}</p>}
        </section>

        <Card className="p-5 sm:p-7">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">{t('onboarding.createTitle')}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('onboarding.createHint')}</p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div><Label>{t('onboarding.password')}</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('onboarding.passwordPlaceholder')} /></div>
            <div><Label>{t('onboarding.confirmPassword')}</Label><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          </div>

          <div className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-indigo-500">{t('onboarding.recoveryKey')}</div>
                <div className="mt-1 break-all font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{recoveryKey}</div>
              </div>
              <div className="flex shrink-0 flex-col gap-1 sm:flex-row"><Button variant="ghost" onClick={async () => { await navigator.clipboard.writeText(recoveryKey); setCopied(true); setSavedRecovery(true) }}><Copy size={17} /> {copied ? t('common.copied') : t('common.copy')}</Button><Button variant="ghost" onClick={downloadRecovery}><Download size={17} /> {t('common.file')}</Button></div>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-400">{t('onboarding.recoveryWarning')}</p>
            <label className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300"><input type="checkbox" checked={savedRecovery} onChange={(e) => setSavedRecovery(e.target.checked)} className="h-4 w-4 rounded" /> {t('onboarding.recoverySaved')}</label>
          </div>

          <div className="mt-5 grid gap-4">
            <div>
              <Label>{t('onboarding.securityQuestion1')}</Label>
              <Select value={q1} onChange={(e) => setQ1(e.target.value as SecurityQuestionId)}>{SECURITY_QUESTIONS.map((q) => <option value={q.id} key={q.id}>{questionLabel(q.id, t)}</option>)}</Select>
              <Input className="mt-2" value={a1} onChange={(e) => setA1(e.target.value)} placeholder={t('onboarding.answer')} />
            </div>
            <div>
              <Label>{t('onboarding.securityQuestion2')}</Label>
              <Select value={q2} onChange={(e) => setQ2(e.target.value as SecurityQuestionId)}>{SECURITY_QUESTIONS.map((q) => <option value={q.id} key={q.id}>{questionLabel(q.id, t)}</option>)}</Select>
              <Input className="mt-2" value={a2} onChange={(e) => setA2(e.target.value)} placeholder={t('onboarding.answer')} />
            </div>
          </div>

          {password !== confirm && confirm && <p className="mt-3 text-sm text-rose-600">{t('onboarding.passwordMismatch')}</p>}
          {q1 === q2 && <p className="mt-3 text-sm text-rose-600">{t('onboarding.questionsMustDiffer')}</p>}
          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          <Button className="mt-6 w-full" onClick={create} disabled={!valid || busy}>{busy ? t('onboarding.creating') : t('onboarding.createButton')}</Button>
        </Card>
      </div>
    </main>
  )
}
