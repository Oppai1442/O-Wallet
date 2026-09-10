import { useEffect, useState } from 'react'
import { Fingerprint, LoaderCircle, ShieldCheck, X } from 'lucide-react'
import {
  clearQuickUnlockConfig,
  enableQuickUnlock,
  hasQuickUnlockForVault,
  isQuickUnlockCancellation,
  quickUnlockPlatformAvailable,
} from '../lib/quickUnlock'
import { reportDiagnostic } from '../lib/security'
import { useWallet } from '../WalletContext'
import { useI18n } from '../i18n'
import { Button, Card, Input, Label } from './ui'

const COPY = {
  vi: {
    title: 'Quick Unlock',
    text: 'Dùng vân tay, Face ID hoặc Windows Hello để mở O-Wallet nhanh trên thiết bị này. Password vẫn là phương án dự phòng.',
    deviceOnly: 'Thiết lập này chỉ lưu trên thiết bị hiện tại và không sync lên Google Drive.',
    enabled: 'Đã bật',
    disabled: 'Đang tắt',
    unavailable: 'Thiết bị hoặc trình duyệt này chưa hỗ trợ biometric / platform authenticator.',
    enable: 'Bật Quick Unlock',
    disable: 'Tắt Quick Unlock',
    enableTitle: 'Bật Quick Unlock?',
    enableConfirm: 'Nhập password hiện tại để xác nhận. Sau đó hệ điều hành sẽ yêu cầu thiết lập hoặc xác thực vân tay, Face ID hay Windows Hello.',
    password: 'Password hiện tại',
    wrongPassword: 'Password không đúng.',
    setup: 'Xác nhận & thiết lập',
    disableTitle: 'Tắt Quick Unlock?',
    disableConfirm: 'O-Wallet sẽ xóa cấu hình Quick Unlock local trên thiết bị này. Password và dữ liệu ví không bị thay đổi.',
    disableAction: 'Xác nhận tắt',
    cancel: 'Hủy',
    enabling: 'Đang thiết lập…',
    disabling: 'Đang tắt…',
    enabledDone: 'Quick Unlock đã được bật trên thiết bị này.',
    disabledDone: 'Quick Unlock đã được tắt trên thiết bị này.',
    setupFailed: 'Không thể thiết lập Quick Unlock. Hãy thử lại hoặc tiếp tục dùng password.',
  },
  en: {
    title: 'Quick Unlock',
    text: 'Use fingerprint, Face ID, or Windows Hello to open O-Wallet quickly on this device. Your password remains the fallback.',
    deviceOnly: 'This setup is stored only on the current device and is never synced to Google Drive.',
    enabled: 'Enabled',
    disabled: 'Off',
    unavailable: 'This device or browser does not expose a biometric / platform authenticator.',
    enable: 'Enable Quick Unlock',
    disable: 'Disable Quick Unlock',
    enableTitle: 'Enable Quick Unlock?',
    enableConfirm: 'Enter your current password to confirm. Your operating system will then ask you to set up or verify fingerprint, Face ID, or Windows Hello.',
    password: 'Current password',
    wrongPassword: 'Incorrect password.',
    setup: 'Confirm & set up',
    disableTitle: 'Disable Quick Unlock?',
    disableConfirm: 'O-Wallet will remove the local Quick Unlock configuration from this device. Your password and wallet data are unchanged.',
    disableAction: 'Confirm disable',
    cancel: 'Cancel',
    enabling: 'Setting up…',
    disabling: 'Disabling…',
    enabledDone: 'Quick Unlock is enabled on this device.',
    disabledDone: 'Quick Unlock is disabled on this device.',
    setupFailed: 'Quick Unlock could not be configured. Try again or keep using your password.',
  },
} as const

export function QuickUnlockSettings() {
  const { vaultConfig } = useWallet()
  const { language } = useI18n()
  const L = COPY[language]
  const [supported, setSupported] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [dialog, setDialog] = useState<'enable' | 'disable'>()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function refresh() {
    const [platform, configured] = await Promise.all([
      quickUnlockPlatformAvailable(),
      hasQuickUnlockForVault(vaultConfig),
    ])
    setSupported(platform)
    setEnabled(configured)
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      quickUnlockPlatformAvailable(),
      hasQuickUnlockForVault(vaultConfig),
    ]).then(([platform, configured]) => {
      if (cancelled) return
      setSupported(platform)
      setEnabled(configured)
    }).catch((checkError) => reportDiagnostic('quick-unlock-settings-check', checkError))
    return () => { cancelled = true }
  }, [vaultConfig])

  function openEnable() {
    setPassword('')
    setMessage('')
    setError('')
    setDialog('enable')
  }

  function openDisable() {
    setMessage('')
    setError('')
    setDialog('disable')
  }

  async function confirmEnable() {
    if (!vaultConfig || !password || busy) return
    setBusy(true)
    setMessage('')
    setError('')
    try {
      await enableQuickUnlock(vaultConfig, password)
      await refresh()
      setDialog(undefined)
      setPassword('')
      setMessage(L.enabledDone)
    } catch (setupError) {
      if (!isQuickUnlockCancellation(setupError)) {
        reportDiagnostic('quick-unlock-settings-enable', setupError)
        setError(setupError instanceof Error && setupError.message === 'error.wrongPassword' ? L.wrongPassword : L.setupFailed)
      }
    } finally {
      setBusy(false)
    }
  }

  async function confirmDisable() {
    if (busy) return
    setBusy(true)
    setMessage('')
    setError('')
    try {
      await clearQuickUnlockConfig()
      await refresh()
      setDialog(undefined)
      setMessage(L.disabledDone)
    } catch (disableError) {
      reportDiagnostic('quick-unlock-settings-disable', disableError)
      setError(L.setupFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${enabled ? 'bg-blue-600 text-white' : 'bg-stone-100 text-stone-500 dark:bg-stone-900 dark:text-stone-400'}`}><Fingerprint size={21} /></div>
            <div className="min-w-0">
              <h2 className="font-bold text-stone-900 dark:text-white">{L.title}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-500">{L.text}</p>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-stone-400"><ShieldCheck size={14} />{L.deviceOnly}</div>
            </div>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${enabled ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-stone-100 text-stone-500 dark:bg-stone-900 dark:text-stone-400'}`}>{enabled ? L.enabled : L.disabled}</span>
        </div>

        {!supported && !enabled && <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{L.unavailable}</div>}
        {message && <div className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{message}</div>}
        {error && <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}

        <div className="mt-4">
          {enabled ? <Button variant="secondary" onClick={openDisable}><Fingerprint size={16} />{L.disable}</Button> : <Button onClick={openEnable} disabled={!supported || !vaultConfig}><Fingerprint size={16} />{L.enable}</Button>}
        </div>
      </Card>

      {dialog && <div className="fixed inset-0 z-[150] flex items-end justify-center bg-stone-950/55 p-0 sm:items-center sm:p-4" onClick={() => !busy && setDialog(undefined)}>
        <div className="w-full max-w-md" onClick={(event) => event.stopPropagation()}>
          <Card className="rounded-b-none p-5 shadow-2xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-lg font-semibold text-stone-950 dark:text-white">{dialog === 'enable' ? L.enableTitle : L.disableTitle}</h3><p className="mt-1 text-sm leading-6 text-stone-500">{dialog === 'enable' ? L.enableConfirm : L.disableConfirm}</p></div>
              <button type="button" className="rounded-lg p-2 text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-900" onClick={() => !busy && setDialog(undefined)}><X size={18} /></button>
            </div>

            {dialog === 'enable' && <div className="mt-4"><Label>{L.password}</Label><Input autoFocus type="password" maxLength={256} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void confirmEnable() }} /></div>}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialog(undefined)} disabled={busy}>{L.cancel}</Button>
              {dialog === 'enable' ? <Button onClick={() => void confirmEnable()} disabled={!password || busy}>{busy && <LoaderCircle size={16} className="animate-spin" />}{busy ? L.enabling : L.setup}</Button> : <Button variant="danger" onClick={() => void confirmDisable()} disabled={busy}>{busy && <LoaderCircle size={16} className="animate-spin" />}{busy ? L.disabling : L.disableAction}</Button>}
            </div>
          </Card>
        </div>
      </div>}
    </>
  )
}
