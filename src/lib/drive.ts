import {
  DRIVE_ROOT_NAME,
  IMAGES_FOLDER_NAME,
  RECORDS_FOLDER_NAME,
  VAULT_FILE_NAME,
} from '../constants'
import type { DriveLayout, VaultConfig } from '../types'
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

async function driveJson<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: authHeaders(token, init?.headers),
  })
  if (!response.ok) throw new Error(`Google Drive API ${response.status}`)
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

export async function listDriveChanges(token: string, pageToken: string): Promise<{ changes: DriveChange[]; nextPageToken?: string; newStartPageToken?: string }> {
  return driveJson(token, `${DRIVE_API}/changes?${qs({
    pageToken,
    spaces: 'drive',
    pageSize: '1000',
    includeRemoved: 'true',
    fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,modifiedTime,size,appProperties,trashed))',
  })}`)
}

export async function listAllDriveChanges(token: string, startToken: string) {
  const changes: DriveChange[] = []
  let pageToken = startToken
  let newStartPageToken: string | undefined
  do {
    const page = await listDriveChanges(token, pageToken)
    changes.push(...page.changes)
    if (page.nextPageToken) pageToken = page.nextPageToken
    else { newStartPageToken = page.newStartPageToken; break }
  } while (true)
  return { changes, newStartPageToken }
}

export async function listDriveFiles(token: string, query: string, pageToken?: string): Promise<{ files: DriveFileMeta[]; nextPageToken?: string }> {
  return driveJson(token, `${DRIVE_API}/files?${qs({ q: query, spaces: 'drive', pageSize: '1000', pageToken, fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,appProperties)' })}`)
}

export async function listAllDriveFiles(token: string, query: string) {
  const result: DriveFileMeta[] = []
  let pageToken: string | undefined
  do {
    const page = await listDriveFiles(token, query, pageToken)
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

async function findChild(token: string, parentId: string, name: string, mimeType?: string) {
  const query = [`'${driveQueryLiteral(parentId)}' in parents`, `name = '${driveQueryLiteral(name)}'`, 'trashed = false', mimeType ? `mimeType = '${mimeType}'` : undefined].filter(Boolean).join(' and ')
  return (await listAllDriveFiles(token, query))[0]
}

async function findChildByAppProperty(token: string, parentId: string, key: string, value: string, mimeType?: string) {
  const query = [`'${driveQueryLiteral(parentId)}' in parents`, 'trashed = false', `appProperties has { key='${driveQueryLiteral(key)}' and value='${driveQueryLiteral(value)}' }`, mimeType ? `mimeType = '${mimeType}'` : undefined].filter(Boolean).join(' and ')
  return (await listAllDriveFiles(token, query))[0]
}

export async function findExistingDriveLayout(token: string): Promise<DriveLayout | undefined> {
  const roots = await listAllDriveFiles(token, `mimeType = '${FOLDER_MIME}' and trashed = false and appProperties has { key='owalletRoot' and value='1' }`)
  const root = roots[0]
  if (!root) return undefined
  const [recordsByTag, imagesByTag, vaultByTag] = await Promise.all([
    findChildByAppProperty(token, root.id, 'owalletFolder', 'records', FOLDER_MIME),
    findChildByAppProperty(token, root.id, 'owalletFolder', 'images', FOLDER_MIME),
    findChildByAppProperty(token, root.id, 'owalletType', 'vault-config'),
  ])
  const [records, images, vault] = await Promise.all([
    recordsByTag ? Promise.resolve(recordsByTag) : findChild(token, root.id, RECORDS_FOLDER_NAME, FOLDER_MIME),
    imagesByTag ? Promise.resolve(imagesByTag) : findChild(token, root.id, IMAGES_FOLDER_NAME, FOLDER_MIME),
    vaultByTag ? Promise.resolve(vaultByTag) : findChild(token, root.id, VAULT_FILE_NAME),
  ])
  return { rootId: root.id, recordsId: records?.id ?? '', imagesId: images?.id ?? '', vaultFileId: vault?.id }
}

export async function ensureDriveLayout(token: string): Promise<DriveLayout> {
  let layout = await findExistingDriveLayout(token)
  if (!layout) {
    const root = await createDriveFolder(token, DRIVE_ROOT_NAME, undefined, { owalletRoot: '1', schema: '1' })
    layout = { rootId: root.id, recordsId: '', imagesId: '' }
  }
  if (!layout.recordsId) layout.recordsId = (await createDriveFolder(token, RECORDS_FOLDER_NAME, layout.rootId, { owalletFolder: 'records' })).id
  if (!layout.imagesId) layout.imagesId = (await createDriveFolder(token, IMAGES_FOLDER_NAME, layout.rootId, { owalletFolder: 'images' })).id
  if (!layout.vaultFileId) layout.vaultFileId = (await findChild(token, layout.rootId, VAULT_FILE_NAME))?.id
  return layout
}

export async function downloadDriveFile(token: string, fileId: string, maxBytes?: number) {
  const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, { headers: authHeaders(token), cache: 'no-store', referrerPolicy: 'no-referrer' })
  if (!response.ok) throw new Error(`Google Drive API ${response.status}`)
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
