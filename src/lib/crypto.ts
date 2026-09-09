import type { EncryptedPayload, SecurityQuestionConfig, VaultConfig } from '../types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const PBKDF2_ITERATIONS = 600_000
const SECURITY_QUESTION_ITERATIONS = 120_000

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function aesGcmParams(iv: Uint8Array, additionalData?: Uint8Array): AesGcmParams {
  const params: AesGcmParams = {
    name: 'AES-GCM',
    iv: toArrayBuffer(iv),
  }
  // Chromium/WebIDL can reject an optional BufferSource member when the property
  // exists with the value `undefined`. Omit the member entirely when no AAD is used.
  if (additionalData !== undefined) params.additionalData = toArrayBuffer(additionalData)
  return params
}

function isAesAuthenticationFailure(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name?: unknown }).name === 'OperationError'
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i]
  return diff === 0
}

export function randomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length))
}

export function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function normalizeAnswer(answer: string) {
  return answer
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g, ' ')
}

async function sha256(bytes: Uint8Array) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes)))
}

async function importAesKey(raw: Uint8Array, usages: KeyUsage[]) {
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), { name: 'AES-GCM' }, false, usages)
}

async function derivePasswordKey(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS) {
  const material = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(encoder.encode(password)),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      iterations,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function recoveryKeyToAesKey(recoveryKey: string) {
  const normalized = recoveryKey.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  const digest = await sha256(encoder.encode(`O-Wallet recovery v1:${normalized}`))
  return importAesKey(digest, ['encrypt', 'decrypt'])
}

async function encryptRaw(key: CryptoKey, data: Uint8Array, additionalData?: Uint8Array) {
  const iv = randomBytes(12)
  const ciphertext = await crypto.subtle.encrypt(
    aesGcmParams(iv, additionalData),
    key,
    toArrayBuffer(data),
  )
  return { iv, ciphertext }
}

async function decryptRaw(key: CryptoKey, iv: Uint8Array, ciphertext: ArrayBuffer, additionalData?: Uint8Array) {
  const clear = await crypto.subtle.decrypt(
    aesGcmParams(iv, additionalData),
    key,
    ciphertext,
  )
  return new Uint8Array(clear)
}

export function generateRecoveryKey() {
  const raw = Array.from(randomBytes(24), (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
  return raw.match(/.{1,6}/g)?.join('-') ?? raw
}

async function hashSecurityAnswer(answer: string, salt: Uint8Array, iterations?: number) {
  const normalized = encoder.encode(normalizeAnswer(answer))
  if (!iterations) {
    // Backward compatibility for vaults created before v0.10.
    const digest = await sha256(new Uint8Array([...salt, ...encoder.encode(':'), ...normalized]))
    return bytesToBase64Url(digest)
  }
  const material = await crypto.subtle.importKey('raw', toArrayBuffer(normalized), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: toArrayBuffer(salt),
    iterations,
  }, material, 256)
  return bytesToBase64Url(new Uint8Array(bits))
}

function assertVaultConfigParameters(config: VaultConfig) {
  try {
    if (config.schemaVersion !== 1 || config.kdf.name !== 'PBKDF2-SHA256') throw new Error()
    if (!Number.isInteger(config.kdf.iterations) || config.kdf.iterations < 100_000 || config.kdf.iterations > 5_000_000) throw new Error()
    if (base64UrlToBytes(config.kdf.salt).length < 16 || base64UrlToBytes(config.kdf.salt).length > 64) throw new Error()
    if (base64UrlToBytes(config.passwordWrappedDek.iv).length !== 12) throw new Error()
    if (base64UrlToBytes(config.passwordWrappedDek.ciphertext).length !== 48) throw new Error()
    if (base64UrlToBytes(config.recovery.wrappedDek.iv).length !== 12) throw new Error()
    if (base64UrlToBytes(config.recovery.wrappedDek.ciphertext).length !== 48) throw new Error()
    if (!Array.isArray(config.recovery.questions) || config.recovery.questions.length < 2 || config.recovery.questions.length > 10) throw new Error()
    for (const question of config.recovery.questions) {
      if (!question.questionId || question.questionId.length > 128) throw new Error()
      if (base64UrlToBytes(question.answerSalt).length < 16 || base64UrlToBytes(question.answerSalt).length > 64) throw new Error()
      if (base64UrlToBytes(question.answerHash).length !== 32) throw new Error()
      if (question.answerKdfIterations !== undefined && (!Number.isInteger(question.answerKdfIterations) || question.answerKdfIterations < 10_000 || question.answerKdfIterations > 1_000_000)) throw new Error()
    }
  } catch {
    throw new Error('error.invalidVaultConfig')
  }
}

export async function createVault(
  password: string,
  recoveryKey: string,
  questions: Array<{ questionId: string; answer: string }>,
): Promise<{ config: VaultConfig; dek: CryptoKey }> {
  if (password.length < 8) throw new Error('error.passwordTooShort')
  if (password.length > 256) throw new Error('error.passwordTooLong')
  if (questions.length < 2 || questions.some((item) => !item.answer.trim())) {
    throw new Error('error.securityQuestionsRequired')
  }
  if (questions.some((item) => item.answer.length > 256)) throw new Error('error.securityAnswerTooLong')

  const dekRaw = randomBytes(32)
  const dek = await importAesKey(dekRaw, ['encrypt', 'decrypt'])

  const salt = randomBytes(16)
  const passwordKey = await derivePasswordKey(password, salt)
  const passwordWrapped = await encryptRaw(passwordKey, dekRaw)

  const recoveryAes = await recoveryKeyToAesKey(recoveryKey)
  const recoveryWrapped = await encryptRaw(recoveryAes, dekRaw)

  // Verify both independent key envelopes before persisting a vault configuration.
  // This is cheap (AES only; the expensive KDFs above are reused) and prevents a
  // partially unusable vault from ever being committed locally or to Drive.
  const [passwordRoundTrip, recoveryRoundTrip] = await Promise.all([
    decryptRaw(passwordKey, passwordWrapped.iv, passwordWrapped.ciphertext),
    decryptRaw(recoveryAes, recoveryWrapped.iv, recoveryWrapped.ciphertext),
  ])
  if (!bytesEqual(passwordRoundTrip, dekRaw) || !bytesEqual(recoveryRoundTrip, dekRaw)) {
    throw new Error('error.createVault')
  }

  const questionConfigs: SecurityQuestionConfig[] = []
  for (const question of questions) {
    const answerSalt = randomBytes(16)
    questionConfigs.push({
      questionId: question.questionId,
      answerSalt: bytesToBase64Url(answerSalt),
      answerHash: await hashSecurityAnswer(question.answer, answerSalt, SECURITY_QUESTION_ITERATIONS),
      answerKdfIterations: SECURITY_QUESTION_ITERATIONS,
    })
  }

  return {
    dek,
    config: {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      kdf: {
        name: 'PBKDF2-SHA256',
        iterations: PBKDF2_ITERATIONS,
        salt: bytesToBase64Url(salt),
      },
      passwordWrappedDek: {
        iv: bytesToBase64Url(passwordWrapped.iv),
        ciphertext: bytesToBase64Url(new Uint8Array(passwordWrapped.ciphertext)),
      },
      recovery: {
        wrappedDek: {
          iv: bytesToBase64Url(recoveryWrapped.iv),
          ciphertext: bytesToBase64Url(new Uint8Array(recoveryWrapped.ciphertext)),
        },
        questions: questionConfigs,
      },
    },
  }
}

export async function unlockVaultWithPassword(config: VaultConfig, password: string) {
  assertVaultConfigParameters(config)
  const key = await derivePasswordKey(
    password,
    base64UrlToBytes(config.kdf.salt),
    config.kdf.iterations,
  )
  try {
    const raw = await decryptRaw(
      key,
      base64UrlToBytes(config.passwordWrappedDek.iv),
      toArrayBuffer(base64UrlToBytes(config.passwordWrappedDek.ciphertext)),
    )
    return importAesKey(raw, ['encrypt', 'decrypt'])
  } catch (error) {
    if (isAesAuthenticationFailure(error)) throw new Error('error.wrongPassword')
    throw error
  }
}

export async function unlockVaultWithRecovery(
  config: VaultConfig,
  recoveryKey: string,
  answers: string[],
) {
  assertVaultConfigParameters(config)
  if (answers.length !== config.recovery.questions.length) {
    throw new Error('error.missingSecurityAnswers')
  }

  for (let i = 0; i < config.recovery.questions.length; i += 1) {
    const expected = config.recovery.questions[i]
    const actual = await hashSecurityAnswer(answers[i], base64UrlToBytes(expected.answerSalt), expected.answerKdfIterations)
    if (actual !== expected.answerHash) throw new Error('error.wrongSecurityAnswer')
  }

  const key = await recoveryKeyToAesKey(recoveryKey)
  try {
    const raw = await decryptRaw(
      key,
      base64UrlToBytes(config.recovery.wrappedDek.iv),
      toArrayBuffer(base64UrlToBytes(config.recovery.wrappedDek.ciphertext)),
    )
    return importAesKey(raw, ['encrypt', 'decrypt'])
  } catch (error) {
    if (isAesAuthenticationFailure(error)) throw new Error('error.wrongRecoveryKey')
    throw error
  }
}

function aadBytes(context: string | undefined) {
  return context ? encoder.encode(`O-Wallet payload v2:${context}`) : undefined
}

export async function encryptBytes(key: CryptoKey, bytes: Uint8Array, context?: string): Promise<EncryptedPayload> {
  const encrypted = await encryptRaw(key, bytes, aadBytes(context))
  return {
    version: context ? 2 : 1,
    iv: bytesToBase64Url(encrypted.iv),
    ciphertext: encrypted.ciphertext,
  }
}

export async function decryptBytes(key: CryptoKey, payload: EncryptedPayload, context?: string) {
  if (payload.version === 2 && !context) throw new Error('Missing encrypted payload context.')
  return decryptRaw(
    key,
    base64UrlToBytes(payload.iv),
    payload.ciphertext,
    payload.version === 2 ? aadBytes(context) : undefined,
  )
}

export async function encryptJson<T>(key: CryptoKey, value: T, context?: string) {
  return encryptBytes(key, encoder.encode(JSON.stringify(value)), context)
}

export async function decryptJson<T>(key: CryptoKey, payload: EncryptedPayload, context?: string): Promise<T> {
  const clear = await decryptBytes(key, payload, context)
  return JSON.parse(decoder.decode(clear)) as T
}

// Binary envelope: 1-byte format version + 12-byte IV + raw AES-GCM ciphertext.
// Images are never base64 encoded before upload.
export function packEncryptedPayload(payload: EncryptedPayload) {
  const iv = base64UrlToBytes(payload.iv)
  if (iv.length !== 12) throw new Error('Invalid AES-GCM IV.')
  const cipher = new Uint8Array(payload.ciphertext)
  const packed = new Uint8Array(1 + iv.length + cipher.length)
  packed[0] = payload.version
  packed.set(iv, 1)
  packed.set(cipher, 13)
  return packed
}

export function unpackEncryptedPayload(buffer: ArrayBuffer): EncryptedPayload {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 14 || (bytes[0] !== 1 && bytes[0] !== 2)) throw new Error('Unsupported encrypted payload.')
  return {
    version: bytes[0] as 1 | 2,
    iv: bytesToBase64Url(bytes.slice(1, 13)),
    ciphertext: toArrayBuffer(bytes.slice(13)),
  }
}
