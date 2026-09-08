import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  Account,
  AppSettings,
  Category,
  GoogleSession,
  SyncStats,
  Transaction,
  VaultConfig,
  WalletEntity,
} from './types'
import { createVault, unlockVaultWithPassword, unlockVaultWithRecovery } from './lib/crypto'
import { getVaultConfig, setVaultConfig } from './lib/db'
import { WalletRepository } from './lib/repository'
import { connectGoogle as connectGoogleAuth, googleClientConfigured, revokeGoogle } from './lib/googleAuth'
import { downloadVaultConfig } from './lib/drive'
import { syncWalletToDrive } from './lib/sync'

type VaultStatus = 'loading' | 'new' | 'locked' | 'unlocked'

interface WalletContextValue {
  status: VaultStatus
  vaultConfig?: VaultConfig
  repository?: WalletRepository
  transactions: Transaction[]
  accounts: Account[]
  categories: Category[]
  settings?: AppSettings
  googleSession?: GoogleSession
  googleConfigured: boolean
  syncBusy: boolean
  syncMessage: string
  lastSync?: SyncStats
  error?: string
  createNewVault: (input: {
    password: string
    recoveryKey: string
    questions: Array<{ questionId: string; answer: string }>
  }) => Promise<void>
  unlockWithPassword: (password: string) => Promise<void>
  unlockWithRecovery: (recoveryKey: string, answers: string[]) => Promise<void>
  lock: () => void
  refresh: () => Promise<void>
  saveEntity: <T extends WalletEntity>(entity: T) => Promise<void>
  deleteTransaction: (id: string) => Promise<void>
  connectGoogle: () => Promise<GoogleSession>
  disconnectGoogle: () => void
  restoreVaultConfigFromDrive: () => Promise<boolean>
  syncNow: () => Promise<SyncStats | undefined>
  notifyMutation: () => Promise<void>
  clearError: () => void
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<VaultStatus>('loading')
  const [vaultConfig, setVaultConfigState] = useState<VaultConfig>()
  const [dek, setDek] = useState<CryptoKey>()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [settings, setSettings] = useState<AppSettings>()
  const [googleSession, setGoogleSession] = useState<GoogleSession>()
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [lastSync, setLastSync] = useState<SyncStats>()
  const [error, setError] = useState<string>()
  const autoSyncTimer = useRef<number | undefined>(undefined)

  const repository = useMemo(() => (dek ? new WalletRepository(dek) : undefined), [dek])

  useEffect(() => {
    void (async () => {
      const config = await getVaultConfig()
      if (config) {
        setVaultConfigState(config)
        setStatus('locked')
      } else {
        setStatus('new')
      }
    })()
  }, [])

  const refresh = useCallback(async () => {
    if (!repository) return
    const [tx, accts, cats, appSettings] = await Promise.all([
      repository.getAll<Transaction>('transaction'),
      repository.getAll<Account>('account'),
      repository.getAll<Category>('category'),
      repository.get<AppSettings>('settings'),
    ])
    tx.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    setTransactions(tx)
    setAccounts(accts.filter((item) => !item.archived))
    setCategories(cats.filter((item) => !item.archived))
    setSettings(appSettings)
  }, [repository])

  useEffect(() => {
    if (!repository || status !== 'unlocked') return
    void repository.ensureDefaults().then(refresh)
  }, [repository, status, refresh])

  useEffect(() => {
    const mode = settings?.theme ?? 'system'
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = mode === 'dark' || (mode === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    if (mode === 'system') media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings?.theme])

  const createNewVault = useCallback(async (input: {
    password: string
    recoveryKey: string
    questions: Array<{ questionId: string; answer: string }>
  }) => {
    setError(undefined)
    try {
      const created = await createVault(input.password, input.recoveryKey, input.questions)
      await setVaultConfig(created.config)
      setVaultConfigState(created.config)
      setDek(created.dek)
      setStatus('unlocked')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không tạo được vault.'
      setError(message)
      throw e
    }
  }, [])

  const unlockWithPassword = useCallback(async (password: string) => {
    if (!vaultConfig) return
    setError(undefined)
    try {
      const key = await unlockVaultWithPassword(vaultConfig, password)
      setDek(key)
      setStatus('unlocked')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không mở được vault.'
      setError(message)
      throw e
    }
  }, [vaultConfig])

  const unlockWithRecovery = useCallback(async (recoveryKey: string, answers: string[]) => {
    if (!vaultConfig) return
    setError(undefined)
    try {
      const key = await unlockVaultWithRecovery(vaultConfig, recoveryKey, answers)
      setDek(key)
      setStatus('unlocked')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Recovery thất bại.'
      setError(message)
      throw e
    }
  }, [vaultConfig])

  const lock = useCallback(() => {
    setDek(undefined)
    setTransactions([])
    setAccounts([])
    setCategories([])
    setSettings(undefined)
    setStatus(vaultConfig ? 'locked' : 'new')
  }, [vaultConfig])

  const connectGoogle = useCallback(async () => {
    setError(undefined)
    try {
      const session = await connectGoogleAuth('consent')
      setGoogleSession(session)
      return session
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không kết nối được Google.'
      setError(message)
      throw e
    }
  }, [])

  const disconnectGoogle = useCallback(() => {
    revokeGoogle(googleSession)
    setGoogleSession(undefined)
  }, [googleSession])

  const restoreVaultConfigFromDrive = useCallback(async () => {
    setError(undefined)
    try {
      const session = googleSession ?? await connectGoogle()
      const remote = await downloadVaultConfig(session.accessToken)
      if (!remote) return false
      await setVaultConfig(remote)
      setVaultConfigState(remote)
      setStatus('locked')
      return true
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không restore được vault config.'
      setError(message)
      throw e
    }
  }, [connectGoogle, googleSession])

  const syncNow = useCallback(async () => {
    if (!googleSession || !vaultConfig || !repository || syncBusy) return undefined
    if (googleSession.expiresAt <= Date.now()) {
      setError('Google access token đã hết hạn. Kết nối Google lại rồi sync.')
      return undefined
    }
    setSyncBusy(true)
    setError(undefined)
    try {
      const stats = await syncWalletToDrive(googleSession.accessToken, vaultConfig, setSyncMessage)
      setLastSync(stats)
      await refresh()
      if (settings) await repository.enforceImageRetention(settings)
      return stats
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Sync thất bại.'
      setError(message)
      throw e
    } finally {
      setSyncBusy(false)
      setSyncMessage('')
    }
  }, [googleSession, vaultConfig, repository, syncBusy, refresh, settings])

  const notifyMutation = useCallback(async () => {
    await refresh()
    if (!settings?.autoSync || !googleSession) return
    if (autoSyncTimer.current) window.clearTimeout(autoSyncTimer.current)
    autoSyncTimer.current = window.setTimeout(() => {
      void syncNow()
    }, 1200)
  }, [refresh, settings?.autoSync, googleSession, syncNow])

  const saveEntity = useCallback(async <T extends WalletEntity>(entity: T) => {
    if (!repository) throw new Error('Vault đang khóa.')
    await repository.put(entity)
    await notifyMutation()
  }, [repository, notifyMutation])

  const deleteTransaction = useCallback(async (id: string) => {
    if (!repository) return
    await repository.tombstoneTransaction(id)
    await notifyMutation()
  }, [repository, notifyMutation])

  const value = useMemo<WalletContextValue>(() => ({
    status,
    vaultConfig,
    repository,
    transactions,
    accounts,
    categories,
    settings,
    googleSession,
    googleConfigured: googleClientConfigured(),
    syncBusy,
    syncMessage,
    lastSync,
    error,
    createNewVault,
    unlockWithPassword,
    unlockWithRecovery,
    lock,
    refresh,
    saveEntity,
    deleteTransaction,
    connectGoogle,
    disconnectGoogle,
    restoreVaultConfigFromDrive,
    syncNow,
    notifyMutation,
    clearError: () => setError(undefined),
  }), [
    status, vaultConfig, repository, transactions, accounts, categories, settings,
    googleSession, syncBusy, syncMessage, lastSync, error, createNewVault,
    unlockWithPassword, unlockWithRecovery, lock, refresh, saveEntity,
    deleteTransaction, connectGoogle, disconnectGoogle, restoreVaultConfigFromDrive,
    syncNow, notifyMutation,
  ])

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet() {
  const value = useContext(WalletContext)
  if (!value) throw new Error('useWallet must be used inside WalletProvider')
  return value
}
