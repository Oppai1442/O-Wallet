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
  DeviceSessionPreferences,
  GoogleAccountBinding,
  GoogleSession,
  RememberDuration,
  SyncStats,
  Transaction,
  VaultConfig,
  VaultRememberDuration,
  WalletEntity,
} from './types'
import { localizeError, useI18n } from './i18n'
import { createVault, unlockVaultWithPassword, unlockVaultWithRecovery } from './lib/crypto'
import {
  clearGoogleAccountBinding,
  clearLocalVaultForAccountSwitch,
  clearLocalWalletData,
  clearRememberedVaultUnlock,
  getDeviceSessionPreferences,
  getGoogleAccountBinding,
  getRememberedVaultUnlock,
  getVaultConfig,
  setDeviceSessionPreferences,
  setGoogleAccountBinding,
  setRememberedVaultUnlock,
  setVaultConfig,
} from './lib/db'
import { WalletRepository } from './lib/repository'
import {
  clearStoredGoogleSession,
  connectGoogle as connectGoogleAuth,
  googleClientConfigured,
  loadStoredGoogleState,
  persistGoogleSession,
  revokeGoogle,
} from './lib/googleAuth'
import { downloadVaultConfig } from './lib/drive'
import { syncWalletToDrive } from './lib/sync'

type VaultStatus = 'loading' | 'new' | 'locked' | 'unlocked'

const DEFAULT_DEVICE_PREFERENCES: DeviceSessionPreferences = {
  googleRemember: 'tab',
  vaultRemember: 'off',
}

interface WalletContextValue {
  status: VaultStatus
  vaultConfig?: VaultConfig
  repository?: WalletRepository
  transactions: Transaction[]
  accounts: Account[]
  categories: Category[]
  settings?: AppSettings
  googleSession?: GoogleSession
  googleBinding?: GoogleAccountBinding
  googleConfigured: boolean
  devicePreferences: DeviceSessionPreferences
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
  switchLocalAccount: () => Promise<void>
  restoreVaultConfigFromDrive: () => Promise<boolean>
  syncNow: () => Promise<SyncStats | undefined>
  notifyMutation: () => Promise<void>
  updateDevicePreferences: (patch: Partial<DeviceSessionPreferences>) => Promise<void>
  clearError: () => void
}

const WalletContext = createContext<WalletContextValue | null>(null)

function vaultRememberMs(duration: VaultRememberDuration) {
  switch (duration) {
    case '15m': return 15 * 60 * 1000
    case '1h': return 60 * 60 * 1000
    case '8h': return 8 * 60 * 60 * 1000
    case '1d': return 24 * 60 * 60 * 1000
    case '7d': return 7 * 24 * 60 * 60 * 1000
    case '30d': return 30 * 24 * 60 * 60 * 1000
    default: return 0
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [status, setStatus] = useState<VaultStatus>('loading')
  const [vaultConfig, setVaultConfigState] = useState<VaultConfig>()
  const [dek, setDek] = useState<CryptoKey>()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [settings, setSettings] = useState<AppSettings>()
  const [googleSession, setGoogleSession] = useState<GoogleSession>()
  const [googleBinding, setGoogleBinding] = useState<GoogleAccountBinding>()
  const [devicePreferences, setDevicePreferencesState] = useState<DeviceSessionPreferences>(DEFAULT_DEVICE_PREFERENCES)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [lastSync, setLastSync] = useState<SyncStats>()
  const [error, setError] = useState<string>()
  const autoSyncTimer = useRef<number | undefined>(undefined)
  const bootstrapKey = useRef<string | undefined>(undefined)

  const repository = useMemo(() => (dek ? new WalletRepository(dek) : undefined), [dek])

  const rememberVault = useCallback(async (
    key: CryptoKey,
    config: VaultConfig,
    preference: VaultRememberDuration,
  ) => {
    if (preference === 'off') {
      await clearRememberedVaultUnlock()
      return
    }
    const ms = vaultRememberMs(preference)
    if (!ms) return
    try {
      await setRememberedVaultUnlock({
        vaultCreatedAt: config.createdAt,
        expiresAt: Date.now() + ms,
        dek: key,
      })
    } catch (rememberError) {
      // Some privacy-focused browsers may refuse structured-cloning CryptoKey into IndexedDB.
      console.warn('Could not persist remembered vault key.', rememberError)
      await clearRememberedVaultUnlock().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [config, preferences, binding] = await Promise.all([
        getVaultConfig(),
        getDeviceSessionPreferences(),
        getGoogleAccountBinding(),
      ])
      if (cancelled) return
      setDevicePreferencesState(preferences)
      setGoogleBinding(binding)

      const storedGoogle = loadStoredGoogleState()
      if (storedGoogle.session) {
        setGoogleSession(storedGoogle.session)
      } else if (
        googleClientConfigured()
        && storedGoogle.user
        && storedGoogle.reconnectUntil
        && storedGoogle.reconnectUntil > Date.now()
      ) {
        try {
          const renewed = await connectGoogleAuth('none', storedGoogle.user.email)
          if (renewed.user.sub === storedGoogle.user.sub && !cancelled) {
            const mode = storedGoogle.mode ?? preferences.googleRemember
            persistGoogleSession(renewed, mode)
            setGoogleSession(renewed)
          }
        } catch {
          // Best-effort only. Pure frontend OAuth has no refresh token; user can reconnect manually.
        }
      }

      if (!config) {
        setStatus('new')
        return
      }

      setVaultConfigState(config)
      const remembered = await getRememberedVaultUnlock()
      if (
        remembered
        && remembered.vaultCreatedAt === config.createdAt
        && remembered.expiresAt > Date.now()
      ) {
        setDek(remembered.dek)
        setStatus('unlocked')
      } else {
        if (remembered) await clearRememberedVaultUnlock().catch(() => undefined)
        setStatus('locked')
      }
    })().catch((initError) => {
      console.error(initError)
      if (!cancelled) setStatus('new')
    })
    return () => { cancelled = true }
  }, [])

  const refreshWithRepository = useCallback(async (repo: WalletRepository) => {
    const [tx, accts, cats, appSettings] = await Promise.all([
      repo.getAll<Transaction>('transaction'),
      repo.getAll<Account>('account'),
      repo.getAll<Category>('category'),
      repo.get<AppSettings>('settings'),
    ])
    tx.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    setTransactions(tx)
    setAccounts(accts.filter((item) => !item.archived))
    setCategories(cats.filter((item) => !item.archived))
    setSettings(appSettings)
  }, [])

  const refresh = useCallback(async () => {
    if (!repository) return
    await refreshWithRepository(repository)
  }, [repository, refreshWithRepository])

  const assertGoogleAccount = useCallback(async (session: GoogleSession) => {
    const binding = googleBinding ?? await getGoogleAccountBinding()
    if (binding && binding.sub !== session.user.sub) throw new Error('error.googleAccountMismatch')
    return binding
  }, [googleBinding])

  const performSync = useCallback(async (
    session: GoogleSession,
    repo: WalletRepository,
    config: VaultConfig,
  ) => {
    if (syncBusy) return undefined
    setSyncBusy(true)
    setError(undefined)
    try {
      if (session.expiresAt <= Date.now()) throw new Error('error.tokenExpired')
      const binding = await assertGoogleAccount(session)
      const remoteVault = await downloadVaultConfig(session.accessToken)
      if (remoteVault && remoteVault.createdAt !== config.createdAt) {
        throw new Error('error.driveVaultMismatch')
      }
      if (!binding) {
        await setGoogleAccountBinding(session.user)
        setGoogleBinding(session.user)
      }

      const stats = await syncWalletToDrive(
        session.accessToken,
        config,
        (step) => setSyncMessage(t(`sync.${step}`)),
      )
      setLastSync(stats)
      // Pull first, then create defaults. This avoids duplicate defaults on a new device.
      await repo.ensureDefaults()
      await refreshWithRepository(repo)
      const appSettings = await repo.get<AppSettings>('settings')
      if (appSettings) await repo.enforceImageRetention(appSettings)
      return stats
    } catch (syncError) {
      const message = localizeError(syncError, t, 'error.syncFailed')
      setError(message)
      throw syncError
    } finally {
      setSyncBusy(false)
      setSyncMessage('')
    }
  }, [assertGoogleAccount, refreshWithRepository, syncBusy, t])


  useEffect(() => {
    if (!repository || !vaultConfig || status !== 'unlocked') return
    const key = `${vaultConfig.createdAt}:${googleSession?.user.sub ?? 'local'}`
    if (bootstrapKey.current === key) return
    bootstrapKey.current = key

    void (async () => {
      try {
        if (googleSession && googleSession.expiresAt > Date.now()) {
          await performSync(googleSession, repository, vaultConfig)
        } else {
          await repository.ensureDefaults()
          await refreshWithRepository(repository)
        }
      } catch (bootstrapError) {
        console.error('Vault bootstrap failed.', bootstrapError)
        // Keep the local vault usable even if Drive is temporarily unavailable.
        await repository.ensureDefaults().catch(() => undefined)
        await refreshWithRepository(repository).catch(() => undefined)
      }
    })()
  }, [repository, vaultConfig, status, googleSession, performSync, refreshWithRepository])

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
      await rememberVault(created.dek, created.config, devicePreferences.vaultRemember)
      setDek(created.dek)
      bootstrapKey.current = undefined
      setStatus('unlocked')
    } catch (e) {
      const message = localizeError(e, t, 'error.createVault')
      setError(message)
      throw e
    }
  }, [devicePreferences.vaultRemember, rememberVault, t])

  const unlockWithPassword = useCallback(async (password: string) => {
    if (!vaultConfig) return
    setError(undefined)
    try {
      const key = await unlockVaultWithPassword(vaultConfig, password)
      await rememberVault(key, vaultConfig, devicePreferences.vaultRemember)
      setDek(key)
      bootstrapKey.current = undefined
      setStatus('unlocked')
    } catch (e) {
      const message = localizeError(e, t, 'error.unlockVault')
      setError(message)
      throw e
    }
  }, [vaultConfig, devicePreferences.vaultRemember, rememberVault, t])

  const unlockWithRecovery = useCallback(async (recoveryKey: string, answers: string[]) => {
    if (!vaultConfig) return
    setError(undefined)
    try {
      const key = await unlockVaultWithRecovery(vaultConfig, recoveryKey, answers)
      await rememberVault(key, vaultConfig, devicePreferences.vaultRemember)
      setDek(key)
      bootstrapKey.current = undefined
      setStatus('unlocked')
    } catch (e) {
      const message = localizeError(e, t, 'error.recoveryFailed')
      setError(message)
      throw e
    }
  }, [vaultConfig, devicePreferences.vaultRemember, rememberVault, t])

  const lock = useCallback(() => {
    void clearRememberedVaultUnlock()
    setDek(undefined)
    setTransactions([])
    setAccounts([])
    setCategories([])
    setSettings(undefined)
    bootstrapKey.current = undefined
    setStatus(vaultConfig ? 'locked' : 'new')
  }, [vaultConfig])

  const connectGoogle = useCallback(async () => {
    setError(undefined)
    try {
      const session = await connectGoogleAuth('select_account')
      await assertGoogleAccount(session)
      setGoogleSession(session)
      persistGoogleSession(session, devicePreferences.googleRemember)
      if (status === 'unlocked' && repository && vaultConfig) {
        bootstrapKey.current = `${vaultConfig.createdAt}:${session.user.sub}`
        await performSync(session, repository, vaultConfig)
      }
      return session
    } catch (e) {
      const message = localizeError(e, t, 'error.googleConnect')
      setError(message)
      throw e
    }
  }, [assertGoogleAccount, devicePreferences.googleRemember, performSync, repository, status, t, vaultConfig])

  const disconnectGoogle = useCallback(() => {
    revokeGoogle(googleSession)
    clearStoredGoogleSession()
    setGoogleSession(undefined)
    bootstrapKey.current = undefined
  }, [googleSession])

  const switchLocalAccount = useCallback(async () => {
    revokeGoogle(googleSession)
    clearStoredGoogleSession()
    await clearLocalVaultForAccountSwitch()
    await clearGoogleAccountBinding().catch(() => undefined)
    setGoogleSession(undefined)
    setGoogleBinding(undefined)
    setVaultConfigState(undefined)
    setDek(undefined)
    setTransactions([])
    setAccounts([])
    setCategories([])
    setSettings(undefined)
    setLastSync(undefined)
    setError(undefined)
    bootstrapKey.current = undefined
    setStatus('new')
  }, [googleSession])

  const restoreVaultConfigFromDrive = useCallback(async () => {
    setError(undefined)
    try {
      let session = googleSession
      if (!session || session.expiresAt <= Date.now()) {
        session = await connectGoogleAuth('select_account')
        persistGoogleSession(session, devicePreferences.googleRemember)
        setGoogleSession(session)
      }
      const remote = await downloadVaultConfig(session.accessToken)
      if (!remote) return false
      await clearLocalWalletData()
      await clearRememberedVaultUnlock()
      await setVaultConfig(remote)
      await setGoogleAccountBinding(session.user)
      setGoogleBinding(session.user)
      setVaultConfigState(remote)
      setDek(undefined)
      bootstrapKey.current = undefined
      setStatus('locked')
      return true
    } catch (e) {
      const message = localizeError(e, t, 'error.restoreVault')
      setError(message)
      throw e
    }
  }, [devicePreferences.googleRemember, googleSession, t])

  const syncNow = useCallback(async () => {
    if (!googleSession || !vaultConfig || !repository || syncBusy) return undefined
    let session = googleSession
    if (session.expiresAt <= Date.now()) {
      try {
        session = await connectGoogleAuth('none', session.user.email)
        if (session.user.sub !== googleSession.user.sub) throw new Error('error.googleAccountMismatch')
        setGoogleSession(session)
        persistGoogleSession(session, devicePreferences.googleRemember)
      } catch {
        setError(t('error.tokenExpired'))
        return undefined
      }
    }
    return performSync(session, repository, vaultConfig)
  }, [devicePreferences.googleRemember, googleSession, performSync, repository, syncBusy, t, vaultConfig])

  const notifyMutation = useCallback(async () => {
    await refresh()
    if (!settings?.autoSync || !googleSession) return
    if (autoSyncTimer.current) window.clearTimeout(autoSyncTimer.current)
    autoSyncTimer.current = window.setTimeout(() => {
      void syncNow()
    }, 1200)
  }, [refresh, settings?.autoSync, googleSession, syncNow])

  const saveEntity = useCallback(async <T extends WalletEntity>(entity: T) => {
    if (!repository) throw new Error(t('error.vaultLocked'))
    await repository.put(entity)
    await notifyMutation()
  }, [repository, notifyMutation, t])

  const deleteTransaction = useCallback(async (id: string) => {
    if (!repository) return
    await repository.tombstoneTransaction(id)
    await notifyMutation()
  }, [repository, notifyMutation])

  const updateDevicePreferences = useCallback(async (patch: Partial<DeviceSessionPreferences>) => {
    const next = { ...devicePreferences, ...patch }
    await setDeviceSessionPreferences(next)
    setDevicePreferencesState(next)

    if (patch.vaultRemember !== undefined) {
      if (next.vaultRemember === 'off') await clearRememberedVaultUnlock()
      else if (dek && vaultConfig) await rememberVault(dek, vaultConfig, next.vaultRemember)
    }

    if (patch.googleRemember !== undefined) {
      if (next.googleRemember === 'off') clearStoredGoogleSession()
      else if (googleSession) persistGoogleSession(googleSession, next.googleRemember as RememberDuration)
    }
  }, [dek, devicePreferences, googleSession, rememberVault, vaultConfig])

  const value = useMemo<WalletContextValue>(() => ({
    status,
    vaultConfig,
    repository,
    transactions,
    accounts,
    categories,
    settings,
    googleSession,
    googleBinding,
    googleConfigured: googleClientConfigured(),
    devicePreferences,
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
    switchLocalAccount,
    restoreVaultConfigFromDrive,
    syncNow,
    notifyMutation,
    updateDevicePreferences,
    clearError: () => setError(undefined),
  }), [
    status, vaultConfig, repository, transactions, accounts, categories, settings,
    googleSession, googleBinding, devicePreferences, syncBusy, syncMessage, lastSync, error,
    createNewVault, unlockWithPassword, unlockWithRecovery, lock, refresh, saveEntity,
    deleteTransaction, connectGoogle, disconnectGoogle, switchLocalAccount,
    restoreVaultConfigFromDrive, syncNow, notifyMutation, updateDevicePreferences,
  ])

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet() {
  const value = useContext(WalletContext)
  if (!value) throw new Error('useWallet must be used inside WalletProvider')
  return value
}
