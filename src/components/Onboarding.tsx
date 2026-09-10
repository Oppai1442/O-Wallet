import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Cloud, Copy, Download, KeyRound, LoaderCircle, LogIn, ShieldCheck, Wallet } from 'lucide-react'
import { SECURITY_QUESTIONS } from '../constants'
import { questionLabel, useI18n } from '../i18n'
import { generateRecoveryKey } from '../lib/crypto'
import { useWallet } from '../WalletContext'
import { Button, Card, Input, Label, Select } from './ui'
import { LanguageSwitcher } from './LanguageSwitcher'

type SecurityQuestionId = (typeof SECURITY_QUESTIONS)[number]['id']
type OnboardingStep = 'login' | 'checking' | 'create'
type ActionState = 'idle' | 'signing-in' | 'checking-drive' | 'creating'

const COPY = {
  vi: {
    loginTitle: 'Login / Sign up',
    loginHint: 'Đăng nhập Google một lần. O-Wallet sẽ tự kiểm tra Drive để biết đây là ví đã có hay người dùng mới.',
    loginButton: 'Login / Sign up with Google',
    signingIn: 'Đang đăng nhập…',
    checking: 'Đang kiểm tra Google Drive…',
    checkingHint: 'O-Wallet đang tìm dữ liệu đã có trong Google Drive của tài khoản này.',
    existing: 'Nếu đã có O-Wallet, dữ liệu sẽ được khôi phục và chuyển sang bước mở khóa.',
    newUser: 'Nếu chưa có dữ liệu, bước tạo ví mới sẽ hiện tiếp theo.',
    signedInAs: 'Đã đăng nhập bằng',
    createReady: 'Không tìm thấy O-Wallet hiện có trên Drive. Tạo ví mới cho tài khoản này.',
    creating: 'Đang tạo ví…',
  },
  en: {
    loginTitle: 'Login / Sign up',
    loginHint: 'Sign in with Google once. O-Wallet checks Drive automatically to decide whether to restore an existing wallet or start a new one.',
    loginButton: 'Login / Sign up with Google',
    signingIn: 'Signing in…',
    checking: 'Checking Google Drive…',
    checkingHint: 'O-Wallet is looking for existing wallet data in this Google Drive.',
    existing: 'If an O-Wallet already exists, it will be restored and you will continue to unlock it.',
    newUser: 'If no wallet exists, the new-wallet setup appears next.',
    signedInAs: 'Signed in as',
    createReady: 'No existing O-Wallet was found on Drive. Create a new wallet for this account.',
    creating: 'Creating wallet…',
  },
} as const

export function Onboarding({ autoConnecting = false }: { autoConnecting?: boolean }) {
  const {
    createNewVault,
    restoreVaultConfigFromDrive,
    connectGoogle,
    googleSession,
    googleRememberedUser,
    googleConfigured,
    error,
    clearError,
  } = useWallet()
  const { t, language } = useI18n()
  const L = COPY[language]
  const [step, setStep] = useState<OnboardingStep>(() => googleSession ? 'checking' : 'login')
  const [action, setAction] = useState<ActionState>('idle')
  const checkedSession = useRef<string | undefined>(undefined)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [recoveryKey] = useState(() => generateRecoveryKey())
  const [q1, setQ1] = useState<SecurityQuestionId>(SECURITY_QUESTIONS[0].id)
  const [q2, setQ2] = useState<SecurityQuestionId>(SECURITY_QUESTIONS[1].id)
  const [a1, setA1] = useState('')
  const [a2, setA2] = useState('')
  const [copied, setCopied] = useState(false)
  const [savedRecovery, setSavedRecovery] = useState(false)

  const valid = useMemo(() => password.length >= 8 && password === confirm && a1.trim() && a2.trim() && q1 !== q2 && savedRecovery, [password, confirm, a1, a2, q1, q2, savedRecovery])

  useEffect(() => {
    if (!googleSession || step === 'create' || checkedSession.current === googleSession.accessToken) return
    let cancelled = false
    checkedSession.current = googleSession.accessToken
    setStep('checking')
    setAction('checking-drive')
    clearError()

    void restoreVaultConfigFromDrive()
      .then((restored) => {
        if (cancelled) return
        if (!restored) setStep('create')
      })
      .catch(() => {
        if (cancelled) return
        checkedSession.current = undefined
        setStep('login')
      })
      .finally(() => {
        if (!cancelled) setAction('idle')
      })

    return () => { cancelled = true }
  }, [clearError, googleSession, restoreVaultConfigFromDrive, step])

  async function signIn() {
    if (!googleConfigured || action !== 'idle' || autoConnecting) return
    setAction('signing-in')
    clearError()
    try {
      await connectGoogle()
    } catch {
      setStep('login')
    } finally {
      setAction((current) => current === 'signing-in' ? 'idle' : current)
    }
  }

  async function create() {
    if (!valid || action !== 'idle') return
    setAction('creating')
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
      setAction('idle')
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

  const signingIn = autoConnecting || action === 'signing-in'
  const checking = step === 'checking' || action === 'checking-drive'

  return (
    <main className="relative mx-auto flex min-h-screen max-w-6xl items-center px-4 py-10 sm:px-6">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6"><LanguageSwitcher compact /></div>
      <div className="grid w-full gap-8 lg:grid-cols-[1fr_1.05fr]">
        <section className="flex flex-col justify-center">
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20"><Wallet size={28} /></div>
          <h1 className="text-4xl font-semibold tracking-tight text-stone-950 dark:text-white sm:text-5xl">O-Wallet</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-stone-600 dark:text-stone-300">{t('onboarding.tagline')}</p>
          <div className="mt-7 grid gap-3 text-sm text-stone-600 dark:text-stone-300 sm:grid-cols-2 lg:grid-cols-1">
            <div className="flex items-center gap-3"><ShieldCheck className="text-emerald-500" size={20} /> {t('onboarding.noBackend')}</div>
            <div className="flex items-center gap-3"><KeyRound className="text-blue-500" size={20} /> {t('onboarding.passwordLocal')}</div>
            <div className="flex items-center gap-3"><Cloud className="text-sky-500" size={20} /> {t('onboarding.crossDevice')}</div>
          </div>
        </section>

        {step !== 'create' ? (
          <Card className="flex min-h-[390px] flex-col justify-center p-5 sm:p-7">
            <div className="mx-auto w-full max-w-md text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-200">
                {checking ? <LoaderCircle className="animate-spin" size={23} /> : <LogIn size={23} />}
              </div>
              <h2 className="mt-5 text-xl font-bold text-stone-900 dark:text-white">{checking ? L.checking : L.loginTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{checking ? L.checkingHint : L.loginHint}</p>

              {(googleSession?.user.email || googleRememberedUser?.email) && (
                <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-left dark:border-stone-800 dark:bg-stone-900/70">
                  <div className="text-xs text-stone-500">{L.signedInAs}</div>
                  <div className="mt-0.5 truncate text-sm font-semibold">{googleSession?.user.email ?? googleRememberedUser?.email}</div>
                </div>
              )}

              {!checking && (
                <Button className="mt-6 w-full" onClick={() => void signIn()} disabled={!googleConfigured || signingIn}>
                  {signingIn ? <LoaderCircle className="animate-spin" size={17} /> : <LogIn size={17} />}
                  {signingIn ? L.signingIn : L.loginButton}
                </Button>
              )}

              {checking && (
                <div className="mt-6 grid gap-2 text-left text-xs leading-5 text-stone-500">
                  <div className="flex gap-2"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-500" size={15} /><span>{L.existing}</span></div>
                  <div className="flex gap-2"><CheckCircle2 className="mt-0.5 shrink-0 text-blue-500" size={15} /><span>{L.newUser}</span></div>
                </div>
              )}

              {!googleConfigured && <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">{t('onboarding.googleClientMissing')}</p>}
              {error && !checking && <p className="mt-3 text-sm text-rose-600">{error}</p>}
            </div>
          </Card>
        ) : (
          <Card className="p-5 sm:p-7">
            <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-500/10">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={17} />{googleSession?.user.email}</div>
              <p className="mt-1 text-xs leading-5 text-emerald-700/80 dark:text-emerald-300/80">{L.createReady}</p>
            </div>

            <h2 className="text-xl font-bold text-stone-900 dark:text-white">{t('onboarding.createTitle')}</h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{t('onboarding.createHint')}</p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div><Label>{t('onboarding.password')}</Label><Input type="password" maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('onboarding.passwordPlaceholder')} autoComplete="new-password" /></div>
              <div><Label>{t('onboarding.confirmPassword')}</Label><Input type="password" maxLength={256} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></div>
            </div>

            <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-500/20 dark:bg-blue-500/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-blue-500">{t('onboarding.recoveryKey')}</div>
                  <div className="mt-1 break-all font-mono text-sm font-semibold text-stone-900 dark:text-stone-100">{recoveryKey}</div>
                </div>
                <div className="flex shrink-0 flex-col gap-1 sm:flex-row"><Button variant="ghost" onClick={async () => { await navigator.clipboard.writeText(recoveryKey); setCopied(true); setSavedRecovery(true) }}><Copy size={17} /> {copied ? t('common.copied') : t('common.copy')}</Button><Button variant="ghost" onClick={downloadRecovery}><Download size={17} /> {t('common.file')}</Button></div>
              </div>
              <p className="mt-3 text-xs leading-5 text-stone-600 dark:text-stone-400">{t('onboarding.recoveryWarning')}</p>
              <label className="mt-3 flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-300"><input type="checkbox" checked={savedRecovery} onChange={(e) => setSavedRecovery(e.target.checked)} className="h-4 w-4 rounded" /> {t('onboarding.recoverySaved')}</label>
            </div>

            <div className="mt-5 grid gap-4">
              <div>
                <Label>{t('onboarding.securityQuestion1')}</Label>
                <Select value={q1} onChange={(e) => setQ1(e.target.value as SecurityQuestionId)}>{SECURITY_QUESTIONS.map((q) => <option value={q.id} key={q.id}>{questionLabel(q.id, t)}</option>)}</Select>
                <Input className="mt-2" maxLength={256} value={a1} onChange={(e) => setA1(e.target.value)} placeholder={t('onboarding.answer')} />
              </div>
              <div>
                <Label>{t('onboarding.securityQuestion2')}</Label>
                <Select value={q2} onChange={(e) => setQ2(e.target.value as SecurityQuestionId)}>{SECURITY_QUESTIONS.map((q) => <option value={q.id} key={q.id}>{questionLabel(q.id, t)}</option>)}</Select>
                <Input className="mt-2" maxLength={256} value={a2} onChange={(e) => setA2(e.target.value)} placeholder={t('onboarding.answer')} />
              </div>
            </div>

            {password !== confirm && confirm && <p className="mt-3 text-sm text-rose-600">{t('onboarding.passwordMismatch')}</p>}
            {q1 === q2 && <p className="mt-3 text-sm text-rose-600">{t('onboarding.questionsMustDiffer')}</p>}
            {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
            <Button className="mt-6 w-full" onClick={() => void create()} disabled={!valid || action !== 'idle'}>{action === 'creating' ? <><LoaderCircle className="animate-spin" size={17} />{L.creating}</> : t('onboarding.createButton')}</Button>
          </Card>
        )}
      </div>
    </main>
  )
}
