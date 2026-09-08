import type { GoogleSession, GoogleUser } from '../types'

const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const SCOPES = `openid email profile ${DRIVE_SCOPE}`

type TokenResponse = {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

type TokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void
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
          }) => TokenClient
          revoke: (token: string, callback?: () => void) => void
        }
      }
    }
  }
}

let scriptPromise: Promise<void> | undefined

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

export async function connectGoogle(prompt = 'consent'): Promise<GoogleSession> {
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
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || 'error.googleAuthorization'))
          return
        }
        resolve({ accessToken: response.access_token, expiresIn: response.expires_in ?? 3600 })
      },
      error_callback: () => reject(new Error('error.googleAuthorization')),
    })
    client.requestAccessToken({ prompt })
  })

  const user = await fetchGoogleUser(token.accessToken)
  return {
    accessToken: token.accessToken,
    expiresAt: Date.now() + token.expiresIn * 1000 - 30_000,
    user,
  }
}

export function revokeGoogle(session: GoogleSession | undefined) {
  if (!session?.accessToken || !window.google?.accounts?.oauth2) return
  window.google.accounts.oauth2.revoke(session.accessToken)
}
