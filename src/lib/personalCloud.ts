import type { WalletRepository } from './repository'
import { deleteKv, getKv, setKv } from './db'

const CONFIG_KEY = 'personal-cloud-config-v1'
const SECRET_NAME = 'personal-cloud-pairing-token'
const REQUEST_TIMEOUT_MS = 10_000

export const PERSONAL_CLOUD_DEPLOY_URL = 'https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FOppai1442%2FO-Wallet'
export const CLOUDFLARE_DASHBOARD_URL = 'https://dash.cloudflare.com/'

export interface PersonalCloudCapabilities {
  health: boolean
  authenticatedPairing: boolean
  kvState: boolean
  cronHeartbeat: boolean
  automationInbox: boolean
  pushNotifications: boolean
  scheduledActions: boolean
}

export interface PersonalCloudConfig {
  schemaVersion: 1
  workerUrl: string
  workerVersion: string
  connectedAt: string
  lastCheckedAt: string
  cronLastRun?: string
  capabilities: PersonalCloudCapabilities
}

interface CapabilityResponse {
  ok?: boolean
  service?: string
  version?: string
  cronLastRun?: string | null
  capabilities?: Partial<PersonalCloudCapabilities>
}

function normalizeWorkerUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('error.personalCloudWorkerUrlRequired')
  let url: URL
  try { url = new URL(trimmed) } catch { throw new Error('error.personalCloudWorkerUrlInvalid') }
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(isLocalhost && url.protocol === 'http:')) throw new Error('error.personalCloudWorkerUrlInvalid')
  if (url.username || url.password || url.search || url.hash) throw new Error('error.personalCloudWorkerUrlInvalid')
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.toString().replace(/\/$/, '')
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(input, { ...init, signal: controller.signal, cache: 'no-store' })
  } finally {
    window.clearTimeout(timeout)
  }
}

async function readCapabilities(workerUrl: string, token: string): Promise<CapabilityResponse> {
  const response = await fetchWithTimeout(`${workerUrl}/v1/capabilities`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })
  if (response.status === 401 || response.status === 403) throw new Error('error.personalCloudPairingRejected')
  if (!response.ok) throw new Error('error.personalCloudUnavailable')
  const payload = await response.json() as CapabilityResponse
  if (payload.ok !== true || payload.service !== 'o-wallet-personal-cloud' || typeof payload.version !== 'string') {
    throw new Error('error.personalCloudInvalidWorker')
  }
  return payload
}

function normalizedCapabilities(value?: Partial<PersonalCloudCapabilities>): PersonalCloudCapabilities {
  return {
    health: value?.health === true,
    authenticatedPairing: value?.authenticatedPairing === true,
    kvState: value?.kvState === true,
    cronHeartbeat: value?.cronHeartbeat === true,
    automationInbox: value?.automationInbox === true,
    pushNotifications: value?.pushNotifications === true,
    scheduledActions: value?.scheduledActions === true,
  }
}

export async function getPersonalCloudConfig() {
  const config = await getKv<PersonalCloudConfig>(CONFIG_KEY)
  return config?.schemaVersion === 1 ? config : undefined
}

export async function connectPersonalCloud(repository: WalletRepository, rawWorkerUrl: string, pairingToken: string) {
  const workerUrl = normalizeWorkerUrl(rawWorkerUrl)
  const token = pairingToken.trim()
  if (token.length < 24 || token.length > 4_096) throw new Error('error.personalCloudPairingTokenInvalid')
  const payload = await readCapabilities(workerUrl, token)
  const now = new Date().toISOString()
  const config: PersonalCloudConfig = {
    schemaVersion: 1,
    workerUrl,
    workerVersion: payload.version!,
    connectedAt: now,
    lastCheckedAt: now,
    cronLastRun: payload.cronLastRun ?? undefined,
    capabilities: normalizedCapabilities(payload.capabilities),
  }
  await repository.setLocalSecret(SECRET_NAME, token)
  await setKv(CONFIG_KEY, config)
  return config
}

export async function testPersonalCloud(repository: WalletRepository, config: PersonalCloudConfig) {
  const token = await repository.getLocalSecret(SECRET_NAME)
  if (!token) throw new Error('error.personalCloudPairingMissing')
  const payload = await readCapabilities(config.workerUrl, token)
  const next: PersonalCloudConfig = {
    ...config,
    workerVersion: payload.version!,
    lastCheckedAt: new Date().toISOString(),
    cronLastRun: payload.cronLastRun ?? undefined,
    capabilities: normalizedCapabilities(payload.capabilities),
  }
  await setKv(CONFIG_KEY, next)
  return next
}

export async function disconnectPersonalCloud(repository: WalletRepository) {
  await Promise.all([
    deleteKv(CONFIG_KEY),
    repository.deleteLocalSecret(SECRET_NAME),
  ])
}
