const encoder = new TextEncoder()
const decoder = new TextDecoder()
const MAGIC = encoder.encode('OWCPG1\0')
const COMPRESS_THRESHOLD = 256 * 1024

function hasPrefix(bytes: Uint8Array, prefix: Uint8Array) {
  return prefix.every((value, index) => bytes[index] === value)
}

function concat(parts: Uint8Array[], total: number) {
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

async function readStreamLimited(stream: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = stream.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      total += value.byteLength
      if (total > maxBytes) throw new Error('error.payloadTooLarge')
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return concat(parts, total)
}

async function gzip(bytes: Uint8Array) {
  if (typeof CompressionStream === 'undefined') return undefined
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return readStreamLimited(stream, Math.max(bytes.byteLength, 1))
}

async function gunzip(bytes: Uint8Array, maxClearBytes: number) {
  if (typeof DecompressionStream === 'undefined') throw new Error('error.checkpointCompressionUnsupported')
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return readStreamLimited(stream, maxClearBytes)
}

export async function encodeCheckpointValue<T>(
  value: T,
  maxStoredBytes: number,
  maxClearBytes: number,
) {
  const clear = encoder.encode(JSON.stringify(value))
  if (clear.byteLength > maxClearBytes) throw new Error('error.payloadTooLarge')

  if (clear.byteLength >= COMPRESS_THRESHOLD) {
    const compressed = await gzip(clear)
    if (compressed && compressed.byteLength + MAGIC.byteLength < clear.byteLength) {
      const packed = new Uint8Array(MAGIC.byteLength + compressed.byteLength)
      packed.set(MAGIC, 0)
      packed.set(compressed, MAGIC.byteLength)
      if (packed.byteLength > maxStoredBytes) throw new Error('error.payloadTooLarge')
      return packed
    }
  }

  if (clear.byteLength > maxStoredBytes) throw new Error('error.payloadTooLarge')
  return clear
}

export async function decodeCheckpointValue<T>(bytes: Uint8Array, maxClearBytes: number): Promise<T> {
  let clear = bytes
  if (hasPrefix(bytes, MAGIC)) {
    clear = await gunzip(bytes.slice(MAGIC.byteLength), maxClearBytes)
  } else if (clear.byteLength > maxClearBytes) {
    throw new Error('error.payloadTooLarge')
  }
  return JSON.parse(decoder.decode(clear)) as T
}

export function isCompressedCheckpoint(bytes: Uint8Array) {
  return hasPrefix(bytes, MAGIC)
}
