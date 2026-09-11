import type {
  DriveLayout,
  EncryptedImageRow,
  EncryptedRecordRow,
  RemoteEntityRow,
  SyncQueueRow,
  SyncStats,
  SyncState,
  VaultConfig,
} from '../types'
import { base64UrlToBytes, bytesToBase64Url, packEncryptedPayload, unpackEncryptedPayload } from './crypto'
import { SECURITY_LIMITS } from './security'
import {
  db,
  dequeueSyncEntity,
  getSyncState,
  queueSyncEntity,
  setSyncState,
  syncQueueKey,
} from './db'
import {
  downloadDriveFile,
  ensureDriveLayout,
  getDriveStartPageToken,
  listAllDriveChanges,
  listAllDriveFiles,
  trashDriveFile,
  uploadDriveFile,
  uploadVaultConfig,
  type DriveChange,
  type DriveFileMeta,
} from './drive'

const SYNC_CONCURRENCY = 5
const SNAPSHOT_CONCURRENCY = 4
const SNAPSHOT_MIN_RECORDS = 1_000
const SNAPSHOT_REFRESH_RECORD_DELTA = 1_000
const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const SNAPSHOT_TARGET_BYTES = 6 * 1024 * 1024
const SNAPSHOT_MAX_PACK_BYTES = 8 * 1024 * 1024
const SNAPSHOT_MAX_MANIFEST_BYTES = 256 * 1024
const SNAPSHOT_MAX_SHARDS = 512
const SNAPSHOT_MAX_RECORDS = 1_000_000
const SNAPSHOT_SCHEMA = 1

const VALID_RECORD_KINDS = new Set(['transaction', 'account', 'category', 'settings'])

type SnapshotRecord = {
  id: string
  kind: EncryptedRecordRow['kind']
  version: number
  updatedAt: string
  deviceId: string
  deleted: boolean
  payload: string
}

type SnapshotPack = {
  schemaVersion: 1
  generation: string
  shardIndex: number
  rows: SnapshotRecord[]
}

type SnapshotManifest = {
  schemaVersion: 1
  generation: string
  createdAt: string
  recordCount: number
  shardCount: number
  shardIds: string[]
}

function validRemoteEntityId(value: string | undefined): value is string {
  return Boolean(value && value.length <= 320 && /^[A-Za-z0-9:_-]+$/.test(value))
}

function validRemoteStamp(file: DriveFileMeta) {
  const props = file.appProperties ?? {}
  const version = Number(props.version ?? 0)
  const updatedAt = props.updatedAt ?? file.modifiedTime ?? ''
  return Number.isInteger(version)
    && version >= 0
    && version <= 1_000_000_000
    && typeof updatedAt === 'string'
    && updatedAt.length <= 64
    && Number.isFinite(Date.parse(updatedAt))
    && (props.deviceId?.length ?? 0) <= 128
}

function assertRemoteFile(file: DriveFileMeta, type: 'record' | 'image') {
  const props = file.appProperties ?? {}
  if (props.owalletType !== type || !validRemoteEntityId(props.entityId) || !validRemoteStamp(file)) {
    throw new Error('error.invalidDriveRecord')
  }
  if (type === 'record' && !VALID_RECORD_KINDS.has(props.kind ?? '')) throw new Error('error.invalidDriveRecord')
  const declared = Number(file.size ?? 0)
  const max = type === 'record' ? SECURITY_LIMITS.maxEncryptedRecordBytes : SECURITY_LIMITS.maxEncryptedImageBytes
  if (Number.isFinite(declared) && declared > max) throw new Error('error.driveFileTooLarge')
}

function compareStamp(
  a: { version: number; updatedAt: string; deviceId: string },
  b: { version: number; updatedAt: string; deviceId: string },
) {
  if (a.version !== b.version) return a.version - b.version
  if (a.updatedAt !== b.updatedAt) return a.updatedAt.localeCompare(b.updatedAt)
  return a.deviceId.localeCompare(b.deviceId)
}

function remoteStamp(file: DriveFileMeta) {
  return {
    version: Number(file.appProperties?.version ?? 0),
    updatedAt: file.appProperties?.updatedAt ?? file.modifiedTime ?? '',
    deviceId: file.appProperties?.deviceId ?? '',
  }
}

function remoteRow(file: DriveFileMeta): RemoteEntityRow | undefined {
  const id = file.appProperties?.entityId
  if (!validRemoteEntityId(id) || !validRemoteStamp(file)) return undefined
  return {
    id,
    fileId: file.id,
    version: Number(file.appProperties?.version ?? 0),
    updatedAt: file.appProperties?.updatedAt ?? file.modifiedTime ?? '',
    deviceId: file.appProperties?.deviceId ?? '',
    deleted: file.appProperties?.deleted === '1',
    size: file.size ? Number(file.size) : undefined,
  }
}

function validRemoteFiles(files: DriveFileMeta[], type: 'record' | 'image') {
  const selected = new Map<string, DriveFileMeta>()
  for (const file of files) {
    try {
      assertRemoteFile(file, type)
    } catch {
      continue
    }
    const id = file.appProperties!.entityId
    const previous = selected.get(id)
    if (!previous || compareStamp(remoteStamp(previous), remoteStamp(file)) < 0) selected.set(id, file)
  }
  return Array.from(selected.values())
}

function fileMap(files: DriveFileMeta[], type: 'record' | 'image') {
  return new Map(validRemoteFiles(files, type).map((file) => [file.appProperties!.entityId, file] as const))
}

async function mapPool<T>(items: T[], limit: number, task: (item: T, index: number) => Promise<void>) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      await task(items[index], index)
    }
  })
  await Promise.all(workers)
}

async function vaultFingerprint(config: VaultConfig) {
  const bytes = new TextEncoder().encode(JSON.stringify(config))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function pullRecord(token: string, file: DriveFileMeta): Promise<EncryptedRecordRow> {
  assertRemoteFile(file, 'record')
  const props = file.appProperties ?? {}
  return {
    id: props.entityId,
    kind: props.kind as EncryptedRecordRow['kind'],
    version: Number(props.version ?? 1),
    updatedAt: props.updatedAt ?? file.modifiedTime ?? new Date().toISOString(),
    deviceId: props.deviceId ?? 'remote',
    deleted: props.deleted === '1',
    payload: unpackEncryptedPayload(await downloadDriveFile(token, file.id, SECURITY_LIMITS.maxEncryptedRecordBytes)),
  }
}

async function pullImage(token: string, file: DriveFileMeta): Promise<EncryptedImageRow> {
  assertRemoteFile(file, 'image')
  const props = file.appProperties ?? {}
  return {
    id: props.entityId,
    version: Number(props.version ?? 1),
    updatedAt: props.updatedAt ?? file.modifiedTime ?? new Date().toISOString(),
    deviceId: props.deviceId ?? 'remote',
    deleted: props.deleted === '1',
    payload: unpackEncryptedPayload(await downloadDriveFile(token, file.id, SECURITY_LIMITS.maxEncryptedImageBytes)),
  }
}

function recordUploadOptions(local: EncryptedRecordRow, layout: DriveLayout, remote?: RemoteEntityRow) {
  return {
    id: remote?.fileId,
    name: `${local.id}.owr`,
    parentId: layout.recordsId,
    content: new Blob([packEncryptedPayload(local.payload) as BlobPart], { type: 'application/octet-stream' }),
    appProperties: {
      owalletType: 'record',
      entityId: local.id,
      kind: local.kind,
      version: String(local.version),
      updatedAt: local.updatedAt,
      deviceId: local.deviceId,
      deleted: local.deleted ? '1' : '0',
    },
  }
}

function imageUploadOptions(local: EncryptedImageRow, layout: DriveLayout, remote?: RemoteEntityRow) {
  return {
    id: remote?.fileId,
    name: `${local.id}.owi`,
    parentId: layout.imagesId,
    content: new Blob([packEncryptedPayload(local.payload) as BlobPart], { type: 'application/octet-stream' }),
    appProperties: {
      owalletType: 'image',
      entityId: local.id,
      version: String(local.version),
      updatedAt: local.updatedAt,
      deviceId: local.deviceId,
      deleted: local.deleted ? '1' : '0',
    },
  }
}

async function cacheRemoteRecord(file: DriveFileMeta) {
  const row = remoteRow(file)
  if (row) await db.remoteRecords.put(row)
  return row
}

async function cacheRemoteImage(file: DriveFileMeta) {
  const row = remoteRow(file)
  if (row) await db.remoteImages.put(row)
  return row
}

async function dequeueIfRecordUnchanged(uploaded: EncryptedRecordRow) {
  const current = await db.records.get(uploaded.id)
  if (current && compareStamp(current, uploaded) === 0) await dequeueSyncEntity('record', uploaded.id)
}

async function dequeueIfImageUnchanged(uploaded: EncryptedImageRow) {
  const current = await db.images.get(uploaded.id)
  if (current && compareStamp(current, uploaded) === 0) await dequeueSyncEntity('image', uploaded.id)
}

async function uploadRecord(token: string, layout: DriveLayout, local: EncryptedRecordRow, stats: SyncStats) {
  const remote = await db.remoteRecords.get(local.id)
  const file = await uploadDriveFile(token, recordUploadOptions(local, layout, remote))
  await cacheRemoteRecord(file)
  await dequeueIfRecordUnchanged(local)
  stats.pushedRecords += 1
}

async function uploadImage(token: string, layout: DriveLayout, local: EncryptedImageRow, stats: SyncStats) {
  const remote = await db.remoteImages.get(local.id)
  const file = await uploadDriveFile(token, imageUploadOptions(local, layout, remote))
  await cacheRemoteImage(file)
  await dequeueIfImageUnchanged(local)
  stats.pushedImages += 1
}

function snapshotRecord(row: EncryptedRecordRow): SnapshotRecord {
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    updatedAt: row.updatedAt,
    deviceId: row.deviceId,
    deleted: row.deleted,
    payload: bytesToBase64Url(new Uint8Array(packEncryptedPayload(row.payload))),
  }
}

function restoreSnapshotRecord(row: SnapshotRecord): EncryptedRecordRow {
  if (!validRemoteEntityId(row.id)) throw new Error('error.invalidDriveRecord')
  if (!VALID_RECORD_KINDS.has(row.kind)) throw new Error('error.invalidDriveRecord')
  if (!Number.isInteger(row.version) || row.version < 0 || row.version > 1_000_000_000) throw new Error('error.invalidDriveRecord')
  if (!row.updatedAt || !Number.isFinite(Date.parse(row.updatedAt)) || row.updatedAt.length > 64) throw new Error('error.invalidDriveRecord')
  if (!row.deviceId || row.deviceId.length > 128) throw new Error('error.invalidDriveRecord')
  const packed = base64UrlToBytes(row.payload)
  if (packed.byteLength > SECURITY_LIMITS.maxEncryptedRecordBytes) throw new Error('error.driveFileTooLarge')
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    updatedAt: row.updatedAt,
    deviceId: row.deviceId,
    deleted: Boolean(row.deleted),
    payload: unpackEncryptedPayload(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer),
  }
}

function buildSnapshotPacks(rows: EncryptedRecordRow[], generation: string) {
  const packs: SnapshotPack[] = []
  let current: SnapshotRecord[] = []
  let currentBytes = 0
  const flush = () => {
    if (!current.length) return
    packs.push({ schemaVersion: SNAPSHOT_SCHEMA, generation, shardIndex: packs.length, rows: current })
    current = []
    currentBytes = 0
  }
  for (const row of rows) {
    const serialized = snapshotRecord(row)
    const estimatedBytes = JSON.stringify(serialized).length + 2
    if (current.length && currentBytes + estimatedBytes > SNAPSHOT_TARGET_BYTES) flush()
    current.push(serialized)
    currentBytes += estimatedBytes
  }
  flush()
  return packs
}

async function listSnapshotFiles(token: string, recordsFolderId: string) {
  return listAllDriveFiles(token, `'${recordsFolderId}' in parents and trashed = false and appProperties has { key='owalletSnapshot' and value='1' }`)
}

function latestSnapshotManifest(files: DriveFileMeta[]) {
  return files
    .filter((file) => file.appProperties?.owalletType === 'bootstrap-manifest' && file.appProperties?.schema === String(SNAPSHOT_SCHEMA))
    .sort((a, b) => (b.appProperties?.createdAt ?? b.modifiedTime ?? '').localeCompare(a.appProperties?.createdAt ?? a.modifiedTime ?? ''))[0]
}

async function hydrateBootstrapSnapshot(token: string, layout: DriveLayout) {
  if ((await db.records.count()) !== 0) return false
  const files = await listSnapshotFiles(token, layout.recordsId)
  const manifestFile = latestSnapshotManifest(files)
  if (!manifestFile) return false
  try {
    const raw = await downloadDriveFile(token, manifestFile.id, SNAPSHOT_MAX_MANIFEST_BYTES)
    const manifest = JSON.parse(new TextDecoder().decode(raw)) as SnapshotManifest
    if (manifest.schemaVersion !== SNAPSHOT_SCHEMA || !manifest.generation || !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error('invalid manifest')
    if (!Number.isInteger(manifest.recordCount) || manifest.recordCount < 0 || manifest.recordCount > SNAPSHOT_MAX_RECORDS) throw new Error('invalid record count')
    if (!Number.isInteger(manifest.shardCount) || manifest.shardCount < 1 || manifest.shardCount > SNAPSHOT_MAX_SHARDS) throw new Error('invalid shard count')
    if (!Array.isArray(manifest.shardIds) || manifest.shardIds.length !== manifest.shardCount || manifest.shardIds.some((id) => typeof id !== 'string' || id.length > 256)) throw new Error('invalid shard ids')

    let restored = 0
    await mapPool(manifest.shardIds, SNAPSHOT_CONCURRENCY, async (fileId, shardIndex) => {
      const bytes = await downloadDriveFile(token, fileId, SNAPSHOT_MAX_PACK_BYTES)
      const pack = JSON.parse(new TextDecoder().decode(bytes)) as SnapshotPack
      if (pack.schemaVersion !== SNAPSHOT_SCHEMA || pack.generation !== manifest.generation || pack.shardIndex !== shardIndex || !Array.isArray(pack.rows)) throw new Error('invalid bootstrap pack')
      const rows = pack.rows.map(restoreSnapshotRecord)
      if (rows.length) await db.records.bulkPut(rows)
      restored += rows.length
    })
    if (restored !== manifest.recordCount) throw new Error('bootstrap record count mismatch')
    return true
  } catch {
    await db.records.clear()
    return false
  }
}

async function maybePublishBootstrapSnapshot(token: string, layout: DriveLayout) {
  const rows = await db.records.toArray()
  if (rows.length < SNAPSHOT_MIN_RECORDS || rows.length > SNAPSHOT_MAX_RECORDS) return
  const existingFiles = await listSnapshotFiles(token, layout.recordsId)
  const latest = latestSnapshotManifest(existingFiles)
  const latestCreatedAt = latest?.appProperties?.createdAt ?? latest?.modifiedTime
  const latestCount = Number(latest?.appProperties?.recordCount ?? 0)
  const freshEnough = latestCreatedAt && Date.now() - Date.parse(latestCreatedAt) < SNAPSHOT_MAX_AGE_MS
  const closeEnough = Number.isFinite(latestCount) && Math.abs(rows.length - latestCount) < SNAPSHOT_REFRESH_RECORD_DELTA
  if (latest && freshEnough && closeEnough) return

  const generation = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const packs = buildSnapshotPacks(rows, generation)
  if (!packs.length || packs.length > SNAPSHOT_MAX_SHARDS) return
  const shardIds = new Array<string>(packs.length)

  await mapPool(packs, SNAPSHOT_CONCURRENCY, async (pack, index) => {
    const text = JSON.stringify(pack)
    if (text.length > SNAPSHOT_MAX_PACK_BYTES) throw new Error('bootstrap pack too large')
    const file = await uploadDriveFile(token, {
      name: `.bootstrap-${generation}-${String(index).padStart(3, '0')}.owpack`,
      parentId: layout.recordsId,
      content: new Blob([text], { type: 'application/json' }),
      appProperties: {
        owalletSnapshot: '1',
        owalletType: 'bootstrap-pack',
        schema: String(SNAPSHOT_SCHEMA),
        generation,
        shardIndex: String(index),
        createdAt,
      },
    })
    shardIds[index] = file.id
  })

  const manifest: SnapshotManifest = {
    schemaVersion: SNAPSHOT_SCHEMA,
    generation,
    createdAt,
    recordCount: rows.length,
    shardCount: shardIds.length,
    shardIds,
  }
  await uploadDriveFile(token, {
    name: `.bootstrap-${generation}.json`,
    parentId: layout.recordsId,
    content: new Blob([JSON.stringify(manifest)], { type: 'application/json' }),
    appProperties: {
      owalletSnapshot: '1',
      owalletType: 'bootstrap-manifest',
      schema: String(SNAPSHOT_SCHEMA),
      generation,
      createdAt,
      recordCount: String(rows.length),
      shardCount: String(shardIds.length),
    },
  })

  const stale = existingFiles.filter((file) => file.appProperties?.generation !== generation)
  await mapPool(stale, 3, async (file) => { await trashDriveFile(token, file.id).catch(() => undefined) })
}

async function fullRecordReconcile(
  token: string,
  layout: DriveLayout,
  remoteFiles: DriveFileMeta[],
  localRows: EncryptedRecordRow[],
  stats: SyncStats,
  bootstrapSeed = false,
) {
  const safeRemoteFiles = validRemoteFiles(remoteFiles, 'record')
  const remoteMap = fileMap(safeRemoteFiles, 'record')
  const remoteRows = safeRemoteFiles.map(remoteRow).filter((row): row is RemoteEntityRow => Boolean(row))
  await db.remoteRecords.clear()
  if (remoteRows.length) await db.remoteRecords.bulkPut(remoteRows)

  await mapPool(localRows, SYNC_CONCURRENCY, async (local) => {
    const remoteFile = remoteMap.get(local.id)
    if (!remoteFile) {
      if (bootstrapSeed) await db.records.delete(local.id)
      else await uploadRecord(token, layout, local, stats)
      return
    }
    const cmp = compareStamp(local, remoteStamp(remoteFile))
    if (bootstrapSeed && cmp !== 0) {
      await db.records.put(await pullRecord(token, remoteFile))
      await dequeueSyncEntity('record', local.id)
      stats.pulledRecords += 1
    } else if (cmp > 0) {
      await uploadRecord(token, layout, local, stats)
      if (local.version === remoteStamp(remoteFile).version) stats.conflictsResolved += 1
    } else if (cmp < 0) {
      await db.records.put(await pullRecord(token, remoteFile))
      await dequeueSyncEntity('record', local.id)
      stats.pulledRecords += 1
      if (local.version === remoteStamp(remoteFile).version) stats.conflictsResolved += 1
    } else {
      await dequeueSyncEntity('record', local.id)
    }
    remoteMap.delete(local.id)
  })

  await mapPool(Array.from(remoteMap.values()), SYNC_CONCURRENCY, async (remoteFile) => {
    await db.records.put(await pullRecord(token, remoteFile))
    await dequeueSyncEntity('record', remoteFile.appProperties?.entityId ?? '')
    stats.pulledRecords += 1
  })
}

async function fullImageReconcile(
  token: string,
  layout: DriveLayout,
  remoteFiles: DriveFileMeta[],
  localRows: EncryptedImageRow[],
  stats: SyncStats,
) {
  const safeRemoteFiles = validRemoteFiles(remoteFiles, 'image')
  const remoteMap = fileMap(safeRemoteFiles, 'image')
  const remoteRows = safeRemoteFiles.map(remoteRow).filter((row): row is RemoteEntityRow => Boolean(row))
  await db.remoteImages.clear()
  if (remoteRows.length) await db.remoteImages.bulkPut(remoteRows)

  await mapPool(localRows, SYNC_CONCURRENCY, async (local) => {
    const remoteFile = remoteMap.get(local.id)
    if (!remoteFile) {
      await uploadImage(token, layout, local, stats)
      return
    }
    const cmp = compareStamp(local, remoteStamp(remoteFile))
    if (cmp > 0) {
      await uploadImage(token, layout, local, stats)
      if (local.version === remoteStamp(remoteFile).version) stats.conflictsResolved += 1
    } else if (cmp < 0) {
      await db.images.delete(local.id)
      await dequeueSyncEntity('image', local.id)
      stats.pulledImages += 1
      if (local.version === remoteStamp(remoteFile).version) stats.conflictsResolved += 1
    } else {
      await dequeueSyncEntity('image', local.id)
    }
    remoteMap.delete(local.id)
  })

  stats.pulledImages += remoteMap.size
}

async function removeRemoteMapping(change: DriveChange) {
  const [record, image] = await Promise.all([
    db.remoteRecords.where('fileId').equals(change.fileId).first(),
    db.remoteImages.where('fileId').equals(change.fileId).first(),
  ])
  if (record) {
    await db.remoteRecords.delete(record.id)
    if (await db.records.get(record.id)) await queueSyncEntity('record', record.id)
  }
  if (image) {
    await db.remoteImages.delete(image.id)
    if (await db.images.get(image.id)) await queueSyncEntity('image', image.id)
  }
}

async function applyRemoteChange(token: string, change: DriveChange, stats: SyncStats) {
  if (change.removed || change.file?.trashed) {
    await removeRemoteMapping(change)
    return
  }
  const file = change.file
  if (!file?.appProperties) return
  const type = file.appProperties.owalletType
  const entityId = file.appProperties.entityId
  if (!entityId) return

  if (type === 'record') {
    try { assertRemoteFile(file, 'record') } catch { return }
    await cacheRemoteRecord(file)
    const local = await db.records.get(entityId)
    if (!local) {
      await db.records.put(await pullRecord(token, file))
      await dequeueSyncEntity('record', entityId)
      stats.pulledRecords += 1
      return
    }
    const cmp = compareStamp(local, remoteStamp(file))
    if (cmp < 0) {
      await db.records.put(await pullRecord(token, file))
      await dequeueSyncEntity('record', entityId)
      stats.pulledRecords += 1
      if (local.version === remoteStamp(file).version) stats.conflictsResolved += 1
    } else if (cmp === 0) {
      await dequeueSyncEntity('record', entityId)
    } else if (!(await db.syncQueue.get(syncQueueKey('record', entityId)))) {
      await queueSyncEntity('record', entityId)
    }
    return
  }

  if (type === 'image') {
    try { assertRemoteFile(file, 'image') } catch { return }
    await cacheRemoteImage(file)
    const local = await db.images.get(entityId)
    if (!local) {
      stats.pulledImages += 1
      return
    }
    const cmp = compareStamp(local, remoteStamp(file))
    if (cmp < 0) {
      await db.images.delete(entityId)
      await dequeueSyncEntity('image', entityId)
      stats.pulledImages += 1
      if (local.version === remoteStamp(file).version) stats.conflictsResolved += 1
    } else if (cmp === 0) {
      await dequeueSyncEntity('image', entityId)
    } else if (!(await db.syncQueue.get(syncQueueKey('image', entityId)))) {
      await queueSyncEntity('image', entityId)
    }
  }
}

async function pushDirtyQueue(token: string, layout: DriveLayout, stats: SyncStats) {
  const queued = await db.syncQueue.orderBy('queuedAt').toArray()
  await mapPool(queued, SYNC_CONCURRENCY, async (item: SyncQueueRow) => {
    if (item.entityType === 'record') {
      const local = await db.records.get(item.entityId)
      if (!local) {
        await db.syncQueue.delete(item.key)
        return
      }
      const remote = await db.remoteRecords.get(local.id)
      if (remote && compareStamp(local, remote) < 0) return
      await uploadRecord(token, layout, local, stats)
      return
    }

    const local = await db.images.get(item.entityId)
    if (!local) {
      await db.syncQueue.delete(item.key)
      return
    }
    const remote = await db.remoteImages.get(local.id)
    if (remote && compareStamp(local, remote) < 0) return
    await uploadImage(token, layout, local, stats)
  })
}

async function runInitialSync(
  token: string,
  layout: DriveLayout,
  stats: SyncStats,
  onProgress?: (message: string) => void,
) {
  const startToken = await getDriveStartPageToken(token)
  onProgress?.('index')

  const startedEmpty = (await db.records.count()) === 0
  let bootstrapSeed = false
  if (startedEmpty) {
    onProgress?.('bootstrap')
    bootstrapSeed = await hydrateBootstrapSnapshot(token, layout)
  }

  const [remoteRecords, remoteImages, localRecords, localImages] = await Promise.all([
    listAllDriveFiles(token, `'${layout.recordsId}' in parents and trashed = false and appProperties has { key='owalletType' and value='record' }`),
    listAllDriveFiles(token, `'${layout.imagesId}' in parents and trashed = false and appProperties has { key='owalletType' and value='image' }`),
    db.records.toArray(),
    db.images.toArray(),
  ])

  if (bootstrapSeed) stats.pulledRecords += localRecords.length
  onProgress?.('records')
  await fullRecordReconcile(token, layout, remoteRecords, localRecords, stats, bootstrapSeed)
  onProgress?.('images')
  await fullImageReconcile(token, layout, remoteImages, localImages, stats)

  const delta = await listAllDriveChanges(token, startToken)
  await mapPool(delta.changes, SYNC_CONCURRENCY, (change) => applyRemoteChange(token, change, stats))
  return delta.newStartPageToken ?? startToken
}

async function syncCore(
  token: string,
  vaultConfig: VaultConfig,
  stats: SyncStats,
  onProgress?: (message: string) => void,
) {
  onProgress?.('prepare')
  let state: SyncState = (await getSyncState()) ?? { schemaVersion: 1 }
  let layout = state.driveLayout ?? await ensureDriveLayout(token)
  const fingerprint = await vaultFingerprint(vaultConfig)

  if (!layout.vaultFileId || state.vaultFingerprint !== fingerprint) {
    layout = await uploadVaultConfig(token, vaultConfig, layout)
    state = { ...state, driveLayout: layout, vaultFingerprint: fingerprint }
    await setSyncState(state)
  }

  let nextToken = state.changeToken
  if (!nextToken) {
    nextToken = await runInitialSync(token, layout, stats, onProgress)
  } else {
    onProgress?.('index')
    const delta = await listAllDriveChanges(token, nextToken)
    onProgress?.('records')
    await mapPool(delta.changes, SYNC_CONCURRENCY, (change) => applyRemoteChange(token, change, stats))
    nextToken = delta.newStartPageToken ?? nextToken
    onProgress?.('images')
  }

  await pushDirtyQueue(token, layout, stats)

  await setSyncState({
    schemaVersion: 1,
    changeToken: nextToken,
    driveLayout: layout,
    vaultFingerprint: fingerprint,
    initializedAt: state.initializedAt ?? new Date().toISOString(),
  })

  // Snapshot files are acceleration caches only. Per-record files remain canonical.
  // Failure to publish a cache must never fail ordinary wallet sync.
  await maybePublishBootstrapSnapshot(token, layout).catch(() => undefined)
}

export async function syncWalletToDrive(
  token: string,
  vaultConfig: VaultConfig,
  onProgress?: (message: string) => void,
): Promise<SyncStats> {
  const startedAt = new Date().toISOString()
  const stats: SyncStats = {
    pulledRecords: 0,
    pushedRecords: 0,
    pulledImages: 0,
    pushedImages: 0,
    conflictsResolved: 0,
    startedAt,
    finishedAt: startedAt,
  }

  try {
    await syncCore(token, vaultConfig, stats, onProgress)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/Google Drive API 404|notFound|File not found/i.test(message)) {
      const previous = await getSyncState()
      await setSyncState({
        schemaVersion: 1,
        changeToken: undefined,
        vaultFingerprint: undefined,
        initializedAt: previous?.initializedAt,
      })
      await syncCore(token, vaultConfig, stats, onProgress)
    } else if (/Google Drive API 410|page token|invalid.*token/i.test(message)) {
      const previous = await getSyncState()
      await setSyncState({
        schemaVersion: 1,
        changeToken: undefined,
        driveLayout: previous?.driveLayout,
        vaultFingerprint: previous?.vaultFingerprint,
        initializedAt: previous?.initializedAt,
      })
      await syncCore(token, vaultConfig, stats, onProgress)
    } else {
      throw error
    }
  }

  stats.finishedAt = new Date().toISOString()
  onProgress?.('done')
  return stats
}

export async function fetchRemoteImageToLocal(token: string, imageId: string) {
  const remote = await db.remoteImages.get(imageId)
  if (!remote || remote.deleted) return undefined
  const file: DriveFileMeta = {
    id: remote.fileId,
    name: `${imageId}.owi`,
    modifiedTime: remote.updatedAt,
    size: remote.size !== undefined ? String(remote.size) : undefined,
    appProperties: {
      owalletType: 'image',
      entityId: imageId,
      version: String(remote.version),
      updatedAt: remote.updatedAt,
      deviceId: remote.deviceId,
      deleted: remote.deleted ? '1' : '0',
    },
  }
  const row = await pullImage(token, file)
  await db.images.put(row)
  return row
}
