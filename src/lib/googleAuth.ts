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

type StoredGoogleSession = {
  session: GoogleSession
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
  if (!clientId || clientId.startsWith('your-client-id')) {
    throw new Error('error.googleClientMissing')
  }

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

function parseStored(raw: string | null): StoredGoogleSession | undefined {
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw) as StoredGoogleSession
    if (!value?.session?.user?.sub || !value.rememberUntil) return undefined
    return value
  } catch {
    return undefined
  }
}

export function persistGoogleSession(session: GoogleSession, mode: RememberDuration) {
  safeStorageRemove(sessionStorage, TAB_SESSION_KEY)
  safeStorageRemove(localStorage, DEVICE_SESSION_KEY)
  if (mode === 'off') return

  const rememberUntil = mode === 'tab'
    ? session.expiresAt
    : Date.now() + durationMs(mode)
  const value: StoredGoogleSession = { session, rememberUntil, mode }
  const serialized = JSON.stringify(value)
  if (mode === 'tab') safeStorageSet(sessionStorage, TAB_SESSION_KEY, serialized)
  else safeStorageSet(localStorage, DEVICE_SESSION_KEY, serialized)
}

export function loadStoredGoogleState(): StoredGoogleState {
  const tab = parseStored(safeStorageGet(sessionStorage, TAB_SESSION_KEY))
  const device = parseStored(safeStorageGet(localStorage, DEVICE_SESSION_KEY))
  const stored = tab ?? device
  if (!stored) return {}

  if (stored.rememberUntil <= Date.now()) {
    if (tab) safeStorageRemove(sessionStorage, TAB_SESSION_KEY)
    if (device) safeStorageRemove(localStorage, DEVICE_SESSION_KEY)
    return {}
  }

  return {
    session: stored.session.expiresAt > Date.now() ? stored.session : undefined,
    user: stored.session.user,
    reconnectUntil: stored.rememberUntil,
    mode: stored.mode,
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
