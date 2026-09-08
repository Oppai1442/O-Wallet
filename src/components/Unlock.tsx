import { useMemo, useState } from 'react'
import { KeyRound, LockKeyhole, Wallet } from 'lucide-react'
import { SECURITY_QUESTIONS } from '../constants'
import { useWallet } from '../WalletContext'
import { Button, Card, Input, Label } from './ui'

export function Unlock() {
  const { vaultConfig, unlockWithPassword, unlockWithRecovery, error } = useWallet()
  const [mode, setMode] = useState<'password' | 'recovery'>('password')
  const [password, setPassword] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [answers, setAnswers] = useState<string[]>(() => vaultConfig?.recovery.questions.map(() => '') ?? [])
  const [busy, setBusy] = useState(false)

  const questionLabels = useMemo(() => new Map<string, string>(SECURITY_QUESTIONS.map((item) => [item.id, item.label])), [])

  async function submitPassword() {
    setBusy(true)
    try { await unlockWithPassword(password) } finally { setBusy(false) }
  }

  async function submitRecovery() {
    setBusy(true)
    try { await unlockWithRecovery(recoveryKey, answers) } finally { setBusy(false) }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md p-6 sm:p-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950"><Wallet size={28} /></div>
        <h1 className="mt-5 text-center text-2xl font-black text-slate-950 dark:text-white">Unlock O-Wallet</h1>
        <p className="mt-1 text-center text-sm text-slate-500 dark:text-slate-400">DEK chỉ tồn tại trong memory của tab sau khi unlock.</p>

        {mode === 'password' ? (
          <div className="mt-6">
            <Label>Password</Label>
            <Input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submitPassword() }} />
            <Button className="mt-4 w-full" onClick={submitPassword} disabled={!password || busy}><LockKeyhole size={17} /> {busy ? 'Đang mở…' : 'Unlock'}</Button>
            <button className="mt-4 w-full text-sm font-semibold text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setMode('recovery')}>Quên password?</button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div><Label>Recovery key</Label><Input value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)} placeholder="XXXXXX-XXXXXX-…" /></div>
            {vaultConfig?.recovery.questions.map((question, index) => (
              <div key={question.questionId}>
                <Label>{questionLabels.get(question.questionId) ?? question.questionId}</Label>
                <Input value={answers[index] ?? ''} onChange={(e) => setAnswers((current) => current.map((value, i) => i === index ? e.target.value : value))} />
              </div>
            ))}
            <Button className="w-full" onClick={submitRecovery} disabled={!recoveryKey || answers.some((answer) => !answer.trim()) || busy}><KeyRound size={17} /> Recovery unlock</Button>
            <button className="w-full text-sm font-semibold text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setMode('password')}>Quay lại password</button>
          </div>
        )}
        {error && <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
      </Card>
    </main>
  )
}
