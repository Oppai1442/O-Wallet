function hex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export async function sourceFingerprint(blob: Blob) {
  const fullHashLimit = 16 * 1024 * 1024
  if (blob.size <= fullHashLimit) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
    return `sha256-v2:${blob.size}:${hex(digest)}`
  }

  const chunk = 1024 * 1024
  const points = [
    [0, chunk],
    [Math.max(0, Math.floor(blob.size / 2) - Math.floor(chunk / 2)), Math.min(blob.size, Math.floor(blob.size / 2) + Math.ceil(chunk / 2))],
    [Math.max(0, blob.size - chunk), blob.size],
  ]

  const parts: Uint8Array[] = []
  let total = 16
  for (const [start, end] of points) {
    const bytes = new Uint8Array(await blob.slice(start, end).arrayBuffer())
    parts.push(bytes)
    total += bytes.byteLength
  }

  const payload = new Uint8Array(total)
  const view = new DataView(payload.buffer)
  view.setBigUint64(0, BigInt(blob.size), false)
  view.setUint32(8, points.length, false)
  view.setUint32(12, chunk, false)

  let offset = 16
  for (const part of parts) {
    payload.set(part, offset)
    offset += part.byteLength
  }

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', payload))
  return `sample-sha256-v1:${blob.size}:${hex(digest)}`
}
