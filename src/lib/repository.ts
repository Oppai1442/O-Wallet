import type {
  Account,
  AppSettings,
  Category,
  EncryptedImageRow,
  EncryptedPayload,
  EncryptedRecordRow,
  RecordKind,
  Transaction,
  WalletEntity,
} from '../types'
import { decryptBytes, decryptJson, encryptBytes, encryptJson } from './crypto'
import { assertJsonPayloadSize, reportDiagnostic, safeDownloadFilename, SECURITY_LIMITS, sniffRasterImageMime, validateImageFile } from './security'
import { db, deleteKv, getDeviceId, getKv, queueSyncEntities, queueSyncEntity, setKv } from './db'
import { accountCurrencies } from './accounts'

function recordKind(entity: WalletEntity): RecordKind {
  if ('type' in entity) return 'transaction'
  if ('openingBalance' in entity) return 'account'
  if ('icon' in entity) return 'category'
  return 'settings'
}

function cleanCurrency(value: string | undefined) {
  return value?.trim().toUpperCase() ?? ''
}

export class WalletRepository {
  private remoteImageLoader?: (id: string) => Promise<EncryptedImageRow | undefined>

  constructor(private readonly key: CryptoKey) {}

  setRemoteImageLoader(loader?: (id: string) => Promise<EncryptedImageRow | undefined>) {
    this.remoteImageLoader = loader
  }

  async setLocalSecret(name: string, value: string) {
    if (!name || name.length > 128) throw new Error('error.invalidLocalSecret')
    if (!value || value.length > 4_096) throw new Error('error.invalidLocalSecret')
    const payload = await encryptBytes(this.key, new TextEncoder().encode(value), `local-secret:${name}`)
    await setKv(`local-secret:${name}`, payload)
  }

  async getLocalSecret(name: string) {
    if (!name || name.length > 128) return undefined
    const payload = await getKv<EncryptedPayload>(`local-secret:${name}`)
    if (!payload) return undefined
    try {
      const clear = await decryptBytes(this.key, payload, `local-secret:${name}`)
      return new TextDecoder().decode(clear)
    } catch (error) {
      reportDiagnostic(`local-secret:${name}`, error)
      return undefined
    }
  }

  async deleteLocalSecret(name: string) {
    await deleteKv(`local-secret:${name}`)
  }

  async getAll<T extends WalletEntity>(kind: RecordKind, includeDeleted = false): Promise<T[]> {
    const rows = await db.records.where('kind').equals(kind).toArray()
    const result: T[] = []
    for (const row of rows) {
      if (!includeDeleted && row.deleted) continue
      try {
        const value = await decryptJson<T>(this.key, row.payload, `record:${row.kind}:${row.id}`)
        if (value.id !== row.id || recordKind(value) !== row.kind) throw new Error('Encrypted record identity mismatch.')
        if (!includeDeleted && value.deleted) continue
        result.push(value)
      } catch (error) {
        reportDiagnostic(`record-decrypt:${row.id}`, error)
      }
    }
    return result
  }

  async get<T extends WalletEntity>(id: string): Promise<T | undefined> {
    const row = await db.records.get(id)
    if (!row) return undefined
    const value = await decryptJson<T>(this.key, row.payload, `record:${row.kind}:${row.id}`)
    if (value.id !== row.id || recordKind(value) !== row.kind) throw new Error('Encrypted record identity mismatch.')
    return value
  }

  private async validateTransactionAccounts(tx: Transaction, pendingAccounts?: Map<string, Account>) {
    if (tx.deleted) return
    const source = pendingAccounts?.get(tx.accountId) ?? await this.get<Account>(tx.accountId)
    const sourceCurrency = cleanCurrency(tx.currency)
    if (source && !accountCurrencies(source).includes(sourceCurrency)) throw new Error('error.transactionCurrencyNotInAccount')

    if (tx.type !== 'transfer' || !tx.destinationAccountId) return
    const destination = pendingAccounts?.get(tx.destinationAccountId) ?? await this.get<Account>(tx.destinationAccountId)
    const destinationCurrency = cleanCurrency(tx.destinationCurrency ?? tx.currency)
    if (destination && !accountCurrencies(destination).includes(destinationCurrency)) throw new Error('error.transactionCurrencyNotInAccount')
    if (destinationCurrency !== sourceCurrency && !(Number.isFinite(tx.destinationAmount) && Number(tx.destinationAmount) > 0)) {
      throw new Error('error.transferDestinationAmountRequired')
    }
  }

  async put<T extends WalletEntity>(entity: T) {
    if (recordKind(entity) === 'transaction') await this.validateTransactionAccounts(entity as Transaction)
    assertJsonPayloadSize(entity)
    const deviceId = await getDeviceId()
    const existing = await db.records.get(entity.id)
    const nextVersion = (existing?.version ?? 0) + 1
    const kind = recordKind(entity)
    const payload = await encryptJson(this.key, entity, `record:${kind}:${entity.id}`)
    const row: EncryptedRecordRow = {
      id: entity.id,
      kind,
      version: nextVersion,
      updatedAt: entity.updatedAt,
      deviceId,
      deleted: entity.deleted,
      payload,
    }
    await db.records.put(row)
    await queueSyncEntity('record', row.id)
    return row
  }

  async putMany<T extends WalletEntity>(entities: T[]) {
    if (entities.length === 0) return []
    const pendingAccounts = new Map<string, Account>()
    for (const entity of entities) if (recordKind(entity) === 'account') pendingAccounts.set(entity.id, entity as Account)
    for (const entity of entities) {
      if (recordKind(entity) === 'transaction') await this.validateTransactionAccounts(entity as Transaction, pendingAccounts)
      assertJsonPayloadSize(entity)
    }
    const deviceId = await getDeviceId()
    const allRows: EncryptedRecordRow[] = []
    const chunkSize = 250

    for (let offset = 0; offset < entities.length; offset += chunkSize) {
      const chunk = entities.slice(offset, offset + chunkSize)
      const existing = await db.records.bulkGet(chunk.map((entity) => entity.id))
      const rows = await Promise.all(chunk.map(async (entity, index) => {
        const kind = recordKind(entity)
        return {
          id: entity.id,
          kind,
          version: (existing[index]?.version ?? 0) + 1,
          updatedAt: entity.updatedAt,
          deviceId,
          deleted: entity.deleted,
          payload: await encryptJson(this.key, entity, `record:${kind}:${entity.id}`),
        } satisfies EncryptedRecordRow
      }))
      await db.records.bulkPut(rows)
      allRows.push(...rows)
    }

    await queueSyncEntities('record', allRows.map((row) => row.id))
    return allRows
  }

  async tombstoneTransaction(id: string) {
    const transaction = await this.get<Transaction>(id)
    if (!transaction) return
    const now = new Date().toISOString()
    await this.put({ ...transaction, deleted: true, updatedAt: now })
  }

  async saveImage(file: File) {
    await validateImageFile(file)
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
      payload: await encryptBytes(this.key, clear, `image:${id}`),
    }
    await db.images.put(row)
    await queueSyncEntity('image', row.id)
    return row
  }

  async getImageBlob(id: string) {
    let row = await db.images.get(id)
    if (!row && this.remoteImageLoader) row = await this.remoteImageLoader(id)
    if (!row || row.deleted) return undefined
    const clear = await decryptBytes(this.key, row.payload, `image:${id}`)
    if (clear.byteLength < 4) throw new Error('error.corruptImage')
    const headerLength = new DataView(clear.buffer, clear.byteOffset, clear.byteLength).getUint32(0, false)
    if (headerLength <= 0 || headerLength > SECURITY_LIMITS.maxImageHeaderBytes) throw new Error('error.corruptImage')
    const headerEnd = 4 + headerLength
    if (headerEnd > clear.byteLength) throw new Error('error.corruptImage')
    const header = JSON.parse(new TextDecoder().decode(clear.slice(4, headerEnd))) as { mimeType?: string; originalName?: string; originalSize?: number }
    const imageBytes = clear.slice(headerEnd)
    if (imageBytes.byteLength <= 0 || imageBytes.byteLength > SECURITY_LIMITS.maxImageBytes) throw new Error('error.corruptImage')
    const mimeType = sniffRasterImageMime(imageBytes)
    if (!mimeType) throw new Error('error.corruptImage')
    const originalSize = Number(header.originalSize)
    if (Number.isFinite(originalSize) && originalSize >= 0 && originalSize !== imageBytes.byteLength) throw new Error('error.corruptImage')
    const originalName = safeDownloadFilename(header.originalName ?? 'screenshot', 'screenshot')
    const blob = new Blob([imageBytes as BlobPart], { type: mimeType })
    return { blob, mimeType, originalName, originalSize: imageBytes.byteLength }
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
      payload: await encryptBytes(this.key, new Uint8Array(), `image:${id}`),
    })
    await queueSyncEntity('image', id)
  }

  async ensureDefaults() {
    const legacyDefaultIds = new Set(['food', 'shopping', 'transport', 'bills', 'entertainment', 'health', 'salary', 'other'])
    const [existingCategories, existingTransactions, existingSettings] = await Promise.all([
      this.getAll<Category>('category'),
      this.getAll<Transaction>('transaction'),
      this.get<AppSettings>('settings'),
    ])
    const usedCategoryIds = new Set(existingTransactions.map((tx) => tx.categoryId))
    for (const budget of existingSettings?.budgets ?? []) usedCategoryIds.add(budget.categoryId)
    if (existingSettings?.transactionDefaults?.categoryId) usedCategoryIds.add(existingSettings.transactionDefaults.categoryId)
    for (const category of existingCategories) {
      if (legacyDefaultIds.has(category.id) && !usedCategoryIds.has(category.id)) {
        await this.put<Category>({ ...category, deleted: true, updatedAt: new Date().toISOString() })
      }
    }

    if (!existingSettings) {
      const now = new Date().toISOString()
      await this.put<AppSettings>({
        id: 'settings',
        theme: 'system',
        imageRetention: { mode: 'forever', days: 90 },
        defaultCurrency: 'VND',
        autoSync: true,
        rememberDefaults: { googleRemember: '30d', vaultRemember: 'off' },
        ocrTemplates: [],
        budgets: [],
        accountCatalogues: [],
        transactionRules: [],
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
