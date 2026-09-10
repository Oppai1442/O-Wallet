import type { VaultConfig } from '../types'
import { base64UrlToBytes, bytesToBase64Url, randomBytes, unlockVaultWithPassword } from './crypto'
import { deleteKv, getKv, setKv, setRememberedVaultUnlock } from './db'
import { reportDiagnostic } from './security'

const QUICK_UNLOCK_KEY = 'quick-unlock-config-v1'
const BRIDGE_TTL_MS = 20_000
const encoder = new TextEncoder()

export interface QuickUnlockConfig {
  schemaVersion: 1
  vaultCreatedAt: string
  rpId: string
  credentialId: string
  prfSalt: string
  wrappedDek: {
    iv: string
    ciphertext: string
  }
  createdAt: string
  lastUsedAt?: string
}

type PrfResult = {
  prf?: {
    enabled?: boolean
    results?: {
      first?: ArrayBuffer
    }
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

function prfExtensions(salt: Uint8Array) {
  return {
    prf: {
      eval: {
        first: toArrayBuffer(salt),
      },
    },
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

export async function getQuickUnlockConfig() {
  return getKv<QuickUnlockConfig>(QUICK_UNLOCK_KEY)
}

export async function clearQuickUnlockConfig() {
  await deleteKv(QUICK_UNLOCK_KEY)
}

export async function hasQuickUnlockForVault(config?: VaultConfig) {
  if (!config) return false
  const stored = await getQuickUnlockConfig()
  if (!stored) return false
  if (stored.schemaVersion !== 1 || stored.vaultCreatedAt !== config.createdAt || stored.rpId !== rpId()) return false
  try {
    return base64UrlToBytes(stored.credentialId).length >= 16
      && base64UrlToBytes(stored.prfSalt).length === 32
      && base64UrlToBytes(stored.wrappedDek.iv).length === 12
      && base64UrlToBytes(stored.wrappedDek.ciphertext).length === 48
  } catch {
    return false
  }
}

async function derivePasswordKey(config: VaultConfig, password: string) {
  if (!Number.isInteger(config.kdf.iterations) || config.kdf.iterations < 100_000 || config.kdf.iterations > 5_000_000) {
    throw new Error('error.invalidVaultConfig')
  }
  const salt = base64UrlToBytes(config.kdf.salt)
  if (salt.length < 16 || salt.length > 64) throw new Error('error.invalidVaultConfig')
  const material = await crypto.subtle.importKey('raw', toArrayBuffer(encoder.encode(password)), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: toArrayBuffer(salt),
    iterations: config.kdf.iterations,
  }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
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

async function evaluatePrf(credentialId: Uint8Array, salt: Uint8Array) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: toArrayBuffer(randomBytes(32)),
      rpId: rpId(),
      allowCredentials: [{ id: toArrayBuffer(credentialId), type: 'public-key' }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: prfExtensions(salt),
    },
  }) as PublicKeyCredential | null
  if (!assertion) throw new Error('error.quickUnlockFailed')
  const result = readPrfResult(assertion)
  if (!result) throw new Error('error.quickUnlockUnsupported')
  return result
}

async function registerPrfCredential(salt: Uint8Array) {
  const credential = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'O-Wallet', id: rpId() },
      user: {
        id: toArrayBuffer(randomBytes(32)),
        name: 'o-wallet-quick-unlock',
        displayName: 'O-Wallet Quick Unlock',
      },
      challenge: toArrayBuffer(randomBytes(32)),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
      attestation: 'none',
      timeout: 60_000,
      extensions: prfExtensions(salt),
    },
  }) as PublicKeyCredential | null
  if (!credential) throw new Error('error.quickUnlockFailed')

  const credentialId = new Uint8Array(credential.rawId)
  let result = readPrfResult(credential)
  if (!result) result = await evaluatePrf(credentialId, salt)
  return { credentialId, prfOutput: result }
}

export async function enableQuickUnlock(config: VaultConfig, password: string) {
  if (!await quickUnlockPlatformAvailable()) throw new Error('error.quickUnlockUnsupported')

  // Verify the password before creating a platform credential. This avoids leaving
  // useless credentials behind when the user mistypes the master password.
  await unlockVaultWithPassword(config, password)

  const prfSalt = randomBytes(32)
  const { credentialId, prfOutput } = await registerPrfCredential(prfSalt)
  const rawDek = await rawDekFromPassword(config, password)
  const wrappingKey = await quickAesKey(prfOutput, config.createdAt)
  const iv = randomBytes(12)
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv: toArrayBuffer(iv),
    additionalData: toArrayBuffer(quickAad(config.createdAt)),
  }, wrappingKey, toArrayBuffer(rawDek))

  const stored: QuickUnlockConfig = {
    schemaVersion: 1,
    vaultCreatedAt: config.createdAt,
    rpId: rpId(),
    credentialId: bytesToBase64Url(credentialId),
    prfSalt: bytesToBase64Url(prfSalt),
    wrappedDek: {
      iv: bytesToBase64Url(iv),
      ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    },
    createdAt: new Date().toISOString(),
  }
  await setKv(QUICK_UNLOCK_KEY, stored)
  return stored
}

export async function unlockWithQuickUnlock(config: VaultConfig) {
  const stored = await getQuickUnlockConfig()
  if (!stored || !await hasQuickUnlockForVault(config)) throw new Error('error.quickUnlockUnavailable')

  const prfOutput = await evaluatePrf(base64UrlToBytes(stored.credentialId), base64UrlToBytes(stored.prfSalt))
  const wrappingKey = await quickAesKey(prfOutput, config.createdAt)
  let rawDek: Uint8Array
  try {
    const clear = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: toArrayBuffer(base64UrlToBytes(stored.wrappedDek.iv)),
      additionalData: toArrayBuffer(quickAad(config.createdAt)),
    }, wrappingKey, toArrayBuffer(base64UrlToBytes(stored.wrappedDek.ciphertext)))
    rawDek = new Uint8Array(clear)
  } catch (error) {
    if (isOperationError(error)) throw new Error('error.quickUnlockFailed')
    throw error
  }
  if (rawDek.length !== 32) throw new Error('error.quickUnlockFailed')
  const dek = await crypto.subtle.importKey('raw', toArrayBuffer(rawDek), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])

  await setKv(QUICK_UNLOCK_KEY, { ...stored, lastUsedAt: new Date().toISOString() } satisfies QuickUnlockConfig)
  return dek
}

/**
 * WalletContext owns the in-memory DEK and intentionally exposes no "inject key"
 * escape hatch. Quick Unlock hands the verified non-extractable key to the existing
 * bootstrap path through the same IndexedDB CryptoKey mechanism used by Vault Remember,
 * with a very short expiry. A reload then consumes it and resumes the normal app flow.
 */
export async function handOffQuickUnlockToWallet(config: VaultConfig, dek: CryptoKey) {
  await setRememberedVaultUnlock({
    vaultCreatedAt: config.createdAt,
    expiresAt: Date.now() + BRIDGE_TTL_MS,
    dek,
  })
  window.location.reload()
}
