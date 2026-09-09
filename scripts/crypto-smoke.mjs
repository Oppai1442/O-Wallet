import { webcrypto } from 'node:crypto'

const crypto = webcrypto
const enc = new TextEncoder()
const raw = crypto.getRandomValues(new Uint8Array(32))
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
const iv = crypto.getRandomValues(new Uint8Array(12))
const aad = enc.encode('O-Wallet payload v2:record:transaction:test')
const plaintext = enc.encode('{"id":"test"}')
const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext)
const clear = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ciphertext))
if (new TextDecoder().decode(clear) !== '{"id":"test"}') throw new Error('AES-GCM round trip failed')
let rejected = false
try {
  await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('wrong-context') }, key, ciphertext)
} catch { rejected = true }
if (!rejected) throw new Error('AES-GCM did not reject wrong AAD')
console.log('Crypto smoke PASS (AES-256-GCM + AAD tamper rejection)')
