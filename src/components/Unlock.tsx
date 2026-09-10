import { useEffect, useState } from 'react'
import { Fingerprint, KeyRound, LockKeyhole, ShieldCheck, Wallet } from 'lucide-react'
import { questionLabel, useI18n } from '../i18n'
import {
  enableQuickUnlock,
  handOffQuickUnlockToWallet,
  hasQuickUnlockForVault,
  isQuickUnlockCancellation,
  quickUnlockPlatformAvailable,
  unlockWithQuickUnlock,
} from '../lib/quickUnlock'
import { reportDiagnostic } from '../lib/security'
import { useWallet } from '../WalletContext'
import { Button, Card, Input, Label } from './ui'
import { LanguageSwitcher } from './LanguageSwitcher'

const COPY = {
  vi: {
    quickUnlock: 'Mở nhanh bằng sinh trắc học',
    quickUnlockHint: 'Dùng vân tay, Face ID hoặc Windows Hello của thiết bị này. Password vẫn là phương án dự phòng.',
    quickUnlockBusy: 'Đang xác thực…',
    enableQuick: 'Bật Quick Unlock trên thiết bị này sau khi mở khóa',
    enableHint: 'O-Wallet chỉ bật nếu trình duyệt hỗ trợ WebAuthn PRF. Credential không được đồng bộ lên Drive.',
    unsupported: 'Thiết bị hoặc trình duyệt này chưa hỗ trợ Quick Unlock an toàn bằng WebAuthn PRF.',
    failed: 'Không thể mở bằng sinh trắc học. Hãy dùng password và thử thiết lập lại nếu cần.',
  },
  en: {
    quickUnlock: 'Quick unlock with biometrics',
    quickUnlockHint: 'Use this device’s fingerprint, Face ID, or Windows Hello. Your password remains the fallback.',
    quickUnlockBusy: 'Authenticating…',
    enableQuick: 'Enable Quick Unlock on this device after unlocking',
    enableHint: 'O-Wallet only enables this when WebAuthn PRF is supported. The credential never syncs to Drive.',
    unsupported: 'This device or browser does not support secure WebAuthn PRF Quick Unlock.',
    failed: 'Biometric unlock failed. Use your password and set Quick Unlock up again if needed.',
  },
} as const

export function Unlock() {
  const {
    vaultConfig,
    googleBinding,
    unlockWithPassword,
    unlockWithRecovery,
    switchLocalAccount,
    error,
  } = useWallet()
  const { t, language } = useI18n()
  const L = COPY[language]
  const [mode, setMode] = useState<'password' | 'recovery'>('password')
  const [password, setPassword] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [answers, setAnswers] = useState<string[]>(() => vaultConfig?.recovery.questions.map(() => '') ?? [])
  const [busy, setBusy] = useState(false)
  const [quickBusy, setQuickBusy] = useState(false)
  const [quickAvailable, setQuickAvailable] = useState(false)
  const [platformAvailable, setPlatformAvailable] = useState(false)
  const [enableQuick, setEnableQuick] = useState(false)
  const [quickError, setQuickError] = useState('')

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      quickUnlockPlatformAvailable(),
      hasQuickUnlockForVault(vaultConfig),
    ]).then(([platform, configured]) => {
      if (cancelled) return
      setPlatformAvailable(platform)
      setQuickAvailable(configured)
    }).catch((checkError) => reportDiagnostic('quick-unlock-ui-check', checkError))
    return () => { cancelled = true }
  }, [vaultConfig])

  async function submitPassword() {
    if (!vaultConfig) return
    setBusy(true)
    setQuickError('')
    try {
      if (enableQuick && platformAvailable && !quickAvailable) {
        try {
          await enableQuickUnlock(vaultConfig, password)
        } catch (quickSetupError) {
          if (!isQuickUnlockCancellation(quickSetupError)) {
            reportDiagnostic('quick-unlock-enable', quickSetupError)
            setQuickError(quickSetupError instanceof Error && quickSetupError.message === 'error.quickUnlockUnsupported' ? L.unsupported : L.failed)
          }
        }
      }
      await unlockWithPassword(password)
    } finally {
      setBusy(false)
    }
  }

  async function submitQuickUnlock() {
    if (!vaultConfig || !quickAvailable || quickBusy) return
    setQuickBusy(true)
    setQuickError('')
    try {
      const key = await unlockWithQuickUnlock(vaultConfig)
      await handOffQuickUnlockToWallet(vaultConfig, key)
    } catch (quickUnlockError) {
      if (!isQuickUnlockCancellation(quickUnlockError)) {
        reportDiagnostic('quick-unlock-open', quickUnlockError)
        setQuickError(quickUnlockError instanceof Error && quickUnlockError.message === 'error.quickUnlockUnsupported' ? L.unsupported : L.failed)
      }
    } finally {
      setQuickBusy(false)
    }
  }

  async function submitRecovery() {
    setBusy(true)
    try { await unlockWithRecovery(recoveryKey, answers) } finally { setBusy(false) }
  }

  async function changeAccount() {
    if (!window.confirm(t('unlock.switchAccountConfirm'))) return
    setBusy(true)
    try { await switchLocalAccount() } finally { setBusy(false) }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6"><LanguageSwitcher compact /></div>
      <Card className="w-full max-w-md p-6 sm:p-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-950 text-white dark:bg-white dark:text-stone-950"><Wallet size={28} /></div>
        <h1 className="mt-5 text-center text-2xl font-semibold text-stone-950 dark:text-white">{t('unlock.title')}</h1>
        <p className="mt-1 text-center text-sm text-stone-500 dark:text-stone-400">{t('unlock.memoryHint')}</p>
        {googleBinding && <p className="mt-2 text-center text-xs text-stone-400">{t('unlock.boundAccount', { email: googleBinding.email })}</p>}

        {quickAvailable && mode === 'password' && (
          <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-500/20 dark:bg-blue-500/10">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white"><Fingerprint size={22} /></div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-stone-900 dark:text-white">{L.quickUnlock}</div>
                <p className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">{L.quickUnlockHint}</p>
              </div>
            </div>
            <Button className="mt-4 w-full" onClick={() => void submitQuickUnlock()} disabled={quickBusy || busy}>
              <Fingerprint size={18} /> {quickBusy ? L.quickUnlockBusy : L.quickUnlock}
            </Button>
          </div>
        )}

        {mode === 'password' ? (
          <div className={quickAvailable ? 'mt-5' : 'mt-6'}>
            <Label>{t('onboarding.password')}</Label>
            <Input autoFocus={!quickAvailable} type="password" maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submitPassword() }} />

            {!quickAvailable && platformAvailable && (
              <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-stone-200 p-3 text-sm dark:border-stone-800">
                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded" checked={enableQuick} onChange={(e) => setEnableQuick(e.target.checked)} />
                <span>
                  <span className="flex items-center gap-1.5 font-semibold"><Fingerprint size={15} />{L.enableQuick}</span>
                  <span className="mt-1 block text-xs leading-5 text-stone-500">{L.enableHint}</span>
                </span>
              </label>
            )}

            {!quickAvailable && !platformAvailable && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-500 dark:bg-stone-900/60">
                <ShieldCheck size={15} className="mt-0.5 shrink-0" />{L.unsupported}
              </div>
            )}

            <Button className="mt-4 w-full" onClick={submitPassword} disabled={!password || busy || quickBusy}><LockKeyhole size={17} /> {busy ? t('unlock.unlocking') : t('unlock.button')}</Button>
            <button className="mt-4 w-full text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400" onClick={() => setMode('recovery')}>{t('unlock.forgot')}</button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div><Label>{t('onboarding.recoveryKey')}</Label><Input maxLength={96} value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)} placeholder="XXXXXX-XXXXXX-…" /></div>
            {vaultConfig?.recovery.questions.map((question, index) => (
              <div key={question.questionId}>
                <Label>{questionLabel(question.questionId, t)}</Label>
                <Input maxLength={256} value={answers[index] ?? ''} onChange={(e) => setAnswers((current) => current.map((value, i) => i === index ? e.target.value : value))} />
              </div>
            ))}
            <Button className="w-full" onClick={submitRecovery} disabled={!recoveryKey || answers.some((answer) => !answer.trim()) || busy}><KeyRound size={17} /> {t('unlock.recovery')}</Button>
            <button className="w-full text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400" onClick={() => setMode('password')}>{t('unlock.back')}</button>
          </div>
        )}

        <div className="mt-6 border-t border-stone-200 pt-4 dark:border-stone-800">
          <Button variant="ghost" className="w-full" onClick={() => void changeAccount()} disabled={busy || quickBusy}>{t('unlock.switchAccount')}</Button>
          <p className="mt-2 text-center text-xs leading-5 text-stone-500">{t('unlock.switchAccountHint')}</p>
        </div>

        {quickError && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{quickError}</p>}
        {error && <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
      </Card>
    </main>
  )
}
