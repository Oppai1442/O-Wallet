import type { EncryptedRecordRow, SyncProgress, SyncStats } from '../types'
import { base64UrlToBytes, bytesToBase64Url, packEncryptedPayload, unpackEncryptedPayload } from './crypto'
import { db, dequeueSyncEntity, getKv, queueSyncEntity, setKv } from './db'
import { downloadDriveFile, listAllDriveFiles, trashDriveFile, uploadDriveFile, type DriveFileMeta } from './drive'
import { SECURITY_LIMITS } from './security'

const INDEX_SCHEMA = 2
const INDEX_KEY = 'record-shard-index-v2'
const MAX_INDEX_BYTES = 4 * 1024 * 1024
const MAX_SHARD_BYTES = 64 * 1024 * 1024
const SHARD_CONCURRENCY = 6

type StoredRecord = {
  id: string
  kind: EncryptedRecordRow['kind']
  version: number
  updatedAt: string
  deviceId: string
  deleted: boolean
  syncPartition: string
  payload: string
}

type DayMeta = {
  hash: string
  count: number
  fileId?: string
}

type MonthMeta = {
  storage: 'daily' | 'monthly'
  hash: string
  count: number
  fileId?: string
  days: Record<string, DayMeta>
}

export type RecordShardIndex = {
  schemaVersion: 2
  updatedAt: string
  rootHash: string
  totalRecords: number
  months: Record<string, MonthMeta>
}

type DayPack = {
  schemaVersion: 2
  storage: 'daily'
  month: string
  day: string
  hash: string
  rows: StoredRecord[]
}

type MonthPack = {
  schemaVersion: 2
  storage: 'monthly'
  month: string
  hash: string
  days: Record<string, { hash: string; rows: StoredRecord[] }>
}

function validPartition(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function compareStamp(
  a: Pick<EncryptedRecordRow, 'version' | 'updatedAt' | 'deviceId'>,
  b: Pick<EncryptedRecordRow, 'version' | 'updatedAt' | 'deviceId'>,
) {
  if (a.version !== b.version) return a.version - b.version
  if (a.updatedAt !== b.updatedAt) return a.updatedAt.localeCompare(b.updatedAt)
  return a.deviceId.localeCompare(b.deviceId)
}

async function sha256(text: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function storedRecord(row: EncryptedRecordRow): StoredRecord {
  const syncPartition = validPartition(row.syncPartition) ? row.syncPartition : row.updatedAt.slice(0, 10)
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    updatedAt: row.updatedAt,
    deviceId: row.deviceId,
    deleted: row.deleted,
    syncPartition,
    payload: bytesToBase64Url(new Uint8Array(packEncryptedPayload(row.payload))),
  }
}

function restoreRecord(row: StoredRecord): EncryptedRecordRow {
  if (!row.id || row.id.length > 320 || row.kind !== 'transaction' || !validPartition(row.syncPartition)) throw new Error('error.invalidDriveRecord')
  if (!Number.isInteger(row.version) || row.version < 0 || row.version > 1_000_000_000) throw new Error('error.invalidDriveRecord')
  if (!Number.isFinite(Date.parse(row.updatedAt)) || row.updatedAt.length > 64 || row.deviceId.length > 128) throw new Error('error.invalidDriveRecord')
  const packed = base64UrlToBytes(row.payload)
  if (packed.byteLength > SECURITY_LIMITS.maxEncryptedRecordBytes) throw new Error('error.driveFileTooLarge')
  return {
    id: row.id,
    kind: 'transaction',
    version: row.version,
    updatedAt: row.updatedAt,
    deviceId: row.deviceId,
    deleted: Boolean(row.deleted),
    syncPartition: row.syncPartition,
    payload: unpackEncryptedPayload(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer),
  }
}

function previousMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(year, monthNumber - 2, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function currentMonthKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function isHotMonth(month: string) {
  const current = currentMonthKey()
  return month === current || month === previousMonth(current)
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

async function localMonthState() {
  const rows = (await db.records.where('kind').equals('transaction').toArray())
    .filter((row) => validPartition(row.syncPartition))
  const grouped = new Map<string, Map<string, EncryptedRecordRow[]>>()
  for (const row of rows) {
    const partition = row.syncPartition!
    const month = partition.slice(0, 7)
    const day = partition.slice(8, 10)
    let days = grouped.get(month)
    if (!days) {
      days = new Map()
      grouped.set(month, days)
    }
    const list = days.get(day) ?? []
    list.push(row)
    days.set(day, list)
  }

  const months = new Map<string, { hash: string; count: number; days: Map<string, { hash: string; rows: StoredRecord[] }> }>()
  for (const [month, days] of grouped) {
    const dayEntries: string[] = []
    const builtDays = new Map<string, { hash: string; rows: StoredRecord[] }>()
    let count = 0
    for (const [day, dayRows] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const serialized = dayRows.map(storedRecord).sort((a, b) => a.id.localeCompare(b.id))
      const canonical = JSON.stringify(serialized)
      const hash = await sha256(canonical)
      builtDays.set(day, { hash, rows: serialized })
      dayEntries.push(`${day}:${hash}`)
      count += serialized.length
    }
    const hash = await sha256(dayEntries.join('\n'))
    months.set(month, { hash, count, days: builtDays })
  }
  return months
}

async function findRemoteIndexFile(token: string, recordsId: string) {
  const files = await listAllDriveFiles(token, `'${recordsId}' in parents and trashed = false and appProperties has { key='owalletType' and value='record-index-v2' }`)
  return files.sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''))[0]
}

async function readRemoteIndex(token: string, recordsId: string) {
  const file = await findRemoteIndexFile(token, recordsId)
  if (!file) return { file: undefined, index: undefined }
  try {
    const bytes = await downloadDriveFile(token, file.id, MAX_INDEX_BYTES)
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as RecordShardIndex
    if (parsed.schemaVersion !== INDEX_SCHEMA || typeof parsed.rootHash !== 'string' || !parsed.months || typeof parsed.months !== 'object') throw new Error('invalid shard index')
    return { file, index: parsed }
  } catch {
    return { file: undefined, index: undefined }
  }
}

function referencedFileIds(index: RecordShardIndex | undefined) {
  const ids = new Set<string>()
  if (!index) return ids
  for (const month of Object.values(index.months)) {
    if (month.fileId) ids.add(month.fileId)
    for (const day of Object.values(month.days)) if (day.fileId) ids.add(day.fileId)
  }
  return ids
}

async function mergeRemoteRows(rows: EncryptedRecordRow[], stats: SyncStats) {
  if (!rows.length) return
  const existing = await db.records.bulkGet(rows.map((row) => row.id))
  const puts: EncryptedRecordRow[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const remote = rows[index]
    const local = existing[index]
    if (!local || compareStamp(local, remote) < 0) {
      puts.push(remote)
      await dequeueSyncEntity('record', remote.id)
      stats.pulledRecords += 1
    } else if (compareStamp(local, remote) > 0) {
      await queueSyncEntity('record', local.id)
    } else {
      await dequeueSyncEntity('record', remote.id)
    }
  }
  if (puts.length) await db.records.bulkPut(puts)
}

async function pullMonth(
  token: string,
  monthKey: string,
  remote: MonthMeta,
  cached: MonthMeta | undefined,
  stats: SyncStats,
  onProgress?: (progress: SyncProgress) => void,
  progress?: { completed: number; total: number },
) {
  if (remote.hash === cached?.hash) return
  if (remote.storage === 'monthly') {
    if (!remote.fileId) return
    const bytes = await downloadDriveFile(token, remote.fileId, MAX_SHARD_BYTES)
    const pack = JSON.parse(new TextDecoder().decode(bytes)) as MonthPack
    if (pack.schemaVersion !== INDEX_SCHEMA || pack.storage !== 'monthly' || pack.month !== monthKey || pack.hash !== remote.hash) throw new Error('error.invalidDriveRecord')
    const rows: EncryptedRecordRow[] = []
    for (const [day, payload] of Object.entries(pack.days)) {
      if (payload.hash !== remote.days[day]?.hash) throw new Error('error.invalidDriveRecord')
      rows.push(...payload.rows.map(restoreRecord))
    }
    await mergeRemoteRows(rows, stats)
    if (progress) {
      progress.completed += rows.length
      onProgress?.({ step: 'records', completed: Math.min(progress.completed, progress.total), total: progress.total })
    }
    return
  }

  const days = Object.entries(remote.days).filter(([day, meta]) => meta.hash !== cached?.days[day]?.hash)
  await mapPool(days, SHARD_CONCURRENCY, async ([day, meta]) => {
    if (!meta.fileId) return
    const bytes = await downloadDriveFile(token, meta.fileId, MAX_SHARD_BYTES)
    const pack = JSON.parse(new TextDecoder().decode(bytes)) as DayPack
    if (pack.schemaVersion !== INDEX_SCHEMA || pack.storage !== 'daily' || pack.month !== monthKey || pack.day !== day || pack.hash !== meta.hash) throw new Error('error.invalidDriveRecord')
    const rows = pack.rows.map(restoreRecord)
    await mergeRemoteRows(rows, stats)
    if (progress) {
      progress.completed += rows.length
      onProgress?.({ step: 'records', completed: Math.min(progress.completed, progress.total), total: progress.total })
    }
  })
}

async function pullRemoteChanges(
  token: string,
  remote: RecordShardIndex,
  cached: RecordShardIndex | undefined,
  stats: SyncStats,
  onProgress?: (progress: SyncProgress) => void,
) {
  if (remote.rootHash === cached?.rootHash) return
  const changed = Object.entries(remote.months).filter(([month, meta]) => meta.hash !== cached?.months[month]?.hash)
  const total = changed.reduce((sum, [, meta]) => sum + meta.count, 0)
  const progress = { completed: 0, total }
  if (total) onProgress?.({ step: 'records', completed: 0, total })
  for (const [month, meta] of changed) await pullMonth(token, month, meta, cached?.months[month], stats, onProgress, progress)
}

async function transactionQueueState() {
  const queued = await db.syncQueue.where('entityType').equals('record').toArray()
  if (!queued.length) return { hasDirtyTransactions: false, queued: [] as typeof queued }
  const rows = await db.records.bulkGet(queued.map((item) => item.entityId))
  return {
    hasDirtyTransactions: rows.some((row) => row?.kind === 'transaction'),
    queued,
  }
}

function storageTransitionNeeded(index: RecordShardIndex | undefined) {
  if (!index) return false
  return Object.entries(index.months).some(([month, meta]) => meta.storage !== (isHotMonth(month) ? 'daily' : 'monthly'))
}

function changedUploadRecordCount(
  remote: RecordShardIndex | undefined,
  localMonths: Awaited<ReturnType<typeof localMonthState>>,
) {
  let total = 0
  for (const [month, local] of localMonths) {
    const remoteMonth = remote?.months[month]
    const storage: MonthMeta['storage'] = isHotMonth(month) ? 'daily' : 'monthly'
    if (remoteMonth?.hash === local.hash && remoteMonth.storage === storage) continue
    if (storage === 'monthly' || remoteMonth?.storage !== 'daily') {
      total += local.count
      continue
    }
    for (const [day, payload] of local.days) {
      const remoteDay = remoteMonth.days[day]
      if (!remoteDay?.fileId || remoteDay.hash !== payload.hash) total += payload.rows.length
    }
  }
  return total
}

async function publishLocal(
  token: string,
  recordsId: string,
  remoteFile: DriveFileMeta | undefined,
  remote: RecordShardIndex | undefined,
  localMonths: Awaited<ReturnType<typeof localMonthState>>,
  stats: SyncStats,
  onProgress?: (progress: SyncProgress) => void,
) {
  const nextMonths: Record<string, MonthMeta> = {}
  const changedRecordCount = changedUploadRecordCount(remote, localMonths)
  let completed = 0
  if (changedRecordCount) onProgress?.({ step: 'records', completed: 0, total: changedRecordCount })

  for (const [month, local] of [...localMonths.entries()].sort(([a], [b]) => b.localeCompare(a))) {
    const remoteMonth = remote?.months[month]
    const hot = isHotMonth(month)
    const storage: MonthMeta['storage'] = hot ? 'daily' : 'monthly'

    if (remoteMonth?.hash === local.hash && remoteMonth.storage === storage) {
      nextMonths[month] = remoteMonth
      continue
    }

    if (storage === 'monthly') {
      const daysObject: MonthPack['days'] = {}
      const dayMeta: Record<string, DayMeta> = {}
      for (const [day, payload] of local.days) {
        daysObject[day] = payload
        dayMeta[day] = { hash: payload.hash, count: payload.rows.length }
      }
      const pack: MonthPack = { schemaVersion: 2, storage: 'monthly', month, hash: local.hash, days: daysObject }
      const text = JSON.stringify(pack)
      if (new TextEncoder().encode(text).byteLength > MAX_SHARD_BYTES) throw new Error('error.driveFileTooLarge')
      const file = await uploadDriveFile(token, {
        id: remoteMonth?.storage === 'monthly' ? remoteMonth.fileId : undefined,
        name: `${month}.owpack`,
        parentId: recordsId,
        content: new Blob([text], { type: 'application/json' }),
        appProperties: { owalletType: 'record-shard-v2', schema: '2', storage: 'monthly', month, hash: local.hash, recordCount: String(local.count) },
      })
      nextMonths[month] = { storage, hash: local.hash, count: local.count, fileId: file.id, days: dayMeta }
      stats.pushedRecords += local.count
      completed += local.count
      onProgress?.({ step: 'records', completed: Math.min(completed, changedRecordCount), total: changedRecordCount })
      continue
    }

    const nextDays: Record<string, DayMeta> = {}
    const dayEntries = [...local.days.entries()]
    await mapPool(dayEntries, SHARD_CONCURRENCY, async ([day, payload]) => {
      const remoteDay = remoteMonth?.storage === 'daily' ? remoteMonth.days[day] : undefined
      if (remoteDay?.hash === payload.hash && remoteDay.fileId) {
        nextDays[day] = remoteDay
        return
      }
      const pack: DayPack = { schemaVersion: 2, storage: 'daily', month, day, hash: payload.hash, rows: payload.rows }
      const text = JSON.stringify(pack)
      if (new TextEncoder().encode(text).byteLength > MAX_SHARD_BYTES) throw new Error('error.driveFileTooLarge')
      const file = await uploadDriveFile(token, {
        id: remoteDay?.fileId,
        name: `${month}-${day}.owday`,
        parentId: recordsId,
        content: new Blob([text], { type: 'application/json' }),
        appProperties: { owalletType: 'record-shard-v2', schema: '2', storage: 'daily', month, day, hash: payload.hash, recordCount: String(payload.rows.length) },
      })
      nextDays[day] = { hash: payload.hash, count: payload.rows.length, fileId: file.id }
      stats.pushedRecords += payload.rows.length
      completed += payload.rows.length
      onProgress?.({ step: 'records', completed: Math.min(completed, changedRecordCount), total: changedRecordCount })
    })
    nextMonths[month] = { storage, hash: local.hash, count: local.count, days: nextDays }
  }

  const monthHashes = Object.entries(nextMonths).sort(([a], [b]) => a.localeCompare(b)).map(([month, meta]) => `${month}:${meta.hash}`)
  const rootHash = await sha256(monthHashes.join('\n'))
  const nextIndex: RecordShardIndex = {
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
    rootHash,
    totalRecords: Object.values(nextMonths).reduce((sum, month) => sum + month.count, 0),
    months: nextMonths,
  }

  if (nextIndex.rootHash !== remote?.rootHash) {
    const latestRemote = await readRemoteIndex(token, recordsId)
    if ((latestRemote.index?.rootHash ?? '') !== (remote?.rootHash ?? '')) throw new Error('record-shard-index-changed')
    const text = JSON.stringify(nextIndex)
    if (new TextEncoder().encode(text).byteLength > MAX_INDEX_BYTES) throw new Error('error.driveFileTooLarge')
    await uploadDriveFile(token, {
      id: remoteFile?.id,
      name: '.record-index-v2.json',
      parentId: recordsId,
      content: new Blob([text], { type: 'application/json' }),
      appProperties: { owalletType: 'record-index-v2', schema: '2', rootHash, recordCount: String(nextIndex.totalRecords), updatedAt: nextIndex.updatedAt },
    })
  }

  await setKv(INDEX_KEY, nextIndex)
  const newRefs = referencedFileIds(nextIndex)
  const oldRefs = referencedFileIds(remote)
  const stale = [...oldRefs].filter((id) => !newRefs.has(id))
  await mapPool(stale, 3, async (fileId) => { await trashDriveFile(token, fileId).catch(() => undefined) })

  const queuedTransactions = await db.syncQueue.where('entityType').equals('record').toArray()
  const queuedRows = await db.records.bulkGet(queuedTransactions.map((item) => item.entityId))
  await Promise.all(queuedTransactions.map(async (item, index) => {
    if (queuedRows[index]?.kind === 'transaction') await dequeueSyncEntity('record', item.entityId)
  }))
  return nextIndex
}

export async function hasRemoteRecordShards(token: string, recordsId: string) {
  return Boolean(await findRemoteIndexFile(token, recordsId))
}

export async function syncRecordShards(
  token: string,
  recordsId: string,
  stats: SyncStats,
  onProgress?: (progress: SyncProgress) => void,
) {
  let cached = await getKv<RecordShardIndex>(INDEX_KEY)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { file, index: remote } = await readRemoteIndex(token, recordsId)
    const queueState = await transactionQueueState()
    if (
      remote
      && cached
      && remote.rootHash === cached.rootHash
      && !queueState.hasDirtyTransactions
      && !storageTransitionNeeded(remote)
    ) return remote

    if (remote) await pullRemoteChanges(token, remote, cached, stats, onProgress)
    const local = await localMonthState()
    try {
      return await publishLocal(token, recordsId, file, remote, local, stats, onProgress)
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'record-shard-index-changed' || attempt === 2) throw error
      cached = remote
    }
  }
  throw new Error('error.syncFailed')
}
