const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ALLOWED_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp'])
const SQLITE_EXT = new Set(['mmbak', 'db', 'sqlite', 'sqlite3'])

export const SECURITY_LIMITS = {
  maxImageBytes: 20 * 1024 * 1024,
  maxImagePixels: 50_000_000,
  maxImagesPerBatch: 50,
  maxSqliteImportBytes: 128 * 1024 * 1024,
  maxImportedTransactions: 250_000,
  maxImportedAccounts: 10_000,
  maxImportedCategories: 50_000,
  maxImportedStringLength: 8_192,
  maxClearRecordBytes: 1024 * 1024,
  maxEncryptedRecordBytes: 2 * 1024 * 1024,
  maxEncryptedImageBytes: 22 * 1024 * 1024,
  maxImageHeaderBytes: 64 * 1024,
  maxVaultConfigBytes: 512 * 1024,
  maxOcrTextChars: 200_000,
  maxOcrBoxes: 50_000,
  maxAiResponseChars: 100_000,
  maxAiApiKeyChars: 4_096,
  maxAiModelChars: 256,
  maxAiEndpointChars: 512,
} as const

function extension(name: string) {
  const match = name.toLocaleLowerCase('en-US').match(/\.([a-z0-9]+)$/)
  return match?.[1] ?? ''
}

function startsWithBytes(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value)
}

export function sniffRasterImageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 3 && startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (bytes.length >= 8 && startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) return 'image/webp'
  return undefined
}

export function assertJsonPayloadSize(value: unknown, maxBytes = SECURITY_LIMITS.maxClearRecordBytes) {
  const encoded = new TextEncoder().encode(JSON.stringify(value))
  if (encoded.byteLength > maxBytes) throw new Error('error.recordTooLarge')
}

export async function validateImageFile(file: File) {
  if (file.size <= 0) throw new Error('error.imageEmpty')
  if (file.size > SECURITY_LIMITS.maxImageBytes) throw new Error('error.imageTooLarge')
  const ext = extension(file.name)
  if (ext && !ALLOWED_IMAGE_EXT.has(ext)) throw new Error('error.imageTypeUnsupported')
  if (file.type && !ALLOWED_IMAGE_MIME.has(file.type)) throw new Error('error.imageTypeUnsupported')
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const sniffed = sniffRasterImageMime(header)
  if (!sniffed) throw new Error('error.imageTypeUnsupported')
  if (file.type && file.type !== sniffed) throw new Error('error.imageTypeMismatch')

  if ('createImageBitmap' in globalThis) {
    const bitmap = await createImageBitmap(file)
    try {
      if (bitmap.width <= 0 || bitmap.height <= 0 || bitmap.width * bitmap.height > SECURITY_LIMITS.maxImagePixels) {
        throw new Error('error.imageDimensionsTooLarge')
      }
    } finally {
      bitmap.close()
    }
  }
  return sniffed
}

export async function validateImageBatch(files: File[]) {
  if (files.length > SECURITY_LIMITS.maxImagesPerBatch) throw new Error('error.tooManyImages')
  for (const file of files) await validateImageFile(file)
}

export async function validateSqliteBackupFile(file: File) {
  if (file.size <= 0) throw new Error('error.importEmpty')
  if (file.size > SECURITY_LIMITS.maxSqliteImportBytes) throw new Error('error.importTooLarge')
  const ext = extension(file.name)
  if (ext && !SQLITE_EXT.has(ext)) throw new Error('error.importTypeUnsupported')
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const expected = new TextEncoder().encode('SQLite format 3\0')
  if (header.length < expected.length || !expected.every((value, index) => header[index] === value)) {
    throw new Error('error.importNotSqlite')
  }
}

export function safeDownloadFilename(value: string, fallback = 'file') {
  const cleaned = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180)
  return cleaned || fallback
}

export function safeGoogleProfileImageUrl(value: string | undefined) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return undefined
    if (url.hostname === 'lh3.googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com')) return url.href
    return undefined
  } catch {
    return undefined
  }
}

export function openTrustedExternalUrl(value: string) {
  const url = new URL(value)
  const allowed = url.protocol === 'https:' && (
    url.hostname === 'drive.google.com'
    || url.hostname === 'oppai1442.github.io'
  )
  if (!allowed) throw new Error('error.externalLinkBlocked')
  const popup = window.open(url.href, '_blank', 'noopener,noreferrer')
  if (popup) popup.opener = null
}

function redactSensitiveText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
    .replace(/ya29\.[A-Za-z0-9._~-]+/g, '[redacted-google-token]')
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/gi, '[redacted-openrouter-key]')
    .replace(/[A-Za-z0-9_-]{20,}\.apps\.googleusercontent\.com/g, '[google-client-id]')
    .slice(0, 800)
}

export function reportDiagnostic(context: string, error?: unknown) {
  if (!import.meta.env.DEV && !context.startsWith('quick-unlock')) return
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '')
  console.warn(`[O-Wallet:${context}] ${redactSensitiveText(message)}`)
}
