const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ALLOWED_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp'])
const SQLITE_EXT = new Set(['mmbak', 'db', 'sqlite', 'sqlite3'])

export const SECURITY_LIMITS = {
  maxImageBytes: 20 * 1024 * 1024,
  maxScrollCaptureBytes: 64 * 1024 * 1024,
  maxImagePixels: 50_000_000,
  maxScrollCapturePixels: 150_000_000,
  maxScrollCaptureHeight: 120_000,
  maxScrollCaptureWidth: 4_096,
  maxImagesPerBatch: 50,
  maxSqliteImportBytes: 128 * 1024 * 1024,
  maxImportedTransactions: 250_000,
  maxImportedAccounts: 10_000,
  maxImportedCategories: 50_000,
  maxImportedStringLength: 8_192,
  maxClearRecordBytes: 1024 * 1024,
  maxEncryptedRecordBytes: 2 * 1024 * 1024,
  maxEncryptedImageBytes: 66 * 1024 * 1024,
  maxImageHeaderBytes: 64 * 1024,
  maxVaultConfigBytes: 512 * 1024,
  maxOcrTextChars: 200_000,
  maxOcrBoxes: 50_000,
  maxOcrCheckpointBytes: 12 * 1024 * 1024,
  maxOcrCheckpointClearBytes: 64 * 1024 * 1024,
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


function u16be(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function u24le(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function u32le(bytes: Uint8Array, offset: number) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

function pngDimensions(bytes: Uint8Array) {
  if (bytes.length < 24 || !startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) }
}

function jpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || !startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return undefined
  const sof = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf])
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) break
    const marker = bytes[offset++]
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 1 >= bytes.length) break
    const length = u16be(bytes, offset)
    if (length < 2 || offset + length > bytes.length) break
    if (sof.has(marker) && length >= 7) {
      const height = u16be(bytes, offset + 3)
      const width = u16be(bytes, offset + 5)
      return { width, height }
    }
    offset += length
  }
  return undefined
}

function webpDimensions(bytes: Uint8Array) {
  if (bytes.length < 30 || sniffRasterImageMime(bytes) !== 'image/webp') return undefined
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(...bytes.slice(offset, offset + 4))
    const size = u32le(bytes, offset + 4)
    const payload = offset + 8
    if (type === 'VP8X' && payload + 10 <= bytes.length) {
      return { width: 1 + u24le(bytes, payload + 4), height: 1 + u24le(bytes, payload + 7) }
    }
    if (type === 'VP8L' && payload + 5 <= bytes.length && bytes[payload] === 0x2f) {
      const b1 = bytes[payload + 1], b2 = bytes[payload + 2], b3 = bytes[payload + 3], b4 = bytes[payload + 4]
      return {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
      }
    }
    if (type === 'VP8 ' && payload + 10 <= bytes.length && bytes[payload + 3] === 0x9d && bytes[payload + 4] === 0x01 && bytes[payload + 5] === 0x2a) {
      return {
        width: (bytes[payload + 6] | (bytes[payload + 7] << 8)) & 0x3fff,
        height: (bytes[payload + 8] | (bytes[payload + 9] << 8)) & 0x3fff,
      }
    }
    offset = payload + size + (size % 2)
  }
  return undefined
}

export async function readRasterImageDimensions(file: Blob) {
  const probeSize = Math.min(file.size, 512 * 1024)
  const bytes = new Uint8Array(await file.slice(0, probeSize).arrayBuffer())
  const mimeType = sniffRasterImageMime(bytes)
  const dimensions = mimeType === 'image/png'
    ? pngDimensions(bytes)
    : mimeType === 'image/jpeg'
      ? jpegDimensions(bytes)
      : mimeType === 'image/webp'
        ? webpDimensions(bytes)
        : undefined
  if (!mimeType || !dimensions || dimensions.width <= 0 || dimensions.height <= 0) throw new Error('error.imageDimensionsTooLarge')
  return { ...dimensions, mimeType }
}

export function assertJsonPayloadSize(value: unknown, maxBytes = SECURITY_LIMITS.maxClearRecordBytes) {
  const encoded = new TextEncoder().encode(JSON.stringify(value))
  if (encoded.byteLength > maxBytes) throw new Error('error.recordTooLarge')
}

export async function validateImageFile(file: File) {
  if (file.size <= 0) throw new Error('error.imageEmpty')
  if (file.size > SECURITY_LIMITS.maxScrollCaptureBytes) throw new Error('error.imageTooLarge')
  const ext = extension(file.name)
  if (ext && !ALLOWED_IMAGE_EXT.has(ext)) throw new Error('error.imageTypeUnsupported')
  if (file.type && !ALLOWED_IMAGE_MIME.has(file.type)) throw new Error('error.imageTypeUnsupported')
  const { width, height, mimeType: sniffed } = await readRasterImageDimensions(file)
  if (file.type && file.type !== sniffed) throw new Error('error.imageTypeMismatch')
  const pixels = width * height
  const scrollLike = height >= width * 4
    && width <= SECURITY_LIMITS.maxScrollCaptureWidth
    && height <= SECURITY_LIMITS.maxScrollCaptureHeight
    && pixels <= SECURITY_LIMITS.maxScrollCapturePixels
  if (file.size > SECURITY_LIMITS.maxImageBytes && !scrollLike) throw new Error('error.imageTooLarge')
  if (pixels > SECURITY_LIMITS.maxImagePixels && !scrollLike) throw new Error('error.imageDimensionsTooLarge')
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
