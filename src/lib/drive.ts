import {
  DRIVE_ROOT_NAME,
  IMAGES_FOLDER_NAME,
  RECORDS_FOLDER_NAME,
  VAULT_FILE_NAME,
} from '../constants'
import type { DriveLayout, VaultConfig } from '../types'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export interface DriveFileMeta {
  id: string
  name: string
  mimeType?: string
  modifiedTime?: string
  size?: string
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
    headers: authHeaders(token, init?.headers),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Google Drive API ${response.status}: ${text || response.statusText}`)
  }
  return response.json() as Promise<T>
}

function qs(params: Record<string, string | undefined>) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) search.set(key, value)
  })
  return search.toString()
}

export async function listDriveFiles(
  token: string,
  query: string,
  pageToken?: string,
): Promise<{ files: DriveFileMeta[]; nextPageToken?: string }> {
  return driveJson(token, `${DRIVE_API}/files?${qs({
    q: query,
    spaces: 'drive',
    pageSize: '1000',
    pageToken,
    fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,appProperties)',
  })}`)
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

async function createFolder(
  token: string,
  name: string,
  parentId?: string,
  appProperties?: Record<string, string>,
) {
  return driveJson<DriveFileMeta>(token, `${DRIVE_API}/files?fields=id,name,mimeType,appProperties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      parents: parentId ? [parentId] : undefined,
      appProperties,
    }),
  })
}

async function findChild(token: string, parentId: string, name: string, mimeType?: string) {
  const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const query = [
    `'${parentId}' in parents`,
    `name = '${escapedName}'`,
    'trashed = false',
    mimeType ? `mimeType = '${mimeType}'` : undefined,
  ].filter(Boolean).join(' and ')
  return (await listAllDriveFiles(token, query))[0]
}

async function findChildByAppProperty(
  token: string,
  parentId: string,
  key: string,
  value: string,
  mimeType?: string,
) {
  const query = [
    `'${parentId}' in parents`,
    'trashed = false',
    `appProperties has { key='${key}' and value='${value}' }`,
    mimeType ? `mimeType = '${mimeType}'` : undefined,
  ].filter(Boolean).join(' and ')
  return (await listAllDriveFiles(token, query))[0]
}

export async function findExistingDriveLayout(token: string): Promise<DriveLayout | undefined> {
  const roots = await listAllDriveFiles(
    token,
    `mimeType = '${FOLDER_MIME}' and trashed = false and appProperties has { key='owalletRoot' and value='1' }`,
  )
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

  return {
    rootId: root.id,
    recordsId: records?.id ?? '',
    imagesId: images?.id ?? '',
    vaultFileId: vault?.id,
  }
}

export async function ensureDriveLayout(token: string): Promise<DriveLayout> {
  let layout = await findExistingDriveLayout(token)
  if (!layout) {
    const root = await createFolder(token, DRIVE_ROOT_NAME, undefined, {
      owalletRoot: '1',
      schema: '1',
    })
    layout = { rootId: root.id, recordsId: '', imagesId: '' }
  }

  if (!layout.recordsId) {
    layout.recordsId = (await createFolder(token, RECORDS_FOLDER_NAME, layout.rootId, { owalletFolder: 'records' })).id
  }
  if (!layout.imagesId) {
    layout.imagesId = (await createFolder(token, IMAGES_FOLDER_NAME, layout.rootId, { owalletFolder: 'images' })).id
  }
  if (!layout.vaultFileId) {
    const vault = await findChild(token, layout.rootId, VAULT_FILE_NAME)
    layout.vaultFileId = vault?.id
  }
  return layout
}

export async function downloadDriveFile(token: string, fileId: string) {
  const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: authHeaders(token),
  })
  if (!response.ok) throw new Error('error.driveDownload')
  return response.arrayBuffer()
}

export async function downloadVaultConfig(token: string): Promise<VaultConfig | undefined> {
  const layout = await findExistingDriveLayout(token)
  if (!layout?.vaultFileId) return undefined
  const bytes = await downloadDriveFile(token, layout.vaultFileId)
  return JSON.parse(new TextDecoder().decode(bytes)) as VaultConfig
}

function multipartBody(metadata: Record<string, unknown>, content: Blob) {
  const boundary = `owallet_${crypto.randomUUID().replace(/-/g, '')}`
  const body = new Blob([
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\n`,
    `Content-Type: ${content.type || 'application/octet-stream'}\r\n\r\n`,
    content,
    `\r\n--${boundary}--`,
  ])
  return { boundary, body }
}

export async function uploadDriveFile(
  token: string,
  options: {
    id?: string
    name: string
    parentId?: string
    content: Blob
    appProperties?: Record<string, string>
  },
) {
  const metadata: Record<string, unknown> = {
    name: options.name,
    appProperties: options.appProperties,
  }
  if (!options.id && options.parentId) metadata.parents = [options.parentId]

  const { boundary, body } = multipartBody(metadata, options.content)
  const path = options.id ? `/files/${encodeURIComponent(options.id)}` : '/files'
  const method = options.id ? 'PATCH' : 'POST'
  return driveJson<DriveFileMeta>(
    token,
    `${DRIVE_UPLOAD}${path}?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size,appProperties`,
    {
      method,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  )
}

export async function uploadVaultConfig(token: string, config: VaultConfig) {
  const layout = await ensureDriveLayout(token)
  const file = await uploadDriveFile(token, {
    id: layout.vaultFileId,
    name: VAULT_FILE_NAME,
    parentId: layout.rootId,
    content: new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }),
    appProperties: { owalletType: 'vault-config', schema: '1' },
  })
  return { ...layout, vaultFileId: file.id }
}

export async function trashDriveFile(token: string, fileId: string) {
  await driveJson(token, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,trashed`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
}

export function openDriveFolderUrl(folderId: string) {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`
}
