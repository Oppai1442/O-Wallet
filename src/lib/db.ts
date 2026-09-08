import Dexie, { type EntityTable } from 'dexie'
import type { EncryptedImageRow, EncryptedRecordRow, VaultConfig } from '../types'

interface KeyValueRow {
  key: string
  value: unknown
}

class OWalletDatabase extends Dexie {
  kv!: EntityTable<KeyValueRow, 'key'>
  records!: EntityTable<EncryptedRecordRow, 'id'>
  images!: EntityTable<EncryptedImageRow, 'id'>

  constructor() {
    super('o-wallet-v1')
    this.version(1).stores({
      kv: '&key',
      records: '&id,kind,updatedAt,deviceId,deleted,version',
      images: '&id,updatedAt,deviceId,deleted,version',
    })
  }
}

export const db = new OWalletDatabase()

export async function getKv<T>(key: string): Promise<T | undefined> {
  const row = await db.kv.get(key)
  return row?.value as T | undefined
}

export async function setKv<T>(key: string, value: T) {
  await db.kv.put({ key, value })
}

export async function getVaultConfig() {
  return getKv<VaultConfig>('vault-config')
}

export async function setVaultConfig(config: VaultConfig) {
  await setKv('vault-config', config)
}

export async function getDeviceId() {
  let id = await getKv<string>('device-id')
  if (!id) {
    id = crypto.randomUUID()
    await setKv('device-id', id)
  }
  return id
}

export async function clearLocalWalletData() {
  await db.transaction('rw', db.records, db.images, async () => {
    await db.records.clear()
    await db.images.clear()
  })
}
