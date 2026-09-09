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
import { packEncryptedPayload, unpackEncryptedPayload } from './crypto'
import {
  db,
  dequeueSyncEntity,
  getSyncState,
  queueSyncEntity,
  setSyncState,
  syncQueueKey,
} from './db'
import {
  ensureDriveLayout,
  getDriveStartPageToken,
  listAllDriveChanges,
  listAllDriveFiles,
  uploadDriveFile,
  uploadVaultConfig,
  downloadDriveFile,
  type DriveChange,
  type DriveFileMeta,
} from './drive'

const SYNC_CONCURRENCY = 5

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
  if (!id) return undefined
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

function fileMap(files: DriveFileMeta[]) {
  return new Map(files.map((file) => [file.appProperties?.entityId ?? file.name, file]))
}

async function mapPool<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      await task(items[index])
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
  const props = file.appProperties ?? {}
  if (!props.entityId || !props.kind) throw new Error('error.invalidDriveRecord')
  return {
    id: props.entityId,
    kind: props.kind as EncryptedRecordRow['kind'],
    version: Number(props.version ?? 1),
    updatedAt: props.updatedAt ?? file.modifiedTime ?? new Date().toISOString(),
    deviceId: props.deviceId ?? 'remote',
    deleted: props.deleted === '1',
    payload: unpackEncryptedPayload(await downloadDriveFile(token, file.id)),
  }
}

async function pullImage(token: string, file: DriveFileMeta): Promise<EncryptedImageRow> {
  const props = file.appProperties ?? {}
  if (!props.entityId) throw new Error('error.invalidDriveRecord')
  return {
    id: props.entityId,
    version: Number(props.version ?? 1),
    updatedAt: props.updatedAt ?? file.modifiedTime ?? new Date().toISOString(),
    deviceId: props.deviceId ?? 'remote',
    deleted: props.deleted === '1',
    payload: unpackEncryptedPayload(await downloadDriveFile(token, file.id)),
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

async function fullRecordReconcile(
  token: string,
  layout: DriveLayout,
  remoteFiles: DriveFileMeta[],
  localRows: EncryptedRecordRow[],
  stats: SyncStats,
) {
  const remoteMap = fileMap(remoteFiles)
  const remoteRows = remoteFiles.map(remoteRow).filter((row): row is RemoteEntityRow => Boolean(row))
  await db.remoteRecords.clear()
  if (remoteRows.length) await db.remoteRecords.bulkPut(remoteRows)

  await mapPool(localRows, SYNC_CONCURRENCY, async (local) => {
    const remoteFile = remoteMap.get(local.id)
    if (!remoteFile) {
      await uploadRecord(token, layout, local, stats)
      return
    }
    const cmp = compareStamp(local, remoteStamp(remoteFile))
    if (cmp > 0) {
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
  const remoteMap = fileMap(remoteFiles)
  const remoteRows = remoteFiles.map(remoteRow).filter((row): row is RemoteEntityRow => Boolean(row))
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
      // Images are lazy on secondary devices. Discard stale local bytes and keep only
      // the Drive metadata; the encrypted image is downloaded when the user opens it.
      await db.images.delete(local.id)
      await dequeueSyncEntity('image', local.id)
      stats.pulledImages += 1
      if (local.version === remoteStamp(remoteFile).version) stats.conflictsResolved += 1
    } else {
      await dequeueSyncEntity('image', local.id)
    }
    remoteMap.delete(local.id)
  })

  // Remote-only images are indexed, not downloaded. This keeps first sync fast even
  // when the wallet has years of screenshots.
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
    await cacheRemoteImage(file)
    const local = await db.images.get(entityId)
    if (!local) {
      // Metadata only; bytes remain in Drive until the image is opened.
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
  // Capture a token before the scan so no concurrent Drive change can fall into the
  // gap between the folder listing and the incremental sync state.
  const startToken = await getDriveStartPageToken(token)
  onProgress?.('index')
  const [remoteRecords, remoteImages, localRecords, localImages] = await Promise.all([
    listAllDriveFiles(token, `'${layout.recordsId}' in parents and trashed = false and appProperties has { key='owalletType' and value='record' }`),
    listAllDriveFiles(token, `'${layout.imagesId}' in parents and trashed = false and appProperties has { key='owalletType' and value='image' }`),
    db.records.toArray(),
    db.images.toArray(),
  ])

  onProgress?.('records')
  await fullRecordReconcile(token, layout, remoteRecords, localRecords, stats)
  onProgress?.('images')
  await fullImageReconcile(token, layout, remoteImages, localImages, stats)

  // Catch changes that happened while the initial scan was running. This includes our
  // own uploads and any concurrent edits from another device, and yields a clean token.
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
    // A cached Drive folder ID can become invalid if the user manually removes the
    // O-Wallet folder. Forget only the cached layout and retry discovery once.
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
      // If Drive ever invalidates an old change cursor, fall back to one full index.
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
