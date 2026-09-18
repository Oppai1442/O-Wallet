import {
  DRIVE_ROOT_NAME,
  IMAGES_FOLDER_NAME,
  RECORDS_FOLDER_NAME,
  VAULT_FILE_NAME,
} from '../constants'
import type { DriveLayout, DriveStorageMode, VaultConfig } from '../types'
import { SECURITY_LIMITS } from './security'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export interface DriveFileMeta {
  id: string
  name: string
  mimeType?: string
  modifiedTime?: string
  size?: string
  trashed?: boolean
  appProperties?: Record<string, string>
}

function authHeaders(token: string, extra?: HeadersInit) {
  return {
    Authorization: `Bearer ${token}`,
    ...extra,
  }
}

const DRIVE_RETRY_ATTEMPTS = 5

async function retryDelay(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get('retry-after') ?? 0)
  const delay = retryAfter > 0
    ? Math.min(8_000, retryAfter * 1_000)
    : Math.min(4_000, 250 * 2 ** attempt)
  await new Promise((resolve) => window.setTimeout(resolve, delay))
}

async function retryableDriveResponse(response: Response) {
  if (response.status === 429 || response.status >= 500) return true
  if (response.status !== 403) return false
  try {
    const body = await response.clone().text()
    return /rateLimitExceeded|userRateLimitExceeded|sharingRateLimitExceeded/i.test(body)
  } catch {
    return false
  }
}

async function driveFetch(token: string, url: string, init?: RequestInit) {
  let response: Response | undefined
  for (let attempt = 0; attempt < DRIVE_RETRY_ATTEMPTS; attempt += 1) {
    response = await fetch(url, {
      ...init,
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: authHeaders(token, init?.headers),
    })
    if (response.ok) return response
    if (attempt >= DRIVE_RETRY_ATTEMPTS - 1 || !(await retryableDriveResponse(response))) break
    await retryDelay(response, attempt)
  }
  if (!response) throw new Error('Google Drive API request failed')
  if (response.status === 403) {
    try {
      const body = await response.clone().text()
      if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions|Insufficient Permission/i.test(body)) {
        throw new Error('error.googleDrivePermissionsRequired')
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'error.googleDrivePermissionsRequired') throw error
    }
  }
  throw new Error(`Google Drive API ${response.status}`)
}

async function driveJson<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const response = await driveFetch(token, url, init)
  return response.json() as Promise<T>
}

function driveQueryLiteral(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function qs(params: Record<string, string | undefined>) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) search.set(key, value)
  })
  return search.toString()
}

export interface DriveChange {
  fileId: string
  removed?: boolean
  file?: DriveFileMeta
}

export async function getDriveStartPageToken(token: string) {
  const result = await driveJson<{ startPageToken: string }>(token, `${DRIVE_API}/changes/startPageToken?${qs({ fields: 'startPageToken' })}`)
  return result.startPageToken
}

export async function listDriveChanges(token: string, pageToken: string, space: 'drive' | 'appDataFolder' = 'drive'): Promise<{ changes: DriveChange[]; nextPageToken?: string; newStartPageToken?: string }> {
  return driveJson(token, `${DRIVE_API}/changes?${qs({
    pageToken,
    spaces: space,
    pageSize: '1000',
    includeRemoved: 'true',
    fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,modifiedTime,size,appProperties,trashed))',
  })}`)
}

export async function listAllDriveChanges(token: string, startToken: string, space: 'drive' | 'appDataFolder' = 'drive') {
  const changes: DriveChange[] = []
  let pageToken = startToken
  let newStartPageToken: string | undefined
  do {
    const page = await listDriveChanges(token, pageToken, space)
    changes.push(...page.changes)
    if (page.nextPageToken) pageToken = page.nextPageToken
    else { newStartPageToken = page.newStartPageToken; break }
  } while (true)
  return { changes, newStartPageToken }
}

export async function listDriveFiles(token: string, query: string, pageToken?: string, space: 'drive' | 'appDataFolder' = 'drive'): Promise<{ files: DriveFileMeta[]; nextPageToken?: string }> {
  return driveJson(token, `${DRIVE_API}/files?${qs({ q: query, spaces: space, pageSize: '1000', pageToken, fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,appProperties)' })}`)
}

export async function listAllDriveFiles(token: string, query: string, space: 'drive' | 'appDataFolder' = 'drive') {
  const result: DriveFileMeta[] = []
  let pageToken: string | undefined
  do {
    const page = await listDriveFiles(token, query, pageToken, space)
    result.push(...page.files)
    pageToken = page.nextPageToken
  } while (pageToken)
  return result
}

export async function createDriveFolder(token: string, name: string, parentId?: string, appProperties?: Record<string, string>) {
  return driveJson<DriveFileMeta>(token, `${DRIVE_API}/files?fields=id,name,mimeType,appProperties`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined, appProperties }),
  })
}

async function findChild(token: string, parentId: string, name: string, mimeType?: string, space: 'drive' | 'appDataFolder' = 'drive') {
  const query = [`'${driveQueryLiteral(parentId)}' in parents`, `name = '${driveQueryLiteral(name)}'`, 'trashed = false', mimeType ? `mimeType = '${mimeType}'` : undefined].filter(Boolean).join(' and ')
  return (await listAllDriveFiles(token, query, space))[0]
}

async function findChildByAppProperty(token: string, parentId: string, key: string, value: string, mimeType?: string, space: 'drive' | 'appDataFolder' = 'drive') {
  const query = [`'${driveQueryLiteral(parentId)}' in parents`, 'trashed = false', `appProperties has { key='${driveQueryLiteral(key)}' and value='${driveQueryLiteral(value)}' }`, mimeType ? `mimeType = '${mimeType}'` : undefined].filter(Boolean).join(' and ')
  return (await listAllDriveFiles(token, query, space))[0]
}

const STORAGE_NOTE_NAME = 'README - O-Wallet data.txt'
const STORAGE_NOTE_TEXT = [
  'O-Wallet data is managed by the O-Wallet application.',
  '',
  'If hidden storage is enabled, personal wallet data is stored in Google Drive appDataFolder and is not visible in My Drive.',
  'Do not try to remove hidden O-Wallet data manually. Use O-Wallet > Settings > Data & app > Destroy all data.',
  '',
  'Shared Wallet files may remain visible because Google Drive does not allow appDataFolder files to be shared.',
].join('\n')

async function updateDriveMetadata(token: string, fileId: string, body: Record<string, unknown>) {
  return driveJson<DriveFileMeta>(token, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,size,appProperties`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function findVisibleRoot(token: string) {
  const roots = await listAllDriveFiles(token, `mimeType = '${FOLDER_MIME}' and trashed = false and appProperties has { key='owalletRoot' and value='1' }`, 'drive')
  return roots[0]
}

async function ensureVisibleRoot(token: string) {
  return (await findVisibleRoot(token))
    ?? await createDriveFolder(token, DRIVE_ROOT_NAME, undefined, { owalletRoot: '1', schema: '1', owalletStorageMode: 'visible' })
}

async function findHiddenRoot(token: string) {
  const roots = await listAllDriveFiles(token, `mimeType = '${FOLDER_MIME}' and trashed = false and appProperties has { key='owalletHiddenRoot' and value='1' }`, 'appDataFolder')
  return roots[0]
}

async function ensureHiddenRoot(token: string) {
  return (await findHiddenRoot(token))
    ?? await createDriveFolder(token, DRIVE_ROOT_NAME, 'appDataFolder', { owalletHiddenRoot: '1', schema: '1' })
}

async function ensureStorageNote(token: string, visibleRootId: string) {
  const existing = await findChildByAppProperty(token, visibleRootId, 'owalletType', 'storage-note')
  await uploadDriveFile(token, {
    id: existing?.id,
    name: STORAGE_NOTE_NAME,
    parentId: visibleRootId,
    content: new Blob([STORAGE_NOTE_TEXT], { type: 'text/plain;charset=utf-8' }),
    appProperties: { owalletType: 'storage-note', schema: '1' },
  })
}

async function layoutInsideRoot(token: string, rootId: string, space: 'drive' | 'appDataFolder', create = false): Promise<DriveLayout> {
  const [recordsByTag, imagesByTag, vaultByTag] = await Promise.all([
    findChildByAppProperty(token, rootId, 'owalletFolder', 'records', FOLDER_MIME, space),
    findChildByAppProperty(token, rootId, 'owalletFolder', 'images', FOLDER_MIME, space),
    findChildByAppProperty(token, rootId, 'owalletType', 'vault-config', undefined, space),
  ])
  let records = recordsByTag ?? await findChild(token, rootId, RECORDS_FOLDER_NAME, FOLDER_MIME, space)
  let images = imagesByTag ?? await findChild(token, rootId, IMAGES_FOLDER_NAME, FOLDER_MIME, space)
  const vault = vaultByTag ?? await findChild(token, rootId, VAULT_FILE_NAME, undefined, space)
  if (create && !records) records = await createDriveFolder(token, RECORDS_FOLDER_NAME, rootId, { owalletFolder: 'records' })
  if (create && !images) images = await createDriveFolder(token, IMAGES_FOLDER_NAME, rootId, { owalletFolder: 'images' })
  return {
    rootId,
    recordsId: records?.id ?? '',
    imagesId: images?.id ?? '',
    vaultFileId: vault?.id,
    space,
  }
}

export async function findExistingDriveLayout(token: string): Promise<DriveLayout | undefined> {
  const visibleRoot = await findVisibleRoot(token)
  if (!visibleRoot) {
    const hiddenRoot = await findHiddenRoot(token).catch(() => undefined)
    if (!hiddenRoot) return undefined
    const layout = await layoutInsideRoot(token, hiddenRoot.id, 'appDataFolder')
    return { ...layout, storageMode: 'hidden', space: 'appDataFolder' }
  }

  const mode = visibleRoot.appProperties?.owalletStorageMode === 'hidden' ? 'hidden' : 'visible'
  if (mode === 'hidden') {
    const hiddenRoot = await findHiddenRoot(token)
    if (!hiddenRoot) throw new Error('error.hiddenDriveDataMissing')
    const layout = await layoutInsideRoot(token, hiddenRoot.id, 'appDataFolder')
    return { ...layout, storageMode: 'hidden', visibleRootId: visibleRoot.id, space: 'appDataFolder' }
  }
  const layout = await layoutInsideRoot(token, visibleRoot.id, 'drive')
  return { ...layout, storageMode: 'visible', visibleRootId: visibleRoot.id, space: 'drive' }
}

export async function ensureDriveLayout(token: string): Promise<DriveLayout> {
  const existing = await findExistingDriveLayout(token)
  if (existing) {
    const layout = await layoutInsideRoot(token, existing.rootId, existing.space ?? 'drive', true)
    return { ...layout, storageMode: existing.storageMode ?? 'visible', visibleRootId: existing.visibleRootId ?? (existing.storageMode === 'hidden' ? undefined : existing.rootId), space: existing.space ?? 'drive' }
  }
  const root = await ensureVisibleRoot(token)
  const layout = await layoutInsideRoot(token, root.id, 'drive', true)
  return { ...layout, storageMode: 'visible', visibleRootId: root.id, space: 'drive' }
}

async function copyFileContent(token: string, source: DriveFileMeta, parentId: string) {
  if (source.mimeType === FOLDER_MIME) throw new Error('folder copy requires recursion')
  const bytes = await downloadDriveFile(token, source.id)
  return uploadDriveFile(token, {
    name: source.name,
    parentId,
    content: new Blob([bytes], { type: source.mimeType || 'application/octet-stream' }),
    appProperties: source.appProperties,
  })
}

async function copyChildrenRecursive(token: string, sourceParentId: string, targetParentId: string, sourceSpace: 'drive' | 'appDataFolder', skipShared = false) {
  const children = await listAllDriveFiles(token, `'${driveQueryLiteral(sourceParentId)}' in parents and trashed = false`, sourceSpace)
  for (const child of children) {
    if (skipShared && child.appProperties?.owalletFolder === 'shared-wallets') continue
    if (child.appProperties?.owalletType === 'storage-note') continue
    if (child.mimeType === FOLDER_MIME) {
      const folder = await createDriveFolder(token, child.name, targetParentId, child.appProperties)
      await copyChildrenRecursive(token, child.id, folder.id, sourceSpace, skipShared)
    } else {
      await copyFileContent(token, child, targetParentId)
    }
  }
}

async function deletePersonalChildren(token: string, rootId: string, space: 'drive' | 'appDataFolder') {
  const children = await listAllDriveFiles(token, `'${driveQueryLiteral(rootId)}' in parents and trashed = false`, space)
  for (const child of children) {
    if (space === 'drive' && child.appProperties?.owalletFolder === 'shared-wallets') continue
    if (space === 'drive' && child.appProperties?.owalletType === 'storage-note') continue
    await deleteDriveFilePermanently(token, child.id)
  }
}

export async function migrateDriveStorageMode(token: string, targetMode: DriveStorageMode): Promise<DriveLayout> {
  const current = await ensureDriveLayout(token)
  if ((current.storageMode ?? 'visible') === targetMode) return current

  const visibleRoot = await ensureVisibleRoot(token)
  if (targetMode === 'hidden') {
    const oldHidden = await findHiddenRoot(token)
    if (oldHidden) await deleteDriveFilePermanently(token, oldHidden.id)
    const hiddenRoot = await ensureHiddenRoot(token)
    await copyChildrenRecursive(token, current.rootId, hiddenRoot.id, current.space ?? 'drive', true)
    const hiddenLayout = await layoutInsideRoot(token, hiddenRoot.id, 'appDataFolder')
    if (!hiddenLayout.recordsId || !hiddenLayout.imagesId || !hiddenLayout.vaultFileId) {
      await deleteDriveFilePermanently(token, hiddenRoot.id).catch(() => undefined)
      throw new Error('error.driveMigrationFailed')
    }
    await ensureStorageNote(token, visibleRoot.id)
    await updateDriveMetadata(token, visibleRoot.id, { appProperties: { ...(visibleRoot.appProperties ?? {}), owalletRoot: '1', schema: '1', owalletStorageMode: 'hidden' } })
    await deletePersonalChildren(token, current.rootId, current.space ?? 'drive')
    return { ...hiddenLayout, storageMode: 'hidden', visibleRootId: visibleRoot.id, space: 'appDataFolder' }
  }

  await deletePersonalChildren(token, visibleRoot.id, 'drive')
  await copyChildrenRecursive(token, current.rootId, visibleRoot.id, current.space ?? 'appDataFolder')
  const visibleLayout = await layoutInsideRoot(token, visibleRoot.id, 'drive')
  if (!visibleLayout.recordsId || !visibleLayout.imagesId || !visibleLayout.vaultFileId) throw new Error('error.driveMigrationFailed')
  await updateDriveMetadata(token, visibleRoot.id, { appProperties: { ...(visibleRoot.appProperties ?? {}), owalletRoot: '1', schema: '1', owalletStorageMode: 'visible' } })
  const note = await findChildByAppProperty(token, visibleRoot.id, 'owalletType', 'storage-note')
  if (note) await deleteDriveFilePermanently(token, note.id).catch(() => undefined)
  if (current.space === 'appDataFolder') await deleteDriveFilePermanently(token, current.rootId)
  return { ...visibleLayout, storageMode: 'visible', visibleRootId: visibleRoot.id, space: 'drive' }
}

export async function deleteAllDriveWalletData(token: string) {
  const [visibleRoot, hiddenRoot] = await Promise.all([
    findVisibleRoot(token).catch(() => undefined),
    findHiddenRoot(token).catch(() => undefined),
  ])
  if (hiddenRoot) await deleteDriveFilePermanently(token, hiddenRoot.id)
  if (visibleRoot) await deleteDriveFilePermanently(token, visibleRoot.id)
}

export async function downloadDriveFile(token: string, fileId: string, maxBytes?: number) {
  const response = await driveFetch(token, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`)
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (maxBytes && declared > maxBytes) throw new Error('error.driveFileTooLarge')
  const buffer = await response.arrayBuffer()
  if (maxBytes && buffer.byteLength > maxBytes) throw new Error('error.driveFileTooLarge')
  return buffer
}

export async function downloadVaultConfig(token: string, existingLayout?: DriveLayout): Promise<VaultConfig | undefined> {
  const layout = existingLayout ?? await findExistingDriveLayout(token)
  if (!layout?.vaultFileId) return undefined
  const bytes = await downloadDriveFile(token, layout.vaultFileId, SECURITY_LIMITS.maxVaultConfigBytes)
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<VaultConfig>
  if (parsed.schemaVersion !== 1 || typeof parsed.createdAt !== 'string' || parsed.kdf?.name !== 'PBKDF2-SHA256' || typeof parsed.kdf?.iterations !== 'number' || !Number.isInteger(parsed.kdf.iterations) || parsed.kdf.iterations < 100_000 || typeof parsed.kdf?.salt !== 'string' || typeof parsed.passwordWrappedDek?.iv !== 'string' || typeof parsed.passwordWrappedDek?.ciphertext !== 'string' || typeof parsed.recovery?.wrappedDek?.iv !== 'string' || typeof parsed.recovery?.wrappedDek?.ciphertext !== 'string' || !Array.isArray(parsed.recovery?.questions)) throw new Error('error.invalidVaultConfig')
  return parsed as VaultConfig
}

function multipartBody(metadata: Record<string, unknown>, content: Blob) {
  const boundary = `owallet_${crypto.randomUUID().replace(/-/g, '')}`
  const body = new Blob([`--${boundary}\r\n`, 'Content-Type: application/json; charset=UTF-8\r\n\r\n', JSON.stringify(metadata), `\r\n--${boundary}\r\n`, `Content-Type: ${content.type || 'application/octet-stream'}\r\n\r\n`, content, `\r\n--${boundary}--`])
  return { boundary, body }
}

export async function uploadDriveFile(token: string, options: { id?: string; name: string; parentId?: string; content: Blob; appProperties?: Record<string, string> }) {
  const metadata: Record<string, unknown> = { name: options.name, appProperties: options.appProperties }
  if (!options.id && options.parentId) metadata.parents = [options.parentId]
  const { boundary, body } = multipartBody(metadata, options.content)
  const path = options.id ? `/files/${encodeURIComponent(options.id)}` : '/files'
  return driveJson<DriveFileMeta>(token, `${DRIVE_UPLOAD}${path}?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size,appProperties`, { method: options.id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })
}

export async function uploadVaultConfig(token: string, config: VaultConfig, existingLayout?: DriveLayout) {
  const layout = existingLayout ?? await ensureDriveLayout(token)
  const file = await uploadDriveFile(token, { id: layout.vaultFileId, name: VAULT_FILE_NAME, parentId: layout.rootId, content: new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }), appProperties: { owalletType: 'vault-config', schema: '1' } })
  return { ...layout, vaultFileId: file.id }
}

export async function trashDriveFile(token: string, fileId: string) {
  await driveJson(token, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,trashed`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) })
}

export async function deleteDriveFilePermanently(token: string, fileId: string) {
  const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}`
  let response: Response | undefined
  for (let attempt = 0; attempt < DRIVE_RETRY_ATTEMPTS; attempt += 1) {
    response = await fetch(url, {
      method: 'DELETE',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: authHeaders(token),
    })
    if (response.ok || response.status === 404) return
    if (attempt >= DRIVE_RETRY_ATTEMPTS - 1 || !(await retryableDriveResponse(response))) break
    await retryDelay(response, attempt)
  }
  throw new Error(`Google Drive API ${response?.status ?? 'delete failed'}`)
}

export function openDriveFolderUrl(folderId: string) { return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}` }
export async function getDriveFileMeta(token: string, fileId: string) { return driveJson<DriveFileMeta>(token, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${qs({ fields: 'id,name,mimeType,modifiedTime,size,appProperties,trashed' })}`) }
export async function listDriveChildren(token: string, parentId: string) { return listAllDriveFiles(token, `'${driveQueryLiteral(parentId)}' in parents and trashed = false`) }

export interface DrivePermission { id: string; type?: string; role?: string; emailAddress?: string; displayName?: string }

export async function createDrivePermission(token: string, fileId: string, email: string, role: 'reader' | 'writer', options?: { sendNotificationEmail?: boolean; emailMessage?: string; expirationTime?: string }) {
  const query = qs({ sendNotificationEmail: String(options?.sendNotificationEmail ?? true), emailMessage: options?.emailMessage, fields: 'id,type,role,emailAddress,displayName' })
  return driveJson<DrivePermission>(token, `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions?${query}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'user', role, emailAddress: email }),
  })
}

export async function deleteDrivePermission(token: string, fileId: string, permissionId: string) {
  const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`, { method: 'DELETE', cache: 'no-store', referrerPolicy: 'no-referrer', headers: authHeaders(token) })
  if (!response.ok && response.status !== 404) throw new Error(`Google Drive API ${response.status}`)
}

export async function findDriveChildByAppProperty(token: string, parentId: string, key: string, value: string, mimeType?: string) { return findChildByAppProperty(token, parentId, key, value, mimeType) }
export async function createAnyoneReaderPermission(token: string, fileId: string) {
  return driveJson<DrivePermission>(token, `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions?${qs({ fields: 'id,type,role' })}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }) })
}
export function googleApiKeyConfigured() { return Boolean((import.meta.env.VITE_GOOGLE_API_KEY ?? '').trim()) }
export async function downloadPublicDriveFile(fileId: string, maxBytes?: number) {
  const apiKey = (import.meta.env.VITE_GOOGLE_API_KEY ?? '').trim()
  if (!apiKey) throw new Error('error.sharedApiKeyMissing')
  const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&key=${encodeURIComponent(apiKey)}`, { cache: 'no-store', referrerPolicy: 'no-referrer' })
  if (!response.ok) throw new Error(`Google Drive public API ${response.status}`)
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (maxBytes && declared > maxBytes) throw new Error('error.driveFileTooLarge')
  const buffer = await response.arrayBuffer()
  if (maxBytes && buffer.byteLength > maxBytes) throw new Error('error.driveFileTooLarge')
  return buffer
}
