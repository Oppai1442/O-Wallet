import type { VaultConfig, VaultRememberDuration } from '../types'
import { base64UrlToBytes, bytesToBase64Url, randomBytes, unlockVaultWithPassword } from './crypto'
import { deleteKv, getDeviceSessionPreferences, getKv, setKv, setRememberedVaultUnlock } from './db'
import { reportDiagnostic } from './security'

const LEGACY_QUICK_UNLOCK_KEY = 'quick-unlock-config-v1'
const QUICK_UNLOCK_KEY_PREFIX = 'quick-unlock-config-v2:'
const BRIDGE_TTL_MS = 20_000
const encoder = new TextEncoder()

type QuickUnlockMode = 'prf' | 'platform-uv'

interface QuickUnlockConfigV1 {
  schemaVersion: 1
  vaultCreatedAt: string
  rpId: string
  credentialId: string
  prfSalt: string
  wrappedDek: { iv: string; ciphertext: string }
  createdAt: string
  lastUsedAt?: string
}

export interface QuickUnlockConfig {
  schemaVersion: 2
  mode: QuickUnlockMode
  vaultCreatedAt: string
  rpId: string
  credentialId: string
  prfSalt?: string
  localWrappingKey?: CryptoKey
  wrappedDek: { iv: string; ciphertext: string }
  createdAt: string
  lastUsedAt?: string
}

type StoredQuickUnlockConfig = QuickUnlockConfigV1 | QuickUnlockConfig

type PrfResult = {
  prf?: {
    enabled?: boolean
    results?: { first?: ArrayBuffer }
  }
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function concat(left: Uint8Array, right: Uint8Array) {
  const result = new Uint8Array(left.length + right.length)
  result.set(left)
  result.set(right, left.length)
  return result
}

function rpId() {
  return window.location.hostname
}

function quickUnlockKey(vaultCreatedAt: string) {
  return `${QUICK_UNLOCK_KEY_PREFIX}${encodeURIComponent(vaultCreatedAt)}`
}

function isWindows() {
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  return (uaData?.platform ?? navigator.userAgent).toLocaleLowerCase('en-US').includes('win')
}

function rememberedUnlockTtl(duration: VaultRememberDuration) {
  switch (duration) {
    case '15m': return 15 * 60 * 1000
    case '1h': return 60 * 60 * 1000
    case '8h': return 8 * 60 * 60 * 1000
    case '1d': return 24 * 60 * 60 * 1000
    case '7d': return 7 * 24 * 60 * 60 * 1000
    case '30d': return 30 * 24 * 60 * 60 * 1000
    default: return BRIDGE_TTL_MS
  }
}

function prfExtensions(salt: Uint8Array) {
  return {
    prf: { eval: { first: toArrayBuffer(salt) } },
  } as unknown as AuthenticationExtensionsClientInputs
}

function readPrfResult(credential: PublicKeyCredential) {
  const outputs = credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & PrfResult
  const first = outputs.prf?.results?.first
  return first ? new Uint8Array(first) : undefined
}

function isOperationError(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name?: unknown }).name === 'OperationError'
}

export function quickUnlockErrorSummary(error: unknown) {
  if (error instanceof DOMException) return `${error.name}: ${error.message || 'WebAuthn operation failed'}`
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error ?? 'Unknown Quick Unlock error')
}

export function isQuickUnlockCancellation(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && ['NotAllowedError', 'AbortError'].includes(String((error as { name?: unknown }).name ?? ''))
}

export async function quickUnlockPlatformAvailable() {
  if (!window.isSecureContext || !('PublicKeyCredential' in window) || !navigator.credentials) return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch (error) {
    reportDiagnostic('quick-unlock-platform-check', error)
    return false
  }
}

async function migrateLegacyQuickUnlock(config: VaultConfig) {
  const currentKey = quickUnlockKey(config.createdAt)
  const existing = await getKv<StoredQuickUnlockConfig>(currentKey)
  if (existing) return existing

  const legacy = await getKv<StoredQuickUnlockConfig>(LEGACY_QUICK_UNLOCK_KEY)
  if (!legacy || legacy.vaultCreatedAt !== config.createdAt || legacy.rpId !== rpId()) return undefined
  await setKv(currentKey, legacy)
  await deleteKv(LEGACY_QUICK_UNLOCK_KEY)
  return legacy
}

export async function getQuickUnlockConfig(config?: VaultConfig) {
  if (!config) return undefined
  return (await getKv<StoredQuickUnlockConfig>(quickUnlockKey(config.createdAt))) ?? await migrateLegacyQuickUnlock(config)
}

export async function clearQuickUnlockConfig(config?: VaultConfig) {
  if (!config) return
  await deleteKv(quickUnlockKey(config.createdAt))
  const legacy = await getKv<StoredQuickUnlockConfig>(LEGACY_QUICK_UNLOCK_KEY)
  if (legacy?.vaultCreatedAt === config.createdAt) await deleteKv(LEGACY_QUICK_UNLOCK_KEY)
}

function modeOf(stored: StoredQuickUnlockConfig): QuickUnlockMode {
  return stored.schemaVersion === 1 ? 'prf' : stored.mode
}

export async function hasQuickUnlockForVault(config?: VaultConfig) {
  if (!config) return false
  const stored = await getQuickUnlockConfig(config)
  if (!stored) return false
  if ((stored.schemaVersion !== 1 && stored.schemaVersion !== 2) || stored.vaultCreatedAt !== config.createdAt || stored.rpId !== rpId()) return false
  try {
    const commonValid = base64UrlToBytes(stored.credentialId).length >= 16
      && base64UrlToBytes(stored.wrappedDek.iv).length === 12
      && base64UrlToBytes(stored.wrappedDek.ciphertext).length === 48
    if (!commonValid) return false
    if (modeOf(stored) === 'prf') return Boolean(stored.prfSalt && base64UrlToBytes(stored.prfSalt).length === 32)
    return stored.schemaVersion === 2 && stored.localWrappingKey instanceof CryptoKey
  } catch {
    return false
  }
}

async function derivePasswordKey(config: VaultConfig, password: string) {
  if (!Number.isInteger(config.kdf.iterations) || config.kdf.iterations < 100_000 || config.kdf.iterations > 5_000_000) throw new Error('error.invalidVaultConfig')
  const salt = base64UrlToBytes(config.kdf.salt)
  if (salt.length < 16 || salt.length > 64) throw new Error('error.invalidVaultConfig')
  const material = await crypto.subtle.importKey('raw', toArrayBuffer(encoder.encode(password)), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations: config.kdf.iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
}

async function rawDekFromPassword(config: VaultConfig, password: string) {
  const key = await derivePasswordKey(config, password)
  const iv = base64UrlToBytes(config.passwordWrappedDek.iv)
  const ciphertext = base64UrlToBytes(config.passwordWrappedDek.ciphertext)
  if (iv.length !== 12 || ciphertext.length !== 48) throw new Error('error.invalidVaultConfig')
  try {
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(ciphertext))
    const raw = new Uint8Array(clear)
    if (raw.length !== 32) throw new Error('error.invalidVaultConfig')
    return raw
  } catch (error) {
    if (isOperationError(error)) throw new Error('error.wrongPassword')
    throw error
  }
}

async function quickAesKey(prfOutput: Uint8Array, vaultCreatedAt: string) {
  if (prfOutput.length < 32) throw new Error('error.quickUnlockUnsupported')
  const context = encoder.encode(`O-Wallet WebAuthn PRF quick unlock v1:${vaultCreatedAt}:`)
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(concat(context, prfOutput)))
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

function quickAad(vaultCreatedAt: string) {
  return encoder.encode(`O-Wallet quick unlock DEK v1:${vaultCreatedAt}`)
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i]
  return diff === 0
}

async function getPlatformAssertion(credentialId: Uint8Array, extensions?: AuthenticationExtensionsClientInputs) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: toArrayBuffer(randomBytes(32)),
      rpId: rpId(),
      allowCredentials: [{ id: toArrayBuffer(credentialId), type: 'public-key' as const }],
      userVerification: 'required',
      timeout: 60_000,
      ...(extensions ? { extensions } : {}),
    },
  }) as PublicKeyCredential | null
  if (!assertion) throw new Error('error.quickUnlockFailed')
  const actualId = new Uint8Array(assertion.rawId)
  if (!bytesEqual(actualId, credentialId)) throw new Error('error.quickUnlockFailed')
  return assertion
}

async function evaluatePrf(credentialId: Uint8Array, salt: Uint8Array) {
  const assertion = await getPlatformAssertion(credentialId, prfExtensions(salt))
  const result = readPrfResult(assertion)
  if (!result) throw new Error('error.quickUnlockUnsupported')
  return result
}

async function stableCredentialUserId(vaultCreatedAt: string) {
  const material = encoder.encode(`O-Wallet Quick Unlock user v1:${rpId()}:${vaultCreatedAt}`)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(material)))
}

async function registerCredential({ salt, vaultCreatedAt, windowsMode }: { salt?: Uint8Array; vaultCreatedAt: string; windowsMode: boolean }) {
  const userId = await stableCredentialUserId(vaultCreatedAt)
  const userName = `o-wallet-${bytesToBase64Url(userId).slice(0, 16)}`
  const credential = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'O-Wallet', id: rpId() },
      user: {
        id: toArrayBuffer(userId),
        name: userName,
        displayName: 'O-Wallet Quick Unlock',
      },
      challenge: toArrayBuffer(randomBytes(32)),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        // O-Wallet stores the credential ID locally, so Quick Unlock does not need a
        // discoverable/resident passkey. This avoids filling Windows passkey storage
        // with a new resident credential every time the feature is re-enrolled.
        residentKey: windowsMode ? 'discouraged' : 'preferred',
        userVerification: 'required',
      },
      attestation: 'none',
      timeout: 60_000,
      ...(salt ? { extensions: prfExtensions(salt) } : {}),
    },
  }) as PublicKeyCredential | null
  if (!credential) throw new Error('error.quickUnlockFailed')
  return { credentialId: new Uint8Array(credential.rawId), createPrfOutput: readPrfResult(credential) }
}

async function wrapRawDek(key: CryptoKey, rawDek: Uint8Array, vaultCreatedAt: string) {
  const iv = randomBytes(12)
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv: toArrayBuffer(iv),
    additionalData: toArrayBuffer(quickAad(vaultCreatedAt)),
  }, key, toArrayBuffer(rawDek))
  return { iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)) }
}

export async function enableQuickUnlock(config: VaultConfig, password: string) {
  if (!await quickUnlockPlatformAvailable()) throw new Error('error.quickUnlockUnsupported')

  await unlockVaultWithPassword(config, password)
  const rawDek = await rawDekFromPassword(config, password)

  if (isWindows()) {
    const { credentialId } = await registerCredential({ vaultCreatedAt: config.createdAt, windowsMode: true })
    const localWrappingKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const stored: QuickUnlockConfig = {
      schemaVersion: 2,
      mode: 'platform-uv',
      vaultCreatedAt: config.createdAt,
      rpId: rpId(),
      credentialId: bytesToBase64Url(credentialId),
      localWrappingKey,
      wrappedDek: await wrapRawDek(localWrappingKey, rawDek, config.createdAt),
      createdAt: new Date().toISOString(),
    }
    await setKv(quickUnlockKey(config.createdAt), stored)
    await deleteKv(LEGACY_QUICK_UNLOCK_KEY)
    return stored
  }

  const prfSalt = randomBytes(32)
  const { credentialId, createPrfOutput } = await registerCredential({ salt: prfSalt, vaultCreatedAt: config.createdAt, windowsMode: false })
  try {
    const prfOutput = createPrfOutput ?? await evaluatePrf(credentialId, prfSalt)
    const wrappingKey = await quickAesKey(prfOutput, config.createdAt)
    const stored: QuickUnlockConfig = {
      schemaVersion: 2,
      mode: 'prf',
      vaultCreatedAt: config.createdAt,
      rpId: rpId(),
      credentialId: bytesToBase64Url(credentialId),
      prfSalt: bytesToBase64Url(prfSalt),
      wrappedDek: await wrapRawDek(wrappingKey, rawDek, config.createdAt),
      createdAt: new Date().toISOString(),
    }
    await setKv(quickUnlockKey(config.createdAt), stored)
    await deleteKv(LEGACY_QUICK_UNLOCK_KEY)
    return stored
  } catch (prfError) {
    if (isQuickUnlockCancellation(prfError)) throw prfError
    reportDiagnostic('quick-unlock-prf-probe', prfError)
  }

  const localWrappingKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const stored: QuickUnlockConfig = {
    schemaVersion: 2,
    mode: 'platform-uv',
    vaultCreatedAt: config.createdAt,
    rpId: rpId(),
    credentialId: bytesToBase64Url(credentialId),
    localWrappingKey,
    wrappedDek: await wrapRawDek(localWrappingKey, rawDek, config.createdAt),
    createdAt: new Date().toISOString(),
  }
  await setKv(quickUnlockKey(config.createdAt), stored)
  await deleteKv(LEGACY_QUICK_UNLOCK_KEY)
  return stored
}

async function unwrapDek(stored: StoredQuickUnlockConfig, config: VaultConfig) {
  let wrappingKey: CryptoKey
  if (modeOf(stored) === 'prf') {
    if (!stored.prfSalt) throw new Error('error.quickUnlockUnavailable')
    const prfOutput = await evaluatePrf(base64UrlToBytes(stored.credentialId), base64UrlToBytes(stored.prfSalt))
    wrappingKey = await quickAesKey(prfOutput, config.createdAt)
  } else {
    if (stored.schemaVersion !== 2 || !stored.localWrappingKey) throw new Error('error.quickUnlockUnavailable')
    const credentialId = base64UrlToBytes(stored.credentialId)
    await getPlatformAssertion(credentialId)
    wrappingKey = stored.localWrappingKey
  }

  try {
    const clear = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: toArrayBuffer(base64UrlToBytes(stored.wrappedDek.iv)),
      additionalData: toArrayBuffer(quickAad(config.createdAt)),
    }, wrappingKey, toArrayBuffer(base64UrlToBytes(stored.wrappedDek.ciphertext)))
    const rawDek = new Uint8Array(clear)
    if (rawDek.length !== 32) throw new Error('error.quickUnlockFailed')
    return rawDek
  } catch (error) {
    if (isOperationError(error)) throw new Error('error.quickUnlockFailed')
    throw error
  }
}

export async function unlockWithQuickUnlock(config: VaultConfig) {
  const stored = await getQuickUnlockConfig(config)
  if (!stored || !await hasQuickUnlockForVault(config)) throw new Error('error.quickUnlockUnavailable')
  const rawDek = await unwrapDek(stored, config)
  const dek = await crypto.subtle.importKey('raw', toArrayBuffer(rawDek), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  await setKv(quickUnlockKey(config.createdAt), { ...stored, lastUsedAt: new Date().toISOString() })
  return dek
}

export async function handOffQuickUnlockToWallet(config: VaultConfig, dek: CryptoKey) {
  const preferences = await getDeviceSessionPreferences()
  const ttl = rememberedUnlockTtl(preferences.vaultRemember)
  await setRememberedVaultUnlock({ vaultCreatedAt: config.createdAt, expiresAt: Date.now() + ttl, dek })
  window.location.reload()
}
