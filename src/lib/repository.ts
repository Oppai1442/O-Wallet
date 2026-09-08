import { DEFAULT_CATEGORIES } from '../constants'
import type {
  Account,
  AppSettings,
  Category,
  EncryptedImageRow,
  EncryptedRecordRow,
  RecordKind,
  Transaction,
  WalletEntity,
} from '../types'
import { decryptBytes, decryptJson, encryptBytes, encryptJson } from './crypto'
import { db, getDeviceId } from './db'

function recordKind(entity: WalletEntity): RecordKind {
  if ('type' in entity) return 'transaction'
  if ('openingBalance' in entity) return 'account'
  if ('icon' in entity) return 'category'
  return 'settings'
}

export class WalletRepository {
  constructor(private readonly key: CryptoKey) {}

  async getAll<T extends WalletEntity>(kind: RecordKind, includeDeleted = false): Promise<T[]> {
    const rows = await db.records.where('kind').equals(kind).toArray()
    const result: T[] = []
    for (const row of rows) {
      if (!includeDeleted && row.deleted) continue
      try {
        const value = await decryptJson<T>(this.key, row.payload)
        if (!includeDeleted && value.deleted) continue
        result.push(value)
      } catch (error) {
        console.error('Failed to decrypt record', row.id, error)
      }
    }
    return result
  }

  async get<T extends WalletEntity>(id: string): Promise<T | undefined> {
    const row = await db.records.get(id)
    if (!row) return undefined
    return decryptJson<T>(this.key, row.payload)
  }

  async put<T extends WalletEntity>(entity: T) {
    const deviceId = await getDeviceId()
    const existing = await db.records.get(entity.id)
    const nextVersion = (existing?.version ?? 0) + 1
    const payload = await encryptJson(this.key, entity)
    const row: EncryptedRecordRow = {
      id: entity.id,
      kind: recordKind(entity),
      version: nextVersion,
      updatedAt: entity.updatedAt,
      deviceId,
      deleted: entity.deleted,
      payload,
    }
    await db.records.put(row)
    return row
  }

  async tombstoneTransaction(id: string) {
    const transaction = await this.get<Transaction>(id)
    if (!transaction) return
    const now = new Date().toISOString()
    await this.put({ ...transaction, deleted: true, updatedAt: now })
  }

  async saveImage(file: File) {
    const raw = new Uint8Array(await file.arrayBuffer())
    const header = new TextEncoder().encode(JSON.stringify({
      mimeType: file.type || 'application/octet-stream',
      originalName: file.name,
      originalSize: file.size,
    }))
    const clear = new Uint8Array(4 + header.length + raw.length)
    new DataView(clear.buffer).setUint32(0, header.length, false)
    clear.set(header, 4)
    clear.set(raw, 4 + header.length)

    const deviceId = await getDeviceId()
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const row: EncryptedImageRow = {
      id,
      version: 1,
      updatedAt: now,
      deviceId,
      deleted: false,
      payload: await encryptBytes(this.key, clear),
    }
    await db.images.put(row)
    return row
  }

  async getImageBlob(id: string) {
    const row = await db.images.get(id)
    if (!row || row.deleted) return undefined
    const clear = await decryptBytes(this.key, row.payload)
    if (clear.byteLength < 4) throw new Error('error.corruptImage')
    const headerLength = new DataView(clear.buffer, clear.byteOffset, clear.byteLength).getUint32(0, false)
    const headerEnd = 4 + headerLength
    if (headerEnd > clear.byteLength) throw new Error('error.corruptImage')
    const header = JSON.parse(new TextDecoder().decode(clear.slice(4, headerEnd))) as { mimeType: string; originalName: string; originalSize: number }
    const blob = new Blob([clear.slice(headerEnd) as BlobPart], { type: header.mimeType })
    return { blob, ...header }
  }

  async deleteImage(id: string) {
    const row = await db.images.get(id)
    if (!row || row.deleted) return
    const now = new Date().toISOString()
    await db.images.put({
      ...row,
      version: row.version + 1,
      updatedAt: now,
      deviceId: await getDeviceId(),
      deleted: true,
      payload: await encryptBytes(this.key, new Uint8Array()),
    })
  }

  async ensureDefaults() {
    const accounts = await this.getAll<Account>('account')
    if (accounts.length === 0) {
      const now = new Date().toISOString()
      await this.put<Account>({
        id: crypto.randomUUID(),
        name: 'Ví chính',
        currency: 'VND',
        openingBalance: 0,
        archived: false,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      })
    }

    const categories = await this.getAll<Category>('category')
    if (categories.length === 0) {
      for (const category of DEFAULT_CATEGORIES) await this.put(category)
    }

    const settings = await this.get<AppSettings>('settings')
    if (!settings) {
      const now = new Date().toISOString()
      await this.put<AppSettings>({
        id: 'settings',
        theme: 'system',
        imageRetention: { mode: 'forever', days: 90 },
        defaultCurrency: 'VND',
        autoSync: true,
        rememberDefaults: { googleRemember: 'tab', vaultRemember: 'off' },
        ocrTemplates: [],
        budgets: [],
        transactionDefaults: {},
        createdAt: now,
        updatedAt: now,
        deleted: false,
      })
    }
  }

  async storageStats() {
    const images = await db.images.toArray()
    const records = await db.records.toArray()
    return {
      recordCount: records.length,
      imageCount: images.filter((image) => !image.deleted).length,
      imageBytes: images.filter((image) => !image.deleted).reduce((sum, image) => sum + image.payload.ciphertext.byteLength, 0),
    }
  }

  async enforceImageRetention(settings: AppSettings) {
    if (settings.imageRetention.mode === 'forever') return 0
    const cutoff = Date.now() - settings.imageRetention.days * 86_400_000
    const images = await db.images.filter((row) => !row.deleted && new Date(row.updatedAt).getTime() < cutoff).toArray()
    for (const image of images) await this.deleteImage(image.id)
    return images.length
  }
}
