import Dexie, { type EntityTable } from 'dexie'
import type {
  DeviceSessionPreferences,
  EncryptedImageRow,
  EncryptedRecordRow,
  GoogleAccountBinding,
  RememberedVaultUnlock,
  VaultConfig,
} from '../types'

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

export async function deleteKv(key: string) {
  await db.kv.delete(key)
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

const DEFAULT_DEVICE_PREFERENCES: DeviceSessionPreferences = {
  googleRemember: 'tab',
  vaultRemember: 'off',
}

export async function getDeviceSessionPreferences(): Promise<DeviceSessionPreferences> {
  return {
    ...DEFAULT_DEVICE_PREFERENCES,
    ...(await getKv<Partial<DeviceSessionPreferences>>('device-session-preferences')),
  }
}

export async function setDeviceSessionPreferences(preferences: DeviceSessionPreferences) {
  await setKv('device-session-preferences', preferences)
}

export async function getRememberedVaultUnlock() {
  return getKv<RememberedVaultUnlock>('remembered-vault-unlock')
}

export async function setRememberedVaultUnlock(value: RememberedVaultUnlock) {
  await setKv('remembered-vault-unlock', value)
}

export async function clearRememberedVaultUnlock() {
  await deleteKv('remembered-vault-unlock')
}

export async function getGoogleAccountBinding() {
  return getKv<GoogleAccountBinding>('google-account-binding')
}

export async function setGoogleAccountBinding(binding: GoogleAccountBinding) {
  await setKv('google-account-binding', binding)
}

export async function clearGoogleAccountBinding() {
  await deleteKv('google-account-binding')
}

export async function clearLocalWalletData() {
  await db.transaction('rw', db.records, db.images, async () => {
    await db.records.clear()
    await db.images.clear()
  })
}

// Removes only account/vault data from this browser. Device preferences and language remain.
export async function clearLocalVaultForAccountSwitch() {
  await db.transaction('rw', db.records, db.images, db.kv, async () => {
    await db.records.clear()
    await db.images.clear()
    await db.kv.bulkDelete([
      'vault-config',
      'remembered-vault-unlock',
      'google-account-binding',
    ])
  })
}
