import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CloudCog, ExternalLink, KeyRound, LoaderCircle, RefreshCw, ServerCog, ShieldCheck, Unplug } from 'lucide-react'
import { useI18n } from '../i18n'
import {
  CLOUDFLARE_DASHBOARD_URL,
  PERSONAL_CLOUD_DEPLOY_URL,
  connectPersonalCloud,
  disconnectPersonalCloud,
  getPersonalCloudConfig,
  testPersonalCloud,
  type PersonalCloudConfig,
} from '../lib/personalCloud'
import { reportDiagnostic } from '../lib/security'
import { useWallet } from '../WalletContext'
import { Button, Card, Input, Label } from './ui'

const COPY = {
  vi: {
    title: 'Personal Cloud',
    text: 'Kết nối O-Wallet với một Cloudflare Worker nằm trong chính tài khoản Cloudflare của bạn. O-Project không giữ dữ liệu tài chính hay pairing secret của bạn trên server của O-Project.',
    connected: 'Đã kết nối',
    notConfigured: 'Chưa cấu hình',
    workerUrl: 'Worker URL',
    workerUrlPlaceholder: 'https://o-wallet-personal-cloud.<name>.workers.dev',
    pairingToken: 'Pairing token',
    pairingHint: 'Token được lưu local dưới dạng mã hóa bằng vault key. Nó không sync lên Google Drive.',
    deploy: 'Deploy Worker',
    dashboard: 'Cloudflare Dashboard',
    connect: 'Pair & connect',
    connecting: 'Đang kiểm tra…',
    test: 'Test connection',
    testing: 'Đang test…',
    disconnect: 'Disconnect',
    disconnectConfirm: 'Ngắt Personal Cloud trên thiết bị này? Worker trong Cloudflare vẫn còn và sẽ không bị xóa.',
    healthy: 'Worker phản hồi bình thường.',
    failed: 'Không thể xác thực Worker. Kiểm tra URL, pairing token, CORS và cấu hình Worker.',
    setupTitle: 'Thiết lập',
    setup1: '1. Deploy template vào Cloudflare account của bạn.',
    setup2: '2. Tạo KV binding STATE và secret PAIRING_TOKEN trong Worker.',
    setup3: '3. Dán Worker URL + cùng pairing token vào đây rồi Pair.',
    capabilities: 'Capabilities',
    ready: 'Sẵn sàng',
    planned: 'Chưa bật',
    health: 'Health check',
    auth: 'Authenticated pairing',
    kv: 'KV state',
    cron: 'Cron heartbeat',
    inbox: 'Automation Inbox',
    push: 'Push notifications',
    scheduled: 'Scheduled actions',
    lastCheck: 'Lần kiểm tra cuối',
    cronLastRun: 'Cron gần nhất',
    workerVersion: 'Worker version',
    securityTitle: 'Privacy boundary',
    securityText: 'Personal Cloud v1 chỉ dùng Worker URL, pairing token, capability metadata và heartbeat. Transaction, password, recovery code, DEK và ảnh ngân hàng không được gửi tới Worker.',
  },
  en: {
    title: 'Personal Cloud',
    text: 'Connect O-Wallet to a Cloudflare Worker running inside your own Cloudflare account. O-Project does not host your financial data or pairing secret on O-Project servers.',
    connected: 'Connected',
    notConfigured: 'Not configured',
    workerUrl: 'Worker URL',
    workerUrlPlaceholder: 'https://o-wallet-personal-cloud.<name>.workers.dev',
    pairingToken: 'Pairing token',
    pairingHint: 'The token is encrypted locally with your vault key and is never synced to Google Drive.',
    deploy: 'Deploy Worker',
    dashboard: 'Cloudflare Dashboard',
    connect: 'Pair & connect',
    connecting: 'Checking…',
    test: 'Test connection',
    testing: 'Testing…',
    disconnect: 'Disconnect',
    disconnectConfirm: 'Disconnect Personal Cloud on this device? The Worker in Cloudflare will remain deployed.',
    healthy: 'Worker responded normally.',
    failed: 'Worker authentication failed. Check the URL, pairing token, CORS, and Worker configuration.',
    setupTitle: 'Setup',
    setup1: '1. Deploy the template into your Cloudflare account.',
    setup2: '2. Create the STATE KV binding and PAIRING_TOKEN secret in the Worker.',
    setup3: '3. Paste the Worker URL and the same pairing token here, then pair.',
    capabilities: 'Capabilities',
    ready: 'Ready',
    planned: 'Not enabled',
    health: 'Health check',
    auth: 'Authenticated pairing',
    kv: 'KV state',
    cron: 'Cron heartbeat',
    inbox: 'Automation Inbox',
    push: 'Push notifications',
    scheduled: 'Scheduled actions',
    lastCheck: 'Last checked',
    cronLastRun: 'Last cron run',
    workerVersion: 'Worker version',
    securityTitle: 'Privacy boundary',
    securityText: 'Personal Cloud v1 only uses the Worker URL, pairing token, capability metadata, and heartbeat. Transactions, passwords, recovery codes, DEKs, and bank images are not sent to the Worker.',
  },
} as const

function formatTimestamp(value: string | undefined, locale: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function PersonalCloudSettings() {
  const { repository } = useWallet()
  const { language, locale } = useI18n()
  const L = COPY[language]
  const [config, setConfig] = useState<PersonalCloudConfig>()
  const [workerUrl, setWorkerUrl] = useState('')
  const [pairingToken, setPairingToken] = useState('')
  const [busy, setBusy] = useState<'connect' | 'test'>()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void getPersonalCloudConfig().then((value) => {
      if (cancelled) return
      setConfig(value)
      if (value) setWorkerUrl(value.workerUrl)
    }).catch((loadError) => reportDiagnostic('personal-cloud-load', loadError))
    return () => { cancelled = true }
  }, [])

  const capabilityRows = useMemo(() => config ? [
    [L.health, config.capabilities.health],
    [L.auth, config.capabilities.authenticatedPairing],
    [L.kv, config.capabilities.kvState],
    [L.cron, config.capabilities.cronHeartbeat],
    [L.inbox, config.capabilities.automationInbox],
    [L.push, config.capabilities.pushNotifications],
    [L.scheduled, config.capabilities.scheduledActions],
  ] as Array<[string, boolean]> : [], [config, L])

  async function connect() {
    if (!repository || busy) return
    setBusy('connect')
    setMessage('')
    setError('')
    try {
      const next = await connectPersonalCloud(repository, workerUrl, pairingToken)
      setConfig(next)
      setWorkerUrl(next.workerUrl)
      setPairingToken('')
      setMessage(L.healthy)
    } catch (connectError) {
      reportDiagnostic('personal-cloud-connect', connectError)
      setError(L.failed)
    } finally {
      setBusy(undefined)
    }
  }

  async function test() {
    if (!repository || !config || busy) return
    setBusy('test')
    setMessage('')
    setError('')
    try {
      const next = await testPersonalCloud(repository, config)
      setConfig(next)
      setMessage(L.healthy)
    } catch (testError) {
      reportDiagnostic('personal-cloud-test', testError)
      setError(L.failed)
    } finally {
      setBusy(undefined)
    }
  }

  async function disconnect() {
    if (!repository || !config || busy || !window.confirm(L.disconnectConfirm)) return
    try {
      await disconnectPersonalCloud(repository)
      setConfig(undefined)
      setWorkerUrl('')
      setPairingToken('')
      setMessage('')
      setError('')
    } catch (disconnectError) {
      reportDiagnostic('personal-cloud-disconnect', disconnectError)
      setError(L.failed)
    }
  }

  return <div className="space-y-5">
    <div>
      <h2 className="text-lg font-semibold tracking-tight text-stone-950 dark:text-white">{L.title}</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-stone-500">{L.text}</p>
    </div>

    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${config ? 'bg-blue-600 text-white' : 'bg-stone-100 text-stone-500 dark:bg-stone-900 dark:text-stone-400'}`}><CloudCog size={22}/></div>
          <div><div className="font-bold text-stone-900 dark:text-white">O-Wallet Personal Worker</div><div className="mt-1 text-xs text-stone-500">{config ? config.workerUrl : L.notConfigured}</div></div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${config ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-stone-100 text-stone-500 dark:bg-stone-900 dark:text-stone-400'}`}>{config ? L.connected : L.notConfigured}</span>
      </div>

      {!config ? <>
        <div className="mt-5 rounded-xl bg-stone-50 p-4 text-sm leading-6 text-stone-600 dark:bg-stone-950 dark:text-stone-300">
          <div className="font-semibold text-stone-900 dark:text-white">{L.setupTitle}</div>
          <div className="mt-2">{L.setup1}</div><div>{L.setup2}</div><div>{L.setup3}</div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={PERSONAL_CLOUD_DEPLOY_URL} target="_blank" rel="noopener noreferrer"><Button><CloudCog size={17}/>{L.deploy}<ExternalLink size={14}/></Button></a>
          <a href={CLOUDFLARE_DASHBOARD_URL} target="_blank" rel="noopener noreferrer"><Button variant="secondary"><ServerCog size={17}/>{L.dashboard}<ExternalLink size={14}/></Button></a>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div><Label>{L.workerUrl}</Label><Input value={workerUrl} onChange={(event) => setWorkerUrl(event.target.value)} placeholder={L.workerUrlPlaceholder} autoComplete="url" /></div>
          <div><Label>{L.pairingToken}</Label><Input type="password" value={pairingToken} onChange={(event) => setPairingToken(event.target.value)} autoComplete="off" /></div>
        </div>
        <div className="mt-2 flex items-start gap-2 text-xs leading-5 text-stone-500"><KeyRound size={14} className="mt-0.5 shrink-0" />{L.pairingHint}</div>
        <Button className="mt-4" onClick={() => void connect()} disabled={!repository || !workerUrl.trim() || pairingToken.trim().length < 24 || Boolean(busy)}>{busy === 'connect' ? <LoaderCircle size={16} className="animate-spin"/> : <ShieldCheck size={16}/>} {busy === 'connect' ? L.connecting : L.connect}</Button>
      </> : <>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <InfoMetric label={L.workerVersion} value={config.workerVersion}/>
          <InfoMetric label={L.lastCheck} value={formatTimestamp(config.lastCheckedAt, locale)}/>
          <InfoMetric label={L.cronLastRun} value={formatTimestamp(config.cronLastRun, locale)}/>
        </div>
        <div className="mt-5">
          <div className="text-xs font-bold uppercase tracking-wide text-stone-400">{L.capabilities}</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">{capabilityRows.map(([label, ready]) => <div key={label} className="flex items-center justify-between rounded-xl border border-stone-200 px-3 py-2.5 text-sm dark:border-stone-800"><span>{label}</span><span className={`flex items-center gap-1 text-xs font-semibold ${ready ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-400'}`}>{ready && <CheckCircle2 size={14}/>} {ready ? L.ready : L.planned}</span></div>)}</div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => void test()} disabled={Boolean(busy)}>{busy === 'test' ? <LoaderCircle size={16} className="animate-spin"/> : <RefreshCw size={16}/>} {busy === 'test' ? L.testing : L.test}</Button>
          <a href={config.workerUrl} target="_blank" rel="noopener noreferrer"><Button variant="secondary"><ServerCog size={16}/>Worker<ExternalLink size={13}/></Button></a>
          <a href={CLOUDFLARE_DASHBOARD_URL} target="_blank" rel="noopener noreferrer"><Button variant="secondary"><CloudCog size={16}/>{L.dashboard}</Button></a>
          <Button variant="ghost" onClick={() => void disconnect()} disabled={Boolean(busy)}><Unplug size={16}/>{L.disconnect}</Button>
        </div>
      </>}

      {message && <div className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{message}</div>}
      {error && <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}
    </Card>

    <Card className="p-4 sm:p-5">
      <div className="flex items-start gap-3"><ShieldCheck size={19} className="mt-0.5 shrink-0 text-emerald-500"/><div><h3 className="font-bold text-stone-900 dark:text-white">{L.securityTitle}</h3><p className="mt-1 text-sm leading-6 text-stone-500">{L.securityText}</p></div></div>
    </Card>
  </div>
}

function InfoMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950"><div className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">{label}</div><div className="mt-1 break-words text-sm font-semibold text-stone-800 dark:text-stone-100">{value}</div></div>
}
