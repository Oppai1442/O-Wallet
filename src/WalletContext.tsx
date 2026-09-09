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
  GoogleUser,
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
  getSyncState,
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
import { fetchRemoteImageToLocal, syncWalletToDrive } from './lib/sync'
import { reportDiagnostic } from './lib/security'

type VaultStatus = 'loading' | 'new' | 'locked' | 'unlocked'
export type GoogleConnectionState = 'disconnected' | 'connected' | 'reconnecting' | 'attention'

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
  googleRememberedUser?: GoogleUser
  googleConnectionState: GoogleConnectionState
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
  saveEntities: <T extends WalletEntity>(entities: T[]) => Promise<void>
  deleteTransaction: (id: string) => Promise<void>
  connectGoogle: () => Promise<GoogleSession>
  retryGoogleConnection: () => Promise<GoogleSession | undefined>
  disconnectGoogle: () => void
  switchLocalAccount: () => Promise<void>
  restoreVaultConfigFromDrive: () => Promise<boolean>
  syncNow: () => Promise<SyncStats | undefined>
  notifyMutation: () => Promise<void>
  updateDevicePreferences: (patch: Partial<DeviceSessionPreferences>) => Promise<void>
  clearError: () => void
}

const WalletContext = createContext<WalletContextValue | null>(null)

function applyThemeMode(mode: AppSettings['theme'] | undefined) {
  const selected = mode ?? 'system'
  const dark = selected === 'dark' || (selected === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

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
  const { t, setLanguage } = useI18n()
  const [status, setStatus] = useState<VaultStatus>('loading')
  const [vaultConfig, setVaultConfigState] = useState<VaultConfig>()
  const [dek, setDek] = useState<CryptoKey>()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [settings, setSettings] = useState<AppSettings>()
  const [googleSession, setGoogleSession] = useState<GoogleSession>()
  const [googleBinding, setGoogleBinding] = useState<GoogleAccountBinding>()
  const [googleRememberedUser, setGoogleRememberedUser] = useState<GoogleUser>()
  const [googleReconnectUntil, setGoogleReconnectUntil] = useState<number>()
  const [googleReconnectMode, setGoogleReconnectMode] = useState<RememberDuration>()
  const [googleConnectionState, setGoogleConnectionState] = useState<GoogleConnectionState>('disconnected')
  const [googleReconnectNonce, setGoogleReconnectNonce] = useState(0)
  const [devicePreferences, setDevicePreferencesState] = useState<DeviceSessionPreferences>(DEFAULT_DEVICE_PREFERENCES)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [lastSync, setLastSync] = useState<SyncStats>()
  const [error, setError] = useState<string>()
  const autoSyncTimer = useRef<number | undefined>(undefined)
  const bootstrapKey = useRef<string | undefined>(undefined)
  const googleRetryCooldown = useRef(0)

  const repository = useMemo(() => (dek ? new WalletRepository(dek) : undefined), [dek])

  useEffect(() => {
    if (!repository) return
    if (googleSession && googleSession.expiresAt > Date.now()) {
      repository.setRemoteImageLoader((imageId) => fetchRemoteImageToLocal(googleSession.accessToken, imageId))
    } else {
      repository.setRemoteImageLoader(undefined)
    }
    return () => repository.setRemoteImageLoader(undefined)
  }, [repository, googleSession])

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
      reportDiagnostic('remembered-vault-key', rememberError)
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

      // Rehydrate local state first. Google renewal is intentionally background-only:
      // a slow/blocked GIS request must not hold the entire UI on the splash screen.
      const storedGoogle = loadStoredGoogleState()
      setGoogleRememberedUser(storedGoogle.user)
      setGoogleReconnectUntil(storedGoogle.reconnectUntil)
      setGoogleReconnectMode(storedGoogle.mode ?? preferences.googleRemember)

      if (storedGoogle.session) {
        setGoogleSession(storedGoogle.session)
        setGoogleConnectionState('connected')
      } else if (
        googleClientConfigured()
        && storedGoogle.user
        && storedGoogle.reconnectUntil
        && storedGoogle.reconnectUntil > Date.now()
      ) {
        setGoogleConnectionState('reconnecting')
      } else {
        setGoogleConnectionState('disconnected')
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
        // Hydrate encrypted appearance/language before rendering the shell to avoid a
        // light/dark or language flash immediately after the splash screen.
        const localRepo = new WalletRepository(remembered.dek)
        const appSettings = await localRepo.get<AppSettings>('settings')
        if (appSettings) {
          setSettings(appSettings)
          applyThemeMode(appSettings.theme)
          if (appSettings.language) setLanguage(appSettings.language)
        }
        setDek(remembered.dek)
        setStatus('unlocked')
      } else {
        if (remembered) await clearRememberedVaultUnlock().catch(() => undefined)
        setStatus('locked')
      }
    })().catch((initError) => {
      reportDiagnostic('init', initError)
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
    if (appSettings?.language) setLanguage(appSettings.language)
    if (appSettings?.rememberDefaults) {
      await setDeviceSessionPreferences(appSettings.rememberDefaults)
      setDevicePreferencesState(appSettings.rememberDefaults)
    }
  }, [setLanguage])

  const refresh = useCallback(async () => {
    if (!repository) return
    await refreshWithRepository(repository)
  }, [repository, refreshWithRepository])

  const acceptGoogleSession = useCallback((session: GoogleSession, mode: RememberDuration, resumeSync = true) => {
    persistGoogleSession(session, mode)
    setGoogleSession(session)
    setGoogleRememberedUser(session.user)
    const stored = loadStoredGoogleState()
    setGoogleReconnectUntil(stored.reconnectUntil)
    setGoogleReconnectMode(stored.mode ?? mode)
    setGoogleConnectionState('connected')
    googleRetryCooldown.current = 0
    if (resumeSync) bootstrapKey.current = undefined
  }, [])

  // Retry a remembered Google grant without blocking vault startup. The access token
  // itself is short-lived; the long remember window means "keep trying to renew".
  useEffect(() => {
    if (
      googleSession
      || !googleClientConfigured()
      || !googleRememberedUser
      || !googleReconnectUntil
      || googleReconnectUntil <= Date.now()
    ) return

    let cancelled = false
    const delays = [0, 1_200, 4_000]

    void (async () => {
      setGoogleConnectionState('reconnecting')
      for (const delay of delays) {
        if (delay) await new Promise<void>((resolve) => window.setTimeout(() => resolve(), delay))
        if (cancelled) return
        try {
          const renewed = await connectGoogleAuth('none', googleRememberedUser.email)
          if (renewed.user.sub !== googleRememberedUser.sub) throw new Error('error.googleAccountMismatch')
          if (cancelled) return
          acceptGoogleSession(renewed, googleReconnectMode ?? devicePreferences.googleRemember)
          return
        } catch {
          // Retry below. GIS silent renewal can fail temporarily because of cookies,
          // browser privacy policy, connectivity, or Google requiring user interaction.
        }
      }
      if (!cancelled) setGoogleConnectionState('attention')
    })()

    return () => { cancelled = true }
  }, [
    acceptGoogleSession,
    devicePreferences.googleRemember,
    googleReconnectMode,
    googleReconnectNonce,
    googleReconnectUntil,
    googleRememberedUser,
    googleSession,
  ])

  // A focus/online event is a useful time to retry after the initial burst, but keep
  // a cooldown so returning focus repeatedly does not hammer Google.
  useEffect(() => {
    if (googleSession || !googleRememberedUser || !googleReconnectUntil) return
    const retry = () => {
      if (googleReconnectUntil <= Date.now()) return
      const now = Date.now()
      if (now - googleRetryCooldown.current < 15_000) return
      googleRetryCooldown.current = now
      setGoogleReconnectNonce((value) => value + 1)
    }
    window.addEventListener('focus', retry)
    window.addEventListener('online', retry)
    return () => {
      window.removeEventListener('focus', retry)
      window.removeEventListener('online', retry)
    }
  }, [googleReconnectUntil, googleRememberedUser, googleSession])

  // Renew shortly before expiry while the app remains open. Failure is harmless while
  // the current token is still valid; the expiry timer below will move into retry mode.
  useEffect(() => {
    if (!googleSession) return
    const token = googleSession
    let renewTimer: number | undefined

    if (googleReconnectUntil && googleReconnectUntil > Date.now()) {
      const renewIn = Math.max(0, token.expiresAt - Date.now() - 90_000)
      renewTimer = window.setTimeout(() => {
        void connectGoogleAuth('none', token.user.email)
          .then((renewed) => {
            if (renewed.user.sub !== token.user.sub) return
            acceptGoogleSession(renewed, googleReconnectMode ?? devicePreferences.googleRemember, false)
          })
          .catch(() => undefined)
      }, renewIn)
    }

    const expireIn = Math.max(0, token.expiresAt - Date.now() + 250)
    const expiryTimer = window.setTimeout(() => {
      setGoogleSession((current) => {
        if (!current || current.accessToken !== token.accessToken) return current
        return undefined
      })
      if (googleReconnectUntil && googleReconnectUntil > Date.now()) {
        setGoogleConnectionState('reconnecting')
        setGoogleReconnectNonce((value) => value + 1)
      } else {
        setGoogleConnectionState('disconnected')
      }
    }, expireIn)

    return () => {
      if (renewTimer !== undefined) window.clearTimeout(renewTimer)
      window.clearTimeout(expiryTimer)
    }
  }, [
    acceptGoogleSession,
    devicePreferences.googleRemember,
    googleReconnectMode,
    googleReconnectUntil,
    googleSession,
  ])

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
      const cachedSyncState = await getSyncState()
      const remoteVault = await downloadVaultConfig(session.accessToken, cachedSyncState?.driveLayout)
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
      const rawMessage = syncError instanceof Error ? syncError.message : String(syncError)
      if (/Google Drive API 401|UNAUTHENTICATED|invalid[_ ]token|Invalid Credentials/i.test(rawMessage)) {
        setGoogleSession(undefined)
        if (googleReconnectUntil && googleReconnectUntil > Date.now()) {
          setGoogleConnectionState('reconnecting')
          bootstrapKey.current = undefined
          setGoogleReconnectNonce((value) => value + 1)
        } else {
          setGoogleConnectionState('attention')
        }
      }
      const message = localizeError(syncError, t, 'error.syncFailed')
      setError(message)
      throw syncError
    } finally {
      setSyncBusy(false)
      setSyncMessage('')
    }
  }, [assertGoogleAccount, googleReconnectUntil, refreshWithRepository, syncBusy, t])


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
        reportDiagnostic('vault-bootstrap', bootstrapError)
        // Keep the local vault usable even if Drive is temporarily unavailable.
        await repository.ensureDefaults().catch(() => undefined)
        await refreshWithRepository(repository).catch(() => undefined)
      }
    })()
  }, [repository, vaultConfig, status, googleSession, performSync, refreshWithRepository])

  useEffect(() => {
    const mode = settings?.theme ?? 'system'
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => applyThemeMode(mode)
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
      const localRepo = new WalletRepository(key)
      const appSettings = await localRepo.get<AppSettings>('settings')
      if (appSettings) {
        setSettings(appSettings)
        applyThemeMode(appSettings.theme)
        if (appSettings.language) setLanguage(appSettings.language)
      }
      setDek(key)
      bootstrapKey.current = undefined
      setStatus('unlocked')
    } catch (e) {
      const message = localizeError(e, t, 'error.unlockVault')
      setError(message)
      throw e
    }
  }, [vaultConfig, devicePreferences.vaultRemember, rememberVault, setLanguage, t])

  const unlockWithRecovery = useCallback(async (recoveryKey: string, answers: string[]) => {
    if (!vaultConfig) return
    setError(undefined)
    try {
      const key = await unlockVaultWithRecovery(vaultConfig, recoveryKey, answers)
      await rememberVault(key, vaultConfig, devicePreferences.vaultRemember)
      const localRepo = new WalletRepository(key)
      const appSettings = await localRepo.get<AppSettings>('settings')
      if (appSettings) {
        setSettings(appSettings)
        applyThemeMode(appSettings.theme)
        if (appSettings.language) setLanguage(appSettings.language)
      }
      setDek(key)
      bootstrapKey.current = undefined
      setStatus('unlocked')
    } catch (e) {
      const message = localizeError(e, t, 'error.recoveryFailed')
      setError(message)
      throw e
    }
  }, [vaultConfig, devicePreferences.vaultRemember, rememberVault, setLanguage, t])

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
      const prompt = googleRememberedUser ? '' : 'select_account'
      const session = await connectGoogleAuth(prompt, googleRememberedUser?.email)
      await assertGoogleAccount(session)
      acceptGoogleSession(session, devicePreferences.googleRemember, false)
      if (status === 'unlocked' && repository && vaultConfig) {
        bootstrapKey.current = `${vaultConfig.createdAt}:${session.user.sub}`
        await performSync(session, repository, vaultConfig)
      }
      return session
    } catch (e) {
      setGoogleConnectionState(googleRememberedUser ? 'attention' : 'disconnected')
      const message = localizeError(e, t, 'error.googleConnect')
      setError(message)
      throw e
    }
  }, [
    acceptGoogleSession,
    assertGoogleAccount,
    devicePreferences.googleRemember,
    googleRememberedUser,
    performSync,
    repository,
    status,
    t,
    vaultConfig,
  ])

  const retryGoogleConnection = useCallback(async () => {
    setError(undefined)
    const hint = googleRememberedUser ?? googleBinding
    if (!hint) return undefined
    try {
      // This function is called from a user action, so an interactive popup is allowed.
      const session = await connectGoogleAuth('', hint.email)
      if (session.user.sub !== hint.sub) throw new Error('error.googleAccountMismatch')
      await assertGoogleAccount(session)
      acceptGoogleSession(session, devicePreferences.googleRemember, false)
      if (status === 'unlocked' && repository && vaultConfig) {
        bootstrapKey.current = `${vaultConfig.createdAt}:${session.user.sub}`
        await performSync(session, repository, vaultConfig)
      }
      return session
    } catch (e) {
      setGoogleConnectionState('attention')
      const message = localizeError(e, t, 'error.googleConnect')
      setError(message)
      return undefined
    }
  }, [
    acceptGoogleSession,
    assertGoogleAccount,
    devicePreferences.googleRemember,
    googleBinding,
    googleRememberedUser,
    performSync,
    repository,
    status,
    t,
    vaultConfig,
  ])

  const disconnectGoogle = useCallback(() => {
    revokeGoogle(googleSession)
    clearStoredGoogleSession()
    setGoogleSession(undefined)
    setGoogleRememberedUser(undefined)
    setGoogleReconnectUntil(undefined)
    setGoogleReconnectMode(undefined)
    setGoogleConnectionState('disconnected')
    bootstrapKey.current = undefined
  }, [googleSession])

  const switchLocalAccount = useCallback(async () => {
    revokeGoogle(googleSession)
    clearStoredGoogleSession()
    await clearLocalVaultForAccountSwitch()
    await clearGoogleAccountBinding().catch(() => undefined)
    setGoogleSession(undefined)
    setGoogleRememberedUser(undefined)
    setGoogleReconnectUntil(undefined)
    setGoogleReconnectMode(undefined)
    setGoogleConnectionState('disconnected')
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
        const hint = googleRememberedUser ?? googleBinding
        session = await connectGoogleAuth(hint ? '' : 'select_account', hint?.email)
        if (hint && session.user.sub !== hint.sub) throw new Error('error.googleAccountMismatch')
        acceptGoogleSession(session, devicePreferences.googleRemember, false)
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
  }, [acceptGoogleSession, devicePreferences.googleRemember, googleBinding, googleRememberedUser, googleSession, t])

  const syncNow = useCallback(async () => {
    if (!vaultConfig || !repository || syncBusy) return undefined
    let session = googleSession

    if (!session || session.expiresAt <= Date.now()) {
      const hint = googleRememberedUser ?? googleBinding
      if (!hint) return undefined
      try {
        // syncNow is user initiated, so use an interactive renewal rather than silently
        // failing when the short-lived token expired.
        session = await connectGoogleAuth('', hint.email)
        if (session.user.sub !== hint.sub) throw new Error('error.googleAccountMismatch')
        acceptGoogleSession(session, devicePreferences.googleRemember, false)
      } catch {
        setGoogleConnectionState('attention')
        setError(t('error.tokenExpired'))
        return undefined
      }
    }

    return performSync(session, repository, vaultConfig)
  }, [
    acceptGoogleSession,
    devicePreferences.googleRemember,
    googleBinding,
    googleRememberedUser,
    googleSession,
    performSync,
    repository,
    syncBusy,
    t,
    vaultConfig,
  ])

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

  const saveEntities = useCallback(async <T extends WalletEntity>(entities: T[]) => {
    if (!repository) throw new Error(t('error.vaultLocked'))
    await repository.putMany(entities)
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
      if (next.googleRemember === 'off') {
        clearStoredGoogleSession()
        setGoogleReconnectUntil(undefined)
        setGoogleReconnectMode(undefined)
        setGoogleRememberedUser(googleSession?.user)
      } else if (googleSession) {
        persistGoogleSession(googleSession, next.googleRemember as RememberDuration)
        const stored = loadStoredGoogleState()
        setGoogleReconnectUntil(stored.reconnectUntil)
        setGoogleReconnectMode(stored.mode ?? next.googleRemember)
        setGoogleRememberedUser(stored.user ?? googleSession.user)
      }
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
    googleRememberedUser,
    googleConnectionState,
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
    saveEntities,
    deleteTransaction,
    connectGoogle,
    retryGoogleConnection,
    disconnectGoogle,
    switchLocalAccount,
    restoreVaultConfigFromDrive,
    syncNow,
    notifyMutation,
    updateDevicePreferences,
    clearError: () => setError(undefined),
  }), [
    status, vaultConfig, repository, transactions, accounts, categories, settings,
    googleSession, googleBinding, googleRememberedUser, googleConnectionState, devicePreferences, syncBusy, syncMessage, lastSync, error,
    createNewVault, unlockWithPassword, unlockWithRecovery, lock, refresh, saveEntity, saveEntities,
    deleteTransaction, connectGoogle, retryGoogleConnection, disconnectGoogle, switchLocalAccount,
    restoreVaultConfigFromDrive, syncNow, notifyMutation, updateDevicePreferences,
  ])

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet() {
  const value = useContext(WalletContext)
  if (!value) throw new Error('useWallet must be used inside WalletProvider')
  return value
}
