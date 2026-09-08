import type { EncryptedImageRow, EncryptedRecordRow, SyncStats, VaultConfig } from '../types'
import { packEncryptedPayload, unpackEncryptedPayload } from './crypto'
import { db } from './db'
import {
  ensureDriveLayout,
  listAllDriveFiles,
  uploadDriveFile,
  uploadVaultConfig,
  downloadDriveFile,
  type DriveFileMeta,
} from './drive'

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

function fileMap(files: DriveFileMeta[]) {
  return new Map(files.map((file) => [file.appProperties?.entityId ?? file.name, file]))
}

async function pullRecord(token: string, file: DriveFileMeta): Promise<EncryptedRecordRow> {
  const props = file.appProperties ?? {}
  if (!props.entityId || !props.kind) throw new Error(`Drive record ${file.id} thiếu O-Wallet metadata.`)
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
  if (!props.entityId) throw new Error(`Drive image ${file.id} thiếu O-Wallet metadata.`)
  return {
    id: props.entityId,
    version: Number(props.version ?? 1),
    updatedAt: props.updatedAt ?? file.modifiedTime ?? new Date().toISOString(),
    deviceId: props.deviceId ?? 'remote',
    deleted: props.deleted === '1',
    payload: unpackEncryptedPayload(await downloadDriveFile(token, file.id)),
  }
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

  onProgress?.('Chuẩn bị O-Wallet folder…')
  let layout = await ensureDriveLayout(token)
  layout = await uploadVaultConfig(token, vaultConfig)

  onProgress?.('Đọc index trên Drive…')
  const [remoteRecords, remoteImages, localRecords, localImages] = await Promise.all([
    listAllDriveFiles(token, `'${layout.recordsId}' in parents and trashed = false and appProperties has { key='owalletType' and value='record' }`),
    listAllDriveFiles(token, `'${layout.imagesId}' in parents and trashed = false and appProperties has { key='owalletType' and value='image' }`),
    db.records.toArray(),
    db.images.toArray(),
  ])

  const remoteRecordMap = fileMap(remoteRecords)
  const remoteImageMap = fileMap(remoteImages)

  onProgress?.('Merge transaction records…')
  for (const local of localRecords) {
    const remote = remoteRecordMap.get(local.id)
    if (!remote) {
      await uploadDriveFile(token, {
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
      })
      stats.pushedRecords += 1
      continue
    }

    const cmp = compareStamp(local, remoteStamp(remote))
    if (cmp > 0) {
      await uploadDriveFile(token, {
        id: remote.id,
        name: remote.name,
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
      })
      stats.pushedRecords += 1
      if (local.version === remoteStamp(remote).version) stats.conflictsResolved += 1
    } else if (cmp < 0) {
      await db.records.put(await pullRecord(token, remote))
      stats.pulledRecords += 1
      if (local.version === remoteStamp(remote).version) stats.conflictsResolved += 1
    }
    remoteRecordMap.delete(local.id)
  }

  for (const remote of remoteRecordMap.values()) {
    await db.records.put(await pullRecord(token, remote))
    stats.pulledRecords += 1
  }

  onProgress?.('Merge encrypted images…')
  for (const local of localImages) {
    const remote = remoteImageMap.get(local.id)
    if (!remote) {
      await uploadDriveFile(token, {
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
      })
      stats.pushedImages += 1
      continue
    }

    const cmp = compareStamp(local, remoteStamp(remote))
    if (cmp > 0) {
      await uploadDriveFile(token, {
        id: remote.id,
        name: remote.name,
        content: new Blob([packEncryptedPayload(local.payload) as BlobPart], { type: 'application/octet-stream' }),
        appProperties: {
          owalletType: 'image',
          entityId: local.id,
          version: String(local.version),
          updatedAt: local.updatedAt,
          deviceId: local.deviceId,
          deleted: local.deleted ? '1' : '0',
        },
      })
      stats.pushedImages += 1
      if (local.version === remoteStamp(remote).version) stats.conflictsResolved += 1
    } else if (cmp < 0) {
      await db.images.put(await pullImage(token, remote))
      stats.pulledImages += 1
      if (local.version === remoteStamp(remote).version) stats.conflictsResolved += 1
    }
    remoteImageMap.delete(local.id)
  }

  for (const remote of remoteImageMap.values()) {
    await db.images.put(await pullImage(token, remote))
    stats.pulledImages += 1
  }

  stats.finishedAt = new Date().toISOString()
  onProgress?.('Sync hoàn tất.')
  return stats
}
