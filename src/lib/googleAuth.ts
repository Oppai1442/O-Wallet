import type { GoogleSession, GoogleUser, RememberDuration } from '../types'

const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const SCOPES = `openid email profile ${DRIVE_SCOPE}`
const TAB_SESSION_KEY = 'o-wallet-google-session-tab-v1'
const DEVICE_SESSION_KEY = 'o-wallet-google-session-device-v1'

export type GooglePrompt = '' | 'none' | 'consent' | 'select_account'

type TokenResponse = {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

type TokenClient = {
  requestAccessToken: (options?: { prompt?: GooglePrompt; login_hint?: string }) => void
}

type StoredGoogleRecord = {
  version: 3
  user: GoogleUser
  accessToken?: string
  expiresAt?: number
  rememberUntil: number
  mode: RememberDuration
}

type LegacyStoredGoogleSessionV1 = {
  session: GoogleSession
  rememberUntil: number
  mode: RememberDuration
}

type LegacyStoredGoogleSessionV2 = {
  version: 2
  user: GoogleUser
  accessToken?: string
  expiresAt?: number
  rememberUntil: number
  mode: RememberDuration
}

export interface StoredGoogleState {
  session?: GoogleSession
  user?: GoogleUser
  reconnectUntil?: number
  mode?: RememberDuration
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (response: TokenResponse) => void
            error_callback?: (error: unknown) => void
            prompt?: GooglePrompt
            login_hint?: string
          }) => TokenClient
          revoke: (token: string, callback?: () => void) => void
        }
      }
    }
  }
}

let scriptPromise: Promise<void> | undefined

function safeStorageGet(storage: Storage, key: string) {
  try { return storage.getItem(key) } catch { return null }
}

function safeStorageSet(storage: Storage, key: string, value: string) {
  try { storage.setItem(key, value) } catch { /* memory-only fallback */ }
}

function safeStorageRemove(storage: Storage, key: string) {
  try { storage.removeItem(key) } catch { /* ignore */ }
}

export function googleClientConfigured() {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  return Boolean(id && !id.startsWith('your-client-id'))
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_SCRIPT}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('error.googleScriptLoad')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = GOOGLE_SCRIPT
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('error.googleScriptLoad'))
    document.head.appendChild(script)
  })

  return scriptPromise
}

async function fetchGoogleUser(accessToken: string): Promise<GoogleUser> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error('error.googleProfile')
  return response.json() as Promise<GoogleUser>
}

export async function connectGoogle(prompt: GooglePrompt = 'select_account', loginHint?: string): Promise<GoogleSession> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  if (!clientId || clientId.startsWith('your-client-id')) throw new Error('error.googleClientMissing')

  await loadGoogleIdentityScript()
  if (!window.google?.accounts?.oauth2) throw new Error('error.googleNotReady')

  const token = await new Promise<{ accessToken: string; expiresIn: number }>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      prompt,
      login_hint: loginHint,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || 'error.googleAuthorization'))
          return
        }
        resolve({ accessToken: response.access_token, expiresIn: response.expires_in ?? 3600 })
      },
      error_callback: () => reject(new Error('error.googleAuthorization')),
    })
    client.requestAccessToken({ prompt, login_hint: loginHint })
  })

  const user = await fetchGoogleUser(token.accessToken)
  return {
    accessToken: token.accessToken,
    expiresAt: Date.now() + token.expiresIn * 1000 - 30_000,
    user,
  }
}

function durationMs(duration: RememberDuration) {
  switch (duration) {
    case '1h': return 60 * 60 * 1000
    case '8h': return 8 * 60 * 60 * 1000
    case '1d': return 24 * 60 * 60 * 1000
    case '7d': return 7 * 24 * 60 * 60 * 1000
    case '30d': return 30 * 24 * 60 * 60 * 1000
    default: return 0
  }
}

function normalizeStored(raw: string | null): StoredGoogleRecord | undefined {
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw) as StoredGoogleRecord | LegacyStoredGoogleSessionV1 | LegacyStoredGoogleSessionV2
    if ('session' in value) {
      if (!value.session?.user?.sub || !value.rememberUntil) return undefined
      return {
        version: 3,
        user: value.session.user,
        accessToken: value.session.accessToken,
        expiresAt: value.session.expiresAt,
        rememberUntil: value.rememberUntil,
        mode: value.mode,
      }
    }
    if (!value.user?.sub || !value.rememberUntil) return undefined
    return {
      version: 3,
      user: value.user,
      accessToken: value.accessToken,
      expiresAt: value.expiresAt,
      rememberUntil: value.rememberUntil,
      mode: value.mode,
    }
  } catch {
    return undefined
  }
}

function writeSessionRecord(record: StoredGoogleRecord) {
  safeStorageSet(sessionStorage, TAB_SESSION_KEY, JSON.stringify(record))
}

function writeDeviceReconnectRecord(record: StoredGoogleRecord) {
  const metadataOnly: StoredGoogleRecord = {
    version: 3,
    user: record.user,
    rememberUntil: record.rememberUntil,
    mode: record.mode,
  }
  safeStorageSet(localStorage, DEVICE_SESSION_KEY, JSON.stringify(metadataOnly))
}

export function persistGoogleSession(session: GoogleSession, mode: RememberDuration) {
  safeStorageRemove(sessionStorage, TAB_SESSION_KEY)
  safeStorageRemove(localStorage, DEVICE_SESSION_KEY)
  if (mode === 'off') return

  const rememberUntil = mode === 'tab' ? session.expiresAt : Date.now() + durationMs(mode)
  const record: StoredGoogleRecord = {
    version: 3,
    user: session.user,
    accessToken: session.accessToken,
    expiresAt: session.expiresAt,
    rememberUntil,
    mode,
  }

  // Active bearer tokens live only in sessionStorage. Longer choices persist only
  // account/reconnect metadata in localStorage, so closing the browser does not leave
  // a bearer token sitting in long-lived storage.
  writeSessionRecord(record)
  if (mode !== 'tab') writeDeviceReconnectRecord(record)
}

export function loadStoredGoogleState(): StoredGoogleState {
  let tab = normalizeStored(safeStorageGet(sessionStorage, TAB_SESSION_KEY))
  let device = normalizeStored(safeStorageGet(localStorage, DEVICE_SESSION_KEY))

  // Migrate old builds that stored the active token inside localStorage. If it is still
  // valid, move it to sessionStorage; localStorage is rewritten as metadata-only.
  if (device?.accessToken || device?.expiresAt) {
    if (device.accessToken && device.expiresAt && device.expiresAt > Date.now()) {
      writeSessionRecord(device)
      tab = device
    }
    writeDeviceReconnectRecord(device)
    device = { ...device, accessToken: undefined, expiresAt: undefined }
  }

  if (tab && tab.rememberUntil <= Date.now()) {
    safeStorageRemove(sessionStorage, TAB_SESSION_KEY)
    tab = undefined
  }
  if (device && device.rememberUntil <= Date.now()) {
    safeStorageRemove(localStorage, DEVICE_SESSION_KEY)
    device = undefined
  }

  if (tab && (!tab.accessToken || !tab.expiresAt || tab.expiresAt <= Date.now())) {
    safeStorageRemove(sessionStorage, TAB_SESSION_KEY)
    tab = undefined
  }

  const metadata = device ?? tab
  if (!metadata) return {}

  const session = tab?.accessToken && tab.expiresAt && tab.expiresAt > Date.now()
    ? { accessToken: tab.accessToken, expiresAt: tab.expiresAt, user: tab.user }
    : undefined

  return {
    session,
    user: metadata.user,
    reconnectUntil: metadata.rememberUntil,
    mode: metadata.mode,
  }
}

export function clearStoredGoogleSession() {
  safeStorageRemove(sessionStorage, TAB_SESSION_KEY)
  safeStorageRemove(localStorage, DEVICE_SESSION_KEY)
}

export function revokeGoogle(session: GoogleSession | undefined) {
  clearStoredGoogleSession()
  if (!session?.accessToken || !window.google?.accounts?.oauth2) return
  window.google.accounts.oauth2.revoke(session.accessToken)
}
