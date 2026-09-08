import { useMemo, useState } from 'react'
import { CloudDownload, Copy, Download, KeyRound, ShieldCheck, Wallet } from 'lucide-react'
import { SECURITY_QUESTIONS } from '../constants'
import { generateRecoveryKey } from '../lib/crypto'
import { useWallet } from '../WalletContext'
import { Button, Card, Input, Label, Select } from './ui'

export function Onboarding() {
  const { createNewVault, restoreVaultConfigFromDrive, googleConfigured, error } = useWallet()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [recoveryKey] = useState(() => generateRecoveryKey())
  const [q1, setQ1] = useState<string>(SECURITY_QUESTIONS[0].id)
  const [q2, setQ2] = useState<string>(SECURITY_QUESTIONS[1].id)
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
    const text = `O-Wallet Recovery Key\n=====================\n\n${recoveryKey}\n\nKeep this key private. Anyone with this key plus the configured security answers can unlock the vault.\n`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'O-Wallet-recovery-key.txt'
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
    <main className="mx-auto flex min-h-screen max-w-6xl items-center px-4 py-10 sm:px-6">
      <div className="grid w-full gap-8 lg:grid-cols-[1fr_1.05fr]">
        <section className="flex flex-col justify-center">
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20"><Wallet size={28} /></div>
          <h1 className="text-4xl font-black tracking-tight text-slate-950 dark:text-white sm:text-5xl">O-Wallet</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-600 dark:text-slate-300">
            Local-first expense tracker. Transaction, ảnh và cache đều được mã hóa trên thiết bị; Google Drive chỉ giữ ciphertext thuộc quota của chính user.
          </p>
          <div className="mt-7 grid gap-3 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2 lg:grid-cols-1">
            <div className="flex items-center gap-3"><ShieldCheck className="text-emerald-500" size={20} /> Không backend dữ liệu trung tâm.</div>
            <div className="flex items-center gap-3"><KeyRound className="text-indigo-500" size={20} /> Password không được upload.</div>
            <div className="flex items-center gap-3"><CloudDownload className="text-sky-500" size={20} /> Cross-device qua Drive của user.</div>
          </div>
          <Button variant="secondary" className="mt-8 w-fit" onClick={restore} disabled={!googleConfigured || busy}>
            <CloudDownload size={17} /> Restore vault từ Google Drive
          </Button>
          {!googleConfigured && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Cần cấu hình VITE_GOOGLE_CLIENT_ID trước khi restore/sync Drive.</p>}
        </section>

        <Card className="p-5 sm:p-7">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Tạo encrypted vault</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Recovery key là recovery cryptographic thật. Security questions chỉ là lớp xác minh phụ.</p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Ít nhất 8 ký tự" /></div>
            <div><Label>Nhập lại password</Label><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          </div>

          <div className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-indigo-500">Recovery key</div>
                <div className="mt-1 break-all font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{recoveryKey}</div>
              </div>
              <div className="flex shrink-0 flex-col gap-1 sm:flex-row"><Button variant="ghost" onClick={async () => { await navigator.clipboard.writeText(recoveryKey); setCopied(true); setSavedRecovery(true) }}><Copy size={17} /> {copied ? 'Đã copy' : 'Copy'}</Button><Button variant="ghost" onClick={downloadRecovery}><Download size={17} /> File</Button></div>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-400">Nếu mất cả password lẫn recovery key thì data không thể được giải mã lại.</p>
            <label className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300"><input type="checkbox" checked={savedRecovery} onChange={(e) => setSavedRecovery(e.target.checked)} className="h-4 w-4 rounded" /> Tôi đã lưu recovery key ở nơi an toàn.</label>
          </div>

          <div className="mt-5 grid gap-4">
            <div>
              <Label>Câu hỏi bảo mật 1</Label>
              <Select value={q1} onChange={(e) => setQ1(e.target.value)}>{SECURITY_QUESTIONS.map((q) => <option value={q.id} key={q.id}>{q.label}</option>)}</Select>
              <Input className="mt-2" value={a1} onChange={(e) => setA1(e.target.value)} placeholder="Câu trả lời" />
            </div>
            <div>
              <Label>Câu hỏi bảo mật 2</Label>
              <Select value={q2} onChange={(e) => setQ2(e.target.value)}>{SECURITY_QUESTIONS.map((q) => <option value={q.id} key={q.id}>{q.label}</option>)}</Select>
              <Input className="mt-2" value={a2} onChange={(e) => setA2(e.target.value)} placeholder="Câu trả lời" />
            </div>
          </div>

          {password !== confirm && confirm && <p className="mt-3 text-sm text-rose-600">Hai password không khớp.</p>}
          {q1 === q2 && <p className="mt-3 text-sm text-rose-600">Chọn hai câu hỏi khác nhau.</p>}
          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          <Button className="mt-6 w-full" onClick={create} disabled={!valid || busy}>{busy ? 'Đang tạo…' : 'Tạo O-Wallet vault'}</Button>
        </Card>
      </div>
    </main>
  )
}
