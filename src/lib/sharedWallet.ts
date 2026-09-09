import type {
  GoogleUser,
  SharedMemberFeed,
  SharedMemberProfile,
  SharedTransaction,
  SharedWalletControl,
  SharedWalletMember,
  SharedWalletMembership,
  SharedWalletRole,
  SharedWalletArchive,
} from '../types'
import {
  base64UrlToBytes,
  bytesToBase64Url,
  decryptJson,
  encryptJson,
  packEncryptedPayload,
  randomBytes,
  unpackEncryptedPayload,
} from './crypto'
import {
  createAnyoneReaderPermission,
  createDriveFolder,
  createDrivePermission,
  downloadDriveFile,
  downloadPublicDriveFile,
  ensureDriveLayout,
  findDriveChildByAppProperty,
  uploadDriveFile,
  trashDriveFile,
} from './drive'
import { authorizeSpecificDriveFile } from './googlePicker'
import { defaultSharedLedger } from './sharedLedger'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const MAX_CONTROL_BYTES = 2 * 1024 * 1024
const MAX_FEED_BYTES = 16 * 1024 * 1024
const MAX_REGISTRATION_BYTES = 64 * 1024
const MAX_SNAPSHOT_BYTES = 24 * 1024 * 1024
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000
const SHARED_DELETE_GRACE_MS = 90 * 24 * 60 * 60 * 1000
const MAX_SHARED_MEMBERS = 500
const MAX_SHARED_TRANSACTIONS_PER_FEED = 50_000
const MAX_SHARED_TEXT = 4_096
const MAX_SHARED_TAGS = 64
const MAX_SHARED_TAG_LENGTH = 120

interface ControlWrapper {
  schemaVersion: 1
  groupId: string
  keyVersion: number
  envelopes: Record<string, string>
  payload: string
}

interface FeedWrapper {
  schemaVersion: 1
  groupId: string
  memberId: string
  keyVersion: number
  payload: string
}

interface KeyRingEnvelope {
  currentVersion: number
  keys: Record<string, string>
}

interface RegistrationPayload {
  schemaVersion: 1
  groupId: string
  groupName: string
  controlFileId: string
  memberId: string
  role: Exclude<SharedWalletRole, 'owner'>
  invitedEmail: string
  /** Initial/current group key ring. Kept only inside the invitee-only registration file. */
  keyRing: KeyRingEnvelope
  expiresAt: string
  feedFileId?: string
  profile?: SharedMemberProfile
  joinedAt?: string
}

interface InvitePayload {
  schemaVersion: 1
  groupId: string
  groupName: string
  controlFileId: string
  memberId: string
  role: Exclude<SharedWalletRole, 'owner'>
  invitedEmail: string
  registrationFileId: string
  /** Bearer secret that decrypts the invitee-only registration file. */
  transportKey: string
  expiresAt: string
}

export interface SharedWalletLoaded {
  control: SharedWalletControl
  transactions: SharedTransaction[]
  profiles: Record<string, SharedMemberProfile>
  snapshotCount: number
  membership: SharedWalletMembership
  fromSnapshot?: boolean
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function importAes(rawBase64: string) {
  const raw = base64UrlToBytes(rawBase64)
  if (raw.length !== 32) throw new Error('error.sharedInvalidKey')
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

function payloadToText(payload: ReturnType<typeof unpackEncryptedPayload>) {
  return bytesToBase64Url(new Uint8Array(packEncryptedPayload(payload)))
}

function payloadFromText(text: string) {
  return unpackEncryptedPayload(toArrayBuffer(base64UrlToBytes(text)))
}

function keyRingOf(membership: SharedWalletMembership) {
  return {
    ...(membership.groupKeyHistory ?? {}),
    [String(membership.keyVersion)]: membership.groupKey,
  }
}

function cleanSharedText(value: unknown, max = MAX_SHARED_TEXT) {
  if (typeof value !== 'string') return undefined
  const clean = value.trim()
  return clean ? clean.slice(0, max) : undefined
}

function validIso(value: unknown) {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value))
}

function sanitizeSharedTransaction(value: unknown, groupId: string, memberId: string): SharedTransaction | undefined {
  if (!value || typeof value !== 'object') return undefined
  const tx = value as Partial<SharedTransaction>
  if (typeof tx.id !== 'string' || !tx.id || tx.id.length > 160) return undefined
  if (tx.groupId !== groupId || tx.createdByMemberId !== memberId) return undefined
  if (tx.type !== 'expense' && tx.type !== 'income' && tx.type !== 'transfer') return undefined
  if (typeof tx.amount !== 'number' || !Number.isFinite(tx.amount) || tx.amount <= 0 || tx.amount > 1e18) return undefined
  if (!validIso(tx.occurredAt) || !validIso(tx.createdAt) || !validIso(tx.updatedAt) || typeof tx.deleted !== 'boolean') return undefined
  const currency = cleanSharedText(tx.currency, 12)
  if (!currency) return undefined
  const tags = Array.isArray(tx.tags)
    ? tx.tags.slice(0, MAX_SHARED_TAGS).map((tag) => cleanSharedText(tag, MAX_SHARED_TAG_LENGTH)).filter((tag): tag is string => Boolean(tag))
    : undefined
  return {
    id: tx.id,
    groupId,
    type: tx.type,
    amount: tx.amount,
    currency,
    occurredAt: tx.occurredAt as string,
    accountId: cleanSharedText(tx.accountId, 160),
    destinationAccountId: cleanSharedText(tx.destinationAccountId, 160),
    categoryId: cleanSharedText(tx.categoryId, 160),
    category: cleanSharedText(tx.category, 512),
    merchant: cleanSharedText(tx.merchant),
    description: cleanSharedText(tx.description),
    note: cleanSharedText(tx.note, 16_384),
    tags,
    createdByMemberId: memberId,
    sourceCreatedByMemberId: cleanSharedText(tx.sourceCreatedByMemberId, 160),
    sourceCreatedByName: cleanSharedText(tx.sourceCreatedByName, 320),
    createdAt: tx.createdAt as string,
    updatedAt: tx.updatedAt as string,
    deleted: tx.deleted,
  }
}

function validSharedControl(control: SharedWalletControl, groupId: string) {
  if (control.schemaVersion !== 1 || control.groupId !== groupId || !cleanSharedText(control.name, 120)) return false
  if (!validIso(control.createdAt) || !validIso(control.updatedAt) || !Number.isInteger(control.keyVersion) || control.keyVersion < 1) return false
  if (!Array.isArray(control.members) || control.members.length < 1 || control.members.length > MAX_SHARED_MEMBERS) return false
  if (typeof control.ownerMemberId !== 'string' || !control.ownerMemberId) return false
  if (control.lifecycle) {
    if (!['active', 'closing', 'deleted'].includes(control.lifecycle.state)) return false
    if (control.lifecycle.requestedAt !== undefined && !validIso(control.lifecycle.requestedAt)) return false
    if (control.lifecycle.purgeAfter !== undefined && !validIso(control.lifecycle.purgeAfter)) return false
    if (control.lifecycle.deletedAt !== undefined && !validIso(control.lifecycle.deletedAt)) return false
    if (control.lifecycle.finalSnapshotFileId !== undefined && (typeof control.lifecycle.finalSnapshotFileId !== 'string' || control.lifecycle.finalSnapshotFileId.length > 512)) return false
  }
  if (control.ledger) {
    if (typeof control.ledger.defaultCurrency !== 'string' || !control.ledger.defaultCurrency || control.ledger.defaultCurrency.length > 12) return false
    if (!Array.isArray(control.ledger.accounts) || !Array.isArray(control.ledger.categories) || !Array.isArray(control.ledger.budgets) || !Array.isArray(control.ledger.accountCatalogues) || !Array.isArray(control.ledger.transactionRules)) return false
  }
  const ids = new Set<string>()
  let ownerCount = 0
  for (const member of control.members) {
    if (!member || typeof member.id !== 'string' || !member.id || member.id.length > 160 || ids.has(member.id)) return false
    ids.add(member.id)
    if (typeof member.email !== 'string' || member.email.length > 320 || !member.email.includes('@')) return false
    if (!['owner', 'member', 'viewer'].includes(member.role) || !['invited', 'active', 'removed'].includes(member.status)) return false
    if (!validIso(member.invitedAt) || (member.joinedAt !== undefined && !validIso(member.joinedAt))) return false
    if (member.id === control.ownerMemberId) {
      if (member.role !== 'owner' || member.status !== 'active') return false
      ownerCount += 1
    } else if (member.role === 'owner') return false
  }
  return ownerCount === 1
}

function membershipWithRing(membership: SharedWalletMembership, ring: KeyRingEnvelope) {
  const currentKey = ring.keys[String(ring.currentVersion)]
  if (!currentKey) throw new Error('error.sharedInvalidKey')
  const history = { ...ring.keys }
  delete history[String(ring.currentVersion)]
  return {
    ...membership,
    groupKey: currentKey,
    keyVersion: ring.currentVersion,
    groupKeyHistory: history,
  }
}

async function encryptForTransport(transportKey: string, value: KeyRingEnvelope, context: string) {
  return payloadToText(await encryptJson(await importAes(transportKey), value, context))
}

async function decryptTransport<T>(transportKey: string, text: string, context: string) {
  return decryptJson<T>(await importAes(transportKey), payloadFromText(text), context)
}

async function ensureSharedLocalRoot(token: string, groupId: string, name: string) {
  const layout = await ensureDriveLayout(token)
  let sharedRoot = await findDriveChildByAppProperty(token, layout.rootId, 'owalletFolder', 'shared-wallets', 'application/vnd.google-apps.folder')
  if (!sharedRoot) sharedRoot = await createDriveFolder(token, 'shared-wallets', layout.rootId, { owalletFolder: 'shared-wallets' })
  let groupRoot = await findDriveChildByAppProperty(token, sharedRoot.id, 'owalletSharedLocalGroup', groupId, 'application/vnd.google-apps.folder')
  if (!groupRoot) groupRoot = await createDriveFolder(token, name.slice(0, 120), sharedRoot.id, { owalletSharedLocalGroup: groupId })
  return groupRoot
}

function profileFor(user: GoogleUser, groupId: string, memberId: string): SharedMemberProfile {
  return {
    groupId,
    memberId,
    googleSub: user.sub,
    email: user.email,
    name: user.name || user.email,
    updatedAt: new Date().toISOString(),
  }
}

async function encodeFeed(feed: SharedMemberFeed, key: string) {
  const payload = await encryptJson(await importAes(key), feed, `shared-feed:${feed.groupId}:${feed.memberId}:v${feed.keyVersion}`)
  const wrapper: FeedWrapper = {
    schemaVersion: 1,
    groupId: feed.groupId,
    memberId: feed.memberId,
    keyVersion: feed.keyVersion,
    payload: payloadToText(payload),
  }
  return JSON.stringify(wrapper)
}

async function decodeFeed(bytes: ArrayBuffer, membership: SharedWalletMembership) {
  let wrapper: FeedWrapper
  try { wrapper = JSON.parse(decoder.decode(bytes)) as FeedWrapper } catch { throw new Error('error.sharedInvalidFeed') }
  if (wrapper.schemaVersion !== 1 || wrapper.groupId !== membership.groupId || !wrapper.memberId || !wrapper.payload) throw new Error('error.sharedInvalidFeed')
  const key = keyRingOf(membership)[String(wrapper.keyVersion)]
  if (!key) throw new Error('error.sharedMissingHistoricalKey')
  const feed = await decryptJson<SharedMemberFeed>(await importAes(key), payloadFromText(wrapper.payload), `shared-feed:${wrapper.groupId}:${wrapper.memberId}:v${wrapper.keyVersion}`)
  if (
    feed.schemaVersion !== 1
    || feed.groupId !== wrapper.groupId
    || feed.memberId !== wrapper.memberId
    || !Number.isInteger(feed.revision)
    || feed.revision < 1
    || !Number.isInteger(feed.keyVersion)
    || feed.keyVersion !== wrapper.keyVersion
    || feed.keyVersion < 1
    || !validIso(feed.updatedAt)
    || !Array.isArray(feed.transactions)
    || feed.transactions.length > MAX_SHARED_TRANSACTIONS_PER_FEED
    || !feed.profile
    || feed.profile.groupId !== wrapper.groupId
    || feed.profile.memberId !== wrapper.memberId
    || typeof feed.profile.email !== 'string'
    || feed.profile.email.length > 320
    || typeof feed.profile.googleSub !== 'string'
    || feed.profile.googleSub.length > 256
    || !validIso(feed.profile.updatedAt)
  ) throw new Error('error.sharedInvalidFeed')
  const transactions = feed.transactions
    .map((tx) => sanitizeSharedTransaction(tx, wrapper.groupId, wrapper.memberId))
    .filter((tx): tx is SharedTransaction => Boolean(tx))
  return { ...feed, transactions }
}

async function writeOwnFeed(token: string, membership: SharedWalletMembership, feed: SharedMemberFeed) {
  const text = await encodeFeed(feed, membership.groupKey)
  await uploadDriveFile(token, {
    id: membership.feedFileId,
    name: 'feed.owf',
    parentId: membership.localRootId,
    content: new Blob([text], { type: 'application/json' }),
    appProperties: {
      owalletSharedType: 'member-feed',
      groupId: membership.groupId,
      memberId: membership.memberId,
      keyVersion: String(membership.keyVersion),
      updatedAt: feed.updatedAt,
    },
  })
}

async function createOwnFeed(token: string, membershipBase: Omit<SharedWalletMembership, 'feedFileId'>, user: GoogleUser) {
  const now = new Date().toISOString()
  const feed: SharedMemberFeed = {
    schemaVersion: 1,
    groupId: membershipBase.groupId,
    memberId: membershipBase.memberId,
    revision: 1,
    keyVersion: membershipBase.keyVersion,
    profile: profileFor(user, membershipBase.groupId, membershipBase.memberId),
    transactions: [],
    updatedAt: now,
  }
  const text = await encodeFeed(feed, membershipBase.groupKey)
  const file = await uploadDriveFile(token, {
    name: 'feed.owf',
    parentId: membershipBase.localRootId,
    content: new Blob([text], { type: 'application/json' }),
    appProperties: {
      owalletSharedType: 'member-feed',
      groupId: membershipBase.groupId,
      memberId: membershipBase.memberId,
      keyVersion: String(membershipBase.keyVersion),
      updatedAt: now,
    },
  })
  await createAnyoneReaderPermission(token, file.id)
  return { fileId: file.id, feed }
}

async function buildControlWrapper(
  control: SharedWalletControl,
  membership: SharedWalletMembership,
  ownerSecrets: Record<string, string>,
) {
  const ring: KeyRingEnvelope = { currentVersion: membership.keyVersion, keys: keyRingOf(membership) }
  const envelopes: Record<string, string> = {}
  for (const member of control.members) {
    if (member.status !== 'active') continue
    const secret = member.id === membership.memberId ? membership.transportKey : ownerSecrets[member.id]
    if (!secret) continue
    envelopes[member.id] = await encryptForTransport(secret, ring, `shared-keyring:${control.groupId}:${member.id}:v${membership.keyVersion}`)
  }
  const payload = await encryptJson(await importAes(membership.groupKey), control, `shared-control:${control.groupId}:v${membership.keyVersion}`)
  return JSON.stringify({
    schemaVersion: 1,
    groupId: control.groupId,
    keyVersion: membership.keyVersion,
    envelopes,
    payload: payloadToText(payload),
  } satisfies ControlWrapper)
}

async function writeControl(token: string, membership: SharedWalletMembership, control: SharedWalletControl, ownerSecrets: Record<string, string>) {
  const text = await buildControlWrapper(control, membership, ownerSecrets)
  const file = await uploadDriveFile(token, {
    id: membership.controlFileId || undefined,
    name: 'control.owg',
    parentId: membership.localRootId,
    content: new Blob([text], { type: 'application/json' }),
    appProperties: {
      owalletSharedType: 'control',
      groupId: control.groupId,
      keyVersion: String(membership.keyVersion),
      updatedAt: control.updatedAt,
    },
  })
  return file.id
}

async function readControlPublic(membership: SharedWalletMembership) {
  const bytes = await downloadPublicDriveFile(membership.controlFileId, MAX_CONTROL_BYTES)
  let wrapper: ControlWrapper
  try { wrapper = JSON.parse(decoder.decode(bytes)) as ControlWrapper } catch { throw new Error('error.sharedInvalidControl') }
  if (wrapper.schemaVersion !== 1 || wrapper.groupId !== membership.groupId || !wrapper.payload || !wrapper.envelopes) throw new Error('error.sharedInvalidControl')

  let updatedMembership = membership
  const currentRing = keyRingOf(membership)
  if (!currentRing[String(wrapper.keyVersion)]) {
    const envelope = wrapper.envelopes[membership.memberId]
    if (!envelope) throw new Error('error.sharedAccessRemoved')
    const ring = await decryptTransport<KeyRingEnvelope>(membership.transportKey, envelope, `shared-keyring:${membership.groupId}:${membership.memberId}:v${wrapper.keyVersion}`)
    updatedMembership = membershipWithRing(membership, ring)
  }
  const key = keyRingOf(updatedMembership)[String(wrapper.keyVersion)]
  if (!key) throw new Error('error.sharedInvalidKey')
  const control = await decryptJson<SharedWalletControl>(await importAes(key), payloadFromText(wrapper.payload), `shared-control:${membership.groupId}:v${wrapper.keyVersion}`)
  if (!validSharedControl(control, membership.groupId) || control.keyVersion !== wrapper.keyVersion) throw new Error('error.sharedInvalidControl')
  return { control, membership: updatedMembership }
}

async function encodeRegistration(secret: string, value: RegistrationPayload) {
  return new Blob([packEncryptedPayload(await encryptJson(await importAes(secret), value, `shared-registration:${value.groupId}:${value.memberId}`)) as BlobPart], { type: 'application/octet-stream' })
}

async function decodeRegistration(secret: string, bytes: ArrayBuffer, groupId: string, memberId: string) {
  const value = await decryptJson<RegistrationPayload>(await importAes(secret), unpackEncryptedPayload(bytes), `shared-registration:${groupId}:${memberId}`)
  if (
    value.schemaVersion !== 1
    || value.groupId !== groupId
    || value.memberId !== memberId
    || typeof value.groupName !== 'string'
    || !value.groupName
    || typeof value.controlFileId !== 'string'
    || !value.controlFileId
    || !['member', 'viewer'].includes(value.role)
    || typeof value.invitedEmail !== 'string'
    || !value.invitedEmail
    || typeof value.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(value.expiresAt))
    || !value.keyRing
    || !Number.isInteger(value.keyRing.currentVersion)
    || value.keyRing.currentVersion < 1
    || typeof value.keyRing.keys !== 'object'
    || !value.keyRing.keys[String(value.keyRing.currentVersion)]
  ) throw new Error('error.sharedInvalidInvite')
  return value
}

function encodeInvite(payload: InvitePayload) {
  return bytesToBase64Url(encoder.encode(JSON.stringify(payload)))
}

export function readSharedInviteFromUrl(): InvitePayload | undefined {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const raw = fragment.get('invite')
  if (!raw || raw.length > 8_192) return undefined
  try {
    const value = JSON.parse(decoder.decode(base64UrlToBytes(raw))) as InvitePayload
    if (
      value.schemaVersion !== 1
      || typeof value.groupId !== 'string' || !value.groupId || value.groupId.length > 160
      || typeof value.groupName !== 'string' || !value.groupName || value.groupName.length > 120
      || typeof value.controlFileId !== 'string' || !value.controlFileId || value.controlFileId.length > 512
      || typeof value.memberId !== 'string' || !value.memberId || value.memberId.length > 160
      || (value.role !== 'member' && value.role !== 'viewer')
      || typeof value.invitedEmail !== 'string' || value.invitedEmail.length > 320 || !value.invitedEmail.includes('@')
      || typeof value.registrationFileId !== 'string' || !value.registrationFileId || value.registrationFileId.length > 512
      || typeof value.transportKey !== 'string' || base64UrlToBytes(value.transportKey).length !== 32
      || !validIso(value.expiresAt)
    ) return undefined
    return value
  } catch { return undefined }
}

function inviteUrl(payload: InvitePayload) {
  const url = new URL(window.location.href)
  url.searchParams.set('page', 'shared')
  url.searchParams.delete('group')
  url.searchParams.delete('action')
  url.hash = `invite=${encodeURIComponent(encodeInvite(payload))}`
  return url.href
}

export async function createSharedWallet(token: string, user: GoogleUser, name: string) {
  const cleanName = name.trim().slice(0, 120)
  if (!cleanName) throw new Error('error.sharedNameRequired')
  const groupId = crypto.randomUUID()
  const memberId = crypto.randomUUID()
  const groupKey = bytesToBase64Url(randomBytes(32))
  const transportKey = bytesToBase64Url(randomBytes(32))
  const keyVersion = 1
  const now = new Date().toISOString()
  const localRoot = await ensureSharedLocalRoot(token, groupId, cleanName)
  const base: Omit<SharedWalletMembership, 'feedFileId' | 'controlFileId'> = {
    groupId,
    name: cleanName,
    memberId,
    role: 'owner',
    groupKey,
    keyVersion,
    groupKeyHistory: {},
    transportKey,
    localRootId: localRoot.id,
    joinedAt: now,
  }
  const feed = await createOwnFeed(token, { ...base, controlFileId: '' }, user)
  const owner: SharedWalletMember = {
    id: memberId,
    email: user.email,
    role: 'owner',
    status: 'active',
    invitedAt: now,
    joinedAt: now,
    canonicalName: user.name || user.email,
    googleSub: user.sub,
    feedFileId: feed.fileId,
  }
  const control: SharedWalletControl = {
    schemaVersion: 1,
    groupId,
    name: cleanName,
    ownerMemberId: memberId,
    keyVersion,
    createdAt: now,
    updatedAt: now,
    members: [owner],
    lifecycle: { state: 'active' },
    ledger: defaultSharedLedger('VND'),
  }
  const provisional: SharedWalletMembership = { ...base, controlFileId: '', feedFileId: feed.fileId }
  const ownerSecrets = { [memberId]: transportKey }
  const controlFileId = await writeControl(token, provisional, control, ownerSecrets)
  await createAnyoneReaderPermission(token, controlFileId)
  return {
    membership: { ...provisional, controlFileId },
    control,
    ownerSecrets,
  }
}

export async function reopenSharedWalletFromArchive(
  token: string,
  user: GoogleUser,
  archive: SharedWalletArchive,
) {
  const created = await createSharedWallet(token, user, archive.name)
  created.control.ledger = archive.ledger
  created.control.updatedAt = new Date().toISOString()
  await writeControl(token, created.membership, created.control, created.ownerSecrets)

  const feed = await loadOwnFeed(token, created.membership)
  const now = new Date().toISOString()
  const restored = archive.transactions
    .filter((tx) => !tx.deleted)
    .slice(0, MAX_SHARED_TRANSACTIONS_PER_FEED)
    .map((tx) => ({
      ...tx,
      id: crypto.randomUUID(),
      groupId: created.membership.groupId,
      createdByMemberId: created.membership.memberId,
      sourceCreatedByMemberId: tx.sourceCreatedByMemberId ?? tx.createdByMemberId,
      sourceCreatedByName: tx.sourceCreatedByName ?? archive.memberNames[tx.createdByMemberId],
      createdAt: tx.createdAt,
      updatedAt: now,
      deleted: false,
    }))
  feed.transactions = restored
  feed.revision += 1
  feed.updatedAt = now
  await writeOwnFeed(token, created.membership, feed)
  return { ...created, transactions: restored }
}

async function writeFinalSnapshot(
  token: string,
  membership: SharedWalletMembership,
  control: SharedWalletControl,
  transactions: SharedTransaction[],
) {
  const payload = await encryptJson(await importAes(membership.groupKey), {
    schemaVersion: 1,
    groupId: membership.groupId,
    keyVersion: membership.keyVersion,
    control,
    transactions,
    createdAt: new Date().toISOString(),
  }, `shared-final:${membership.groupId}:v${membership.keyVersion}`)
  const existingId = control.lifecycle?.finalSnapshotFileId
  const file = await uploadDriveFile(token, {
    id: existingId,
    name: 'final.ows',
    parentId: membership.localRootId,
    content: new Blob([packEncryptedPayload(payload) as BlobPart], { type: 'application/octet-stream' }),
    appProperties: {
      owalletSharedType: 'final-snapshot',
      groupId: membership.groupId,
      keyVersion: String(membership.keyVersion),
      updatedAt: new Date().toISOString(),
    },
  })
  if (!existingId) await createAnyoneReaderPermission(token, file.id)
  return file.id
}

async function loadFinalSnapshotPublic(membership: SharedWalletMembership, control: SharedWalletControl) {
  const fileId = control.lifecycle?.finalSnapshotFileId
  if (!fileId) return undefined
  const bytes = await downloadPublicDriveFile(fileId, MAX_SNAPSHOT_BYTES)
  const value = await decryptJson<{ schemaVersion: number; groupId: string; control: SharedWalletControl; transactions: SharedTransaction[] }>(
    await importAes(membership.groupKey),
    unpackEncryptedPayload(bytes),
    `shared-final:${membership.groupId}:v${membership.keyVersion}`,
  )
  if (value.schemaVersion !== 1 || value.groupId !== membership.groupId || !validSharedControl(value.control, membership.groupId) || !Array.isArray(value.transactions)) return undefined
  const memberIds = new Set(value.control.members.map((member) => member.id))
  const transactions = value.transactions
    .map((tx) => memberIds.has(tx.createdByMemberId) ? sanitizeSharedTransaction(tx, membership.groupId, tx.createdByMemberId) : undefined)
    .filter((tx): tx is SharedTransaction => Boolean(tx) && !tx.deleted)
  return { control: value.control, transactions }
}

export async function renameSharedWallet(
  token: string,
  membership: SharedWalletMembership,
  ownerSecrets: Record<string, string>,
  name: string,
) {
  if (membership.role !== 'owner') throw new Error('error.sharedOwnerOnly')
  const cleanName = name.trim().slice(0, 120)
  if (!cleanName) throw new Error('error.sharedNameRequired')
  const loaded = await readControlPublic(membership)
  if ((loaded.control.lifecycle?.state ?? 'active') !== 'active') throw new Error('error.sharedReadOnly')
  loaded.control.name = cleanName
  loaded.control.updatedAt = new Date().toISOString()
  await writeControl(token, loaded.membership, loaded.control, ownerSecrets)
  return { membership: { ...loaded.membership, name: cleanName }, control: loaded.control }
}

export async function updateSharedWalletLedger(
  token: string,
  membership: SharedWalletMembership,
  ownerSecrets: Record<string, string>,
  ledger: SharedWalletControl['ledger'],
) {
  if (membership.role !== 'owner') throw new Error('error.sharedOwnerOnly')
  const loaded = await readControlPublic(membership)
  if ((loaded.control.lifecycle?.state ?? 'active') !== 'active') throw new Error('error.sharedReadOnly')
  loaded.control.ledger = ledger ?? defaultSharedLedger('VND')
  loaded.control.updatedAt = new Date().toISOString()
  await writeControl(token, loaded.membership, loaded.control, ownerSecrets)
  return { membership: loaded.membership, control: loaded.control }
}

export async function scheduleSharedWalletDeletion(
  token: string,
  membership: SharedWalletMembership,
  ownerSecrets: Record<string, string>,
  transactions: SharedTransaction[],
) {
  if (membership.role !== 'owner') throw new Error('error.sharedOwnerOnly')
  const loaded = await readControlPublic(membership)
  const state = loaded.control.lifecycle?.state ?? 'active'
  if (state === 'deleted') throw new Error('error.sharedDeleted')
  if (state === 'closing') return { membership: loaded.membership, control: loaded.control }
  const now = new Date()
  loaded.control.lifecycle = {
    state: 'closing',
    requestedAt: now.toISOString(),
    purgeAfter: new Date(now.getTime() + SHARED_DELETE_GRACE_MS).toISOString(),
  }
  loaded.control.updatedAt = now.toISOString()
  const finalSnapshotFileId = await writeFinalSnapshot(token, loaded.membership, loaded.control, transactions)
  loaded.control.lifecycle.finalSnapshotFileId = finalSnapshotFileId
  await writeControl(token, loaded.membership, loaded.control, ownerSecrets)
  return { membership: loaded.membership, control: loaded.control }
}

export async function cancelSharedWalletDeletion(
  token: string,
  membership: SharedWalletMembership,
  ownerSecrets: Record<string, string>,
) {
  if (membership.role !== 'owner') throw new Error('error.sharedOwnerOnly')
  const loaded = await readControlPublic(membership)
  if ((loaded.control.lifecycle?.state ?? 'active') !== 'closing') return { membership: loaded.membership, control: loaded.control }
  const finalSnapshotFileId = loaded.control.lifecycle?.finalSnapshotFileId
  loaded.control.lifecycle = { state: 'active' }
  loaded.control.updatedAt = new Date().toISOString()
  await writeControl(token, loaded.membership, loaded.control, ownerSecrets)
  if (finalSnapshotFileId) await trashDriveFile(token, finalSnapshotFileId).catch(() => undefined)
  return { membership: loaded.membership, control: loaded.control }
}

export async function finalizeSharedWalletDeletion(
  token: string,
  membership: SharedWalletMembership,
  ownerSecrets: Record<string, string> = {},
) {
  const loaded = await readControlPublic(membership)
  const lifecycle = loaded.control.lifecycle
  if (!lifecycle || lifecycle.state === 'active') throw new Error('error.sharedNotClosing')
  if (lifecycle.state === 'closing') {
    if (!lifecycle.purgeAfter || Date.parse(lifecycle.purgeAfter) > Date.now()) throw new Error('error.sharedDeleteNotDue')
    if (membership.role === 'owner') {
      loaded.control.lifecycle = { ...lifecycle, state: 'deleted', deletedAt: new Date().toISOString() }
      loaded.control.updatedAt = new Date().toISOString()
      await writeControl(token, loaded.membership, loaded.control, ownerSecrets)
    }
  }
  if (membership.role === 'owner') {
    await trashDriveFile(token, membership.feedFileId).catch(() => undefined)
  } else {
    await trashDriveFile(token, membership.localRootId).catch(() => undefined)
  }
  return { membership: loaded.membership, control: loaded.control }
}

export async function inviteSharedWalletMember(
  token: string,
  membership: SharedWalletMembership,
  ownerSecrets: Record<string, string>,
  email: string,
  role: Exclude<SharedWalletRole, 'owner'>,
) {
  if (membership.role !== 'owner') throw new Error('error.sharedOwnerOnly')
  const cleanEmail = email.trim().toLocaleLowerCase('en-US')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error('error.sharedEmailInvalid')
  const loaded = await readControlPublic(membership)
  const control = loaded.control
  if (control.members.some((member) => member.status !== 'removed' && member.email.toLocaleLowerCase('en-US') === cleanEmail)) throw new Error('error.sharedAlreadyMember')

  const memberId = crypto.randomUUID()
  const transportKey = bytesToBase64Url(randomBytes(32))
  const now = new Date().toISOString()
  const registration: RegistrationPayload = {
    schemaVersion: 1,
    groupId: membership.groupId,
    groupName: control.name,
    controlFileId: membership.controlFileId,
    memberId,
    role,
    invitedEmail: cleanEmail,
    keyRing: { currentVersion: membership.keyVersion, keys: keyRingOf(membership) },
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
  }
  const registrationFile = await uploadDriveFile(token, {
    name: `invite-${memberId}.owr`,
    parentId: membership.localRootId,
    content: await encodeRegistration(transportKey, registration),
    appProperties: { owalletSharedType: 'registration', groupId: membership.groupId, memberId },
  })

  const payload: InvitePayload = {
    schemaVersion: 1,
    groupId: membership.groupId,
    groupName: control.name,
    controlFileId: membership.controlFileId,
    memberId,
    role,
    invitedEmail: cleanEmail,
    registrationFileId: registrationFile.id,
    transportKey,
    expiresAt: registration.expiresAt,
  }
  const link = inviteUrl(payload)
  await createDrivePermission(token, registrationFile.id, cleanEmail, 'writer', {
    sendNotificationEmail: true,
    emailMessage: `O-Wallet shared wallet invitation: ${control.name}\n\nOpen this link to join:\n${link}`,
    expirationTime: registration.expiresAt,
  })

  control.members.push({
    id: memberId,
    email: cleanEmail,
    role,
    status: 'invited',
    invitedAt: now,
    registrationFileId: registrationFile.id,
  })
  control.updatedAt = new Date().toISOString()
  const nextSecrets = { ...ownerSecrets, [memberId]: transportKey }
  await writeControl(token, membership, control, nextSecrets)
  return { inviteUrl: link, memberId, transportKey, ownerSecrets: nextSecrets }
}

export async function joinSharedWalletInvite(token: string, user: GoogleUser, invite: InvitePayload) {
  if (Date.parse(invite.expiresAt) < Date.now()) throw new Error('error.sharedInviteExpired')
  if (invite.invitedEmail.toLocaleLowerCase('en-US') !== user.email.toLocaleLowerCase('en-US')) throw new Error('error.sharedInviteAccountMismatch')
  await authorizeSpecificDriveFile(token, invite.registrationFileId)
  const registrationBytes = await downloadDriveFile(token, invite.registrationFileId, MAX_REGISTRATION_BYTES)
  const registration = await decodeRegistration(invite.transportKey, registrationBytes, invite.groupId, invite.memberId)
  if (registration.invitedEmail.toLocaleLowerCase('en-US') !== user.email.toLocaleLowerCase('en-US')) throw new Error('error.sharedInviteAccountMismatch')
  if (Date.parse(registration.expiresAt) < Date.now()) throw new Error('error.sharedInviteExpired')
  if (
    registration.groupName !== invite.groupName
    || registration.controlFileId !== invite.controlFileId
    || registration.role !== invite.role
    || registration.expiresAt !== invite.expiresAt
  ) throw new Error('error.sharedInvalidInvite')
  if (!registration.keyRing?.keys?.[String(registration.keyRing.currentVersion)]) throw new Error('error.sharedInvalidInvite')

  const localRoot = await ensureSharedLocalRoot(token, invite.groupId, invite.groupName)
  const currentVersion = registration.keyRing.currentVersion
  const currentKey = registration.keyRing.keys[String(currentVersion)]
  const membershipBase: Omit<SharedWalletMembership, 'feedFileId'> = {
    groupId: invite.groupId,
    name: invite.groupName,
    controlFileId: invite.controlFileId,
    memberId: invite.memberId,
    role: invite.role,
    groupKey: currentKey,
    keyVersion: currentVersion,
    groupKeyHistory: Object.fromEntries(Object.entries(registration.keyRing.keys).filter(([version]) => Number(version) !== currentVersion)),
    transportKey: invite.transportKey,
    localRootId: localRoot.id,
    joinedAt: new Date().toISOString(),
  }
  const created = await createOwnFeed(token, membershipBase, user)
  const membership: SharedWalletMembership = { ...membershipBase, feedFileId: created.fileId }
  const joinedRegistration: RegistrationPayload = {
    ...registration,
    feedFileId: created.fileId,
    profile: profileFor(user, invite.groupId, invite.memberId),
    joinedAt: membership.joinedAt,
  }
  await uploadDriveFile(token, {
    id: invite.registrationFileId,
    name: `invite-${invite.memberId}.owr`,
    content: await encodeRegistration(invite.transportKey, joinedRegistration),
    appProperties: { owalletSharedType: 'registration', groupId: invite.groupId, memberId: invite.memberId, joined: '1' },
  })
  return membership
}

async function processPendingRegistrations(
  token: string,
  membership: SharedWalletMembership,
  control: SharedWalletControl,
  ownerSecrets: Record<string, string>,
) {
  if (membership.role !== 'owner') return { control, changed: false }
  let changed = false
  for (const member of control.members) {
    if (member.status !== 'invited' || !member.registrationFileId) continue
    const secret = ownerSecrets[member.id]
    if (!secret) continue
    try {
      const bytes = await downloadDriveFile(token, member.registrationFileId, MAX_REGISTRATION_BYTES)
      const registration = await decodeRegistration(secret, bytes, membership.groupId, member.id)
      if (!registration.feedFileId || !registration.profile) continue
      member.feedFileId = registration.feedFileId
      member.status = 'active'
      member.joinedAt = registration.joinedAt ?? new Date().toISOString()
      member.canonicalName = registration.profile.name
      member.googleSub = registration.profile.googleSub
      const registrationFileId = member.registrationFileId
      delete member.registrationFileId
      if (registrationFileId) await trashDriveFile(token, registrationFileId).catch(() => undefined)
      changed = true
    } catch { /* not joined yet */ }
  }
  if (changed) {
    control.updatedAt = new Date().toISOString()
    await writeControl(token, membership, control, ownerSecrets)
  }
  return { control, changed }
}

async function readMemberFeedPublic(member: SharedWalletMember, membership: SharedWalletMembership) {
  if (!member.feedFileId) return undefined
  const bytes = await downloadPublicDriveFile(member.feedFileId, MAX_FEED_BYTES)
  return decodeFeed(bytes, membership)
}

async function ensurePersonalSnapshotFolder(token: string) {
  const layout = await ensureDriveLayout(token)
  let folder = await findDriveChildByAppProperty(token, layout.rootId, 'owalletFolder', 'shared-backups', 'application/vnd.google-apps.folder')
  if (!folder) folder = await createDriveFolder(token, 'shared-backups', layout.rootId, { owalletFolder: 'shared-backups' })
  return folder
}

async function saveSnapshot(token: string, membership: SharedWalletMembership, control: SharedWalletControl, transactions: SharedTransaction[]) {
  const folder = await ensurePersonalSnapshotFolder(token)
  const payload = await encryptJson(await importAes(membership.groupKey), {
    schemaVersion: 1,
    groupId: membership.groupId,
    keyVersion: membership.keyVersion,
    control,
    transactions,
    createdAt: new Date().toISOString(),
  }, `shared-snapshot:${membership.groupId}:v${membership.keyVersion}`)
  const existing = await findDriveChildByAppProperty(token, folder.id, 'owalletSharedSnapshot', membership.groupId)
  await uploadDriveFile(token, {
    id: existing?.id,
    name: `${membership.groupId}.ows`,
    parentId: folder.id,
    content: new Blob([packEncryptedPayload(payload) as BlobPart], { type: 'application/octet-stream' }),
    appProperties: { owalletSharedSnapshot: membership.groupId, keyVersion: String(membership.keyVersion), updatedAt: new Date().toISOString() },
  })
}

async function loadSnapshot(token: string, membership: SharedWalletMembership) {
  const folder = await ensurePersonalSnapshotFolder(token)
  const existing = await findDriveChildByAppProperty(token, folder.id, 'owalletSharedSnapshot', membership.groupId)
  if (!existing) return undefined
  const keyVersion = Number(existing.appProperties?.keyVersion ?? membership.keyVersion)
  const key = keyRingOf(membership)[String(keyVersion)]
  if (!key) return undefined
  const bytes = await downloadDriveFile(token, existing.id, MAX_SNAPSHOT_BYTES)
  const value = await decryptJson<{ schemaVersion: number; groupId: string; control: SharedWalletControl; transactions: SharedTransaction[] }>(await importAes(key), unpackEncryptedPayload(bytes), `shared-snapshot:${membership.groupId}:v${keyVersion}`)
  if (
    value.schemaVersion !== 1
    || value.groupId !== membership.groupId
    || !validSharedControl(value.control, membership.groupId)
    || !Array.isArray(value.transactions)
    || value.transactions.length > MAX_SHARED_TRANSACTIONS_PER_FEED * Math.max(1, value.control.members.length)
  ) return undefined
  const memberIds = new Set(value.control.members.map((member) => member.id))
  const transactions = value.transactions
    .map((tx) => memberIds.has(tx.createdByMemberId) ? sanitizeSharedTransaction(tx, membership.groupId, tx.createdByMemberId) : undefined)
    .filter((tx): tx is SharedTransaction => Boolean(tx))
  return { ...value, transactions }
}

export async function loadSharedWallet(
  token: string,
  membershipInput: SharedWalletMembership,
  ownerSecrets: Record<string, string> = {},
): Promise<SharedWalletLoaded> {
  let membership = membershipInput
  const snapshot = await loadSnapshot(token, membership).catch(() => undefined)
  let control: SharedWalletControl
  try {
    const loadedControl = await readControlPublic(membership)
    membership = loadedControl.membership
    control = loadedControl.control
  } catch (error) {
    if (snapshot) return { control: snapshot.control, transactions: snapshot.transactions, profiles: {}, snapshotCount: snapshot.transactions.length, membership, fromSnapshot: true }
    throw error
  }

  if (membership.role === 'owner' && (control.lifecycle?.state ?? 'active') === 'active') {
    const processed = await processPendingRegistrations(token, membership, control, ownerSecrets)
    control = processed.control
  }

  if ((control.lifecycle?.state === 'closing' || control.lifecycle?.state === 'deleted') && control.lifecycle.finalSnapshotFileId) {
    const finalSnapshot = await loadFinalSnapshotPublic(membership, control).catch(() => undefined)
    if (finalSnapshot) {
      return { control, transactions: finalSnapshot.transactions, profiles: {}, snapshotCount: finalSnapshot.transactions.length, membership }
    }
  }

  const profiles: Record<string, SharedMemberProfile> = {}
  const byId = new Map<string, SharedTransaction>()
  for (const member of control.members) {
    if (member.status === 'invited' || !member.feedFileId) continue
    try {
      const feed = await readMemberFeedPublic(member, membership)
      if (!feed) continue
      profiles[member.id] = feed.profile
      for (const tx of feed.transactions) {
        if (!tx.deleted && tx.groupId === membership.groupId && tx.createdByMemberId === member.id) byId.set(`${member.id}:${tx.id}`, tx)
      }
    } catch { /* one broken member feed must not block the whole wallet */ }
  }

  if (!profiles[membership.memberId]) {
    try {
      const ownFeed = await loadOwnFeed(token, membership)
      profiles[membership.memberId] = ownFeed.profile
      for (const tx of ownFeed.transactions) {
        if (!tx.deleted && tx.groupId === membership.groupId && tx.createdByMemberId === membership.memberId) byId.set(`${membership.memberId}:${tx.id}`, tx)
      }
    } catch { /* a missing own feed is surfaced on write; it should not hide other members */ }
  }

  const all = [...byId.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  await saveSnapshot(token, membership, control, all).catch(() => undefined)
  return { control, transactions: all, profiles, snapshotCount: all.length, membership }
}

async function loadOwnFeed(token: string, membership: SharedWalletMembership) {
  const bytes = await downloadDriveFile(token, membership.feedFileId, MAX_FEED_BYTES)
  return decodeFeed(bytes, membership)
}

async function currentWritableMembership(membership: SharedWalletMembership) {
  const loaded = await readControlPublic(membership)
  if ((loaded.control.lifecycle?.state ?? 'active') !== 'active') throw new Error('error.sharedReadOnly')
  const member = loaded.control.members.find((item) => item.id === membership.memberId)
  if (!member || member.status === 'removed') throw new Error('error.sharedAccessRemoved')
  if (member.status !== 'active' && member.id !== membership.memberId) throw new Error('error.sharedReadOnly')
  const effective = { ...loaded.membership, role: member.role }
  if (effective.role === 'viewer') throw new Error('error.sharedReadOnly')
  return effective
}

export async function saveSharedTransaction(
  token: string,
  membership: SharedWalletMembership,
  input: Omit<SharedTransaction, 'groupId' | 'createdByMemberId' | 'createdAt' | 'updatedAt' | 'deleted'> & { createdAt?: string },
) {
  const effectiveMembership = await currentWritableMembership(membership)
  const feed = await loadOwnFeed(token, effectiveMembership)
  const id = typeof input.id === 'string' ? input.id.slice(0, 160) : ''
  if (!id || (input.type !== 'expense' && input.type !== 'income' && input.type !== 'transfer')) throw new Error('error.sharedSaveFailed')
  if (input.type === 'transfer' && (!input.accountId || !input.destinationAccountId || input.accountId === input.destinationAccountId)) throw new Error('error.sharedSaveFailed')
  if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1e18) throw new Error('error.sharedSaveFailed')
  if (!validIso(input.occurredAt)) throw new Error('error.sharedSaveFailed')
  const currency = cleanSharedText(input.currency, 12)
  if (!currency) throw new Error('error.sharedSaveFailed')

  const existing = feed.transactions.find((tx) => tx.id === id)
  if (existing && existing.createdByMemberId !== effectiveMembership.memberId) throw new Error('error.sharedOwnRecordsOnly')
  if (!existing && feed.transactions.length >= MAX_SHARED_TRANSACTIONS_PER_FEED) throw new Error('error.sharedFeedLimit')

  const now = new Date().toISOString()
  const tx: SharedTransaction = {
    id,
    groupId: effectiveMembership.groupId,
    type: input.type,
    amount: input.amount,
    currency,
    occurredAt: input.occurredAt,
    accountId: cleanSharedText(input.accountId, 160),
    destinationAccountId: cleanSharedText(input.destinationAccountId, 160),
    categoryId: cleanSharedText(input.categoryId, 160),
    category: cleanSharedText(input.category, 512),
    merchant: cleanSharedText(input.merchant),
    description: cleanSharedText(input.description),
    note: cleanSharedText(input.note, 16_384),
    tags: Array.isArray(input.tags)
      ? input.tags.slice(0, MAX_SHARED_TAGS).map((tag) => cleanSharedText(tag, MAX_SHARED_TAG_LENGTH)).filter((tag): tag is string => Boolean(tag))
      : undefined,
    createdByMemberId: effectiveMembership.memberId,
    sourceCreatedByMemberId: cleanSharedText(input.sourceCreatedByMemberId, 160),
    sourceCreatedByName: cleanSharedText(input.sourceCreatedByName, 320),
    createdAt: input.createdAt && validIso(input.createdAt) ? input.createdAt : existing?.createdAt ?? now,
    updatedAt: now,
    deleted: false,
  }
  feed.transactions = [...feed.transactions.filter((item) => item.id !== tx.id), tx]
  feed.revision += 1
  feed.keyVersion = effectiveMembership.keyVersion
  feed.updatedAt = now
  await writeOwnFeed(token, effectiveMembership, feed)
  return tx
}

export async function deleteSharedTransaction(token: string, membership: SharedWalletMembership, id: string) {
  const effectiveMembership = await currentWritableMembership(membership)
  const feed = await loadOwnFeed(token, effectiveMembership)
  const current = feed.transactions.find((tx) => tx.id === id)
  if (!current || current.createdByMemberId !== effectiveMembership.memberId) throw new Error('error.sharedOwnRecordsOnly')
  const now = new Date().toISOString()
  feed.transactions = feed.transactions.map((tx) => tx.id === id ? { ...tx, deleted: true, updatedAt: now } : tx)
  feed.revision += 1
  feed.keyVersion = effectiveMembership.keyVersion
  feed.updatedAt = now
  await writeOwnFeed(token, effectiveMembership, feed)
}

async function archiveMemberFeedBeforeRemoval(
  token: string,
  membership: SharedWalletMembership,
  member: SharedWalletMember,
) {
  if (!member.feedFileId) return undefined
  const feed = await readMemberFeedPublic(member, membership)
  if (!feed) return undefined
  const archivedFeed: SharedMemberFeed = {
    ...feed,
    revision: feed.revision + 1,
    keyVersion: membership.keyVersion,
    updatedAt: new Date().toISOString(),
  }
  const text = await encodeFeed(archivedFeed, membership.groupKey)
  const file = await uploadDriveFile(token, {
    name: `archive-${member.id}.owf`,
    parentId: membership.localRootId,
    content: new Blob([text], { type: 'application/json' }),
    appProperties: {
      owalletSharedType: 'member-archive',
      groupId: membership.groupId,
      memberId: member.id,
      keyVersion: String(membership.keyVersion),
      updatedAt: archivedFeed.updatedAt,
    },
  })
  await createAnyoneReaderPermission(token, file.id)
  return file.id
}

async function refreshPendingRegistrationKeyRings(
  token: string,
  membership: SharedWalletMembership,
  control: SharedWalletControl,
  ownerSecrets: Record<string, string>,
) {
  const ring: KeyRingEnvelope = { currentVersion: membership.keyVersion, keys: keyRingOf(membership) }
  for (const member of control.members) {
    if (member.status !== 'invited' || !member.registrationFileId) continue
    const secret = ownerSecrets[member.id]
    if (!secret) continue
    try {
      const bytes = await downloadDriveFile(token, member.registrationFileId, MAX_REGISTRATION_BYTES)
      const registration = await decodeRegistration(secret, bytes, membership.groupId, member.id)
      if (registration.feedFileId || registration.joinedAt) continue
      const refreshed: RegistrationPayload = { ...registration, keyRing: ring }
      await uploadDriveFile(token, {
        id: member.registrationFileId,
        name: `invite-${member.id}.owr`,
        content: await encodeRegistration(secret, refreshed),
        appProperties: { owalletSharedType: 'registration', groupId: membership.groupId, memberId: member.id },
      })
    } catch {
      // A broken/expired pending invitation should not prevent removing another member.
    }
  }
}

export async function removeSharedWalletMember(
  token: string,
  membership: SharedWalletMembership,
  ownerSecrets: Record<string, string>,
  memberId: string,
) {
  if (membership.role !== 'owner') throw new Error('error.sharedOwnerOnly')
  const loaded = await readControlPublic(membership)
  let ownerMembership = loaded.membership
  const control = loaded.control
  const member = control.members.find((item) => item.id === memberId)
  if (!member || member.id === control.ownerMemberId) throw new Error('error.sharedCannotRemoveOwner')

  if (member.status === 'active' && member.feedFileId) {
    const archiveFileId = await archiveMemberFeedBeforeRemoval(token, ownerMembership, member)
    if (archiveFileId) member.feedFileId = archiveFileId
  } else if (member.status === 'invited' && member.registrationFileId) {
    await trashDriveFile(token, member.registrationFileId).catch(() => undefined)
    delete member.registrationFileId
  }
  member.status = 'removed'
  control.keyVersion += 1
  control.updatedAt = new Date().toISOString()
  const nextVersion = control.keyVersion
  const oldRing = keyRingOf(ownerMembership)
  const newKey = bytesToBase64Url(randomBytes(32))
  ownerMembership = {
    ...ownerMembership,
    keyVersion: nextVersion,
    groupKey: newKey,
    groupKeyHistory: { ...oldRing },
  }
  const nextSecrets = { ...ownerSecrets }
  delete nextSecrets[memberId]
  await refreshPendingRegistrationKeyRings(token, ownerMembership, control, nextSecrets)
  await writeControl(token, ownerMembership, control, nextSecrets)
  return { membership: ownerMembership, ownerSecrets: nextSecrets }
}
