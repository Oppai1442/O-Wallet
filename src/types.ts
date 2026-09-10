export type TransactionType = 'expense' | 'income' | 'transfer'
export type ThemeMode = 'system' | 'light' | 'dark'
export type ImageRetentionMode = 'forever' | 'days'
export type RememberDuration = 'off' | 'tab' | '1h' | '8h' | '1d' | '7d' | '30d'
export type VaultRememberDuration = 'off' | '15m' | '1h' | '8h' | '1d' | '7d' | '30d'
export type AppLanguage = 'vi' | 'en'
export type AiProvider = 'openrouter'
export type OcrField = 'generic' | 'amount' | 'occurredAt' | 'merchant' | 'balanceAfter' | 'description' | 'ignore'

export interface OcrRegion {
  id: string
  field: OcrField
  x: number
  y: number
  width: number
  height: number
  /** Strip a short inline label such as `Nội dung:` before parsing the region value. */
  stripLabel?: boolean
  /** Present when the region was generated from a detected OCR line in the teaching UI. */
  sourceLineId?: string
}

export interface OcrDetectedLine {
  id: string
  text: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
}

export interface OcrTemplate {
  id: string
  name: string
  aspectRatio?: number
  regions: OcrRegion[]
  createdAt: string
  updatedAt: string
}

export interface AiVisionSettings {
  provider: AiProvider
  /** User-configured OpenRouter Chat Completions endpoint. Blank means AI is not configured. */
  endpoint?: string
  /** Vision-capable OpenRouter model slug. Blank means AI is not configured. */
  model?: string
}

export type VoiceInputLanguage = 'vi-VN' | 'en-US'
export type VoiceInputField = 'type' | 'amount' | 'date' | 'time' | 'account' | 'destinationAccount' | 'category' | 'merchant' | 'description'

export interface VoiceAccentCorrection {
  heard: string
  expected: string
  updatedAt: string
}

export interface VoiceInputSettings {
  language: VoiceInputLanguage
  fieldOrder: VoiceInputField[]
  corrections: VoiceAccentCorrection[]
  calibrationCompletedAt?: string
}

export interface BudgetConfig {
  id: string
  categoryId: string
  monthlyLimit: number
}

export interface AccountCatalogue {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface TransactionRule {
  id: string
  name: string
  enabled: boolean
  merchantContains?: string
  descriptionContains?: string
  amountEquals?: number
  transactionType?: TransactionType
  categoryId?: string
  accountId?: string
  createdAt: string
  updatedAt: string
}

export type SharedWalletRole = 'owner' | 'member' | 'viewer'
export type SharedWalletLifecycleState = 'active' | 'closing' | 'deleted'

export interface SharedWalletLifecycle {
  state: SharedWalletLifecycleState
  requestedAt?: string
  purgeAfter?: string
  deletedAt?: string
  finalSnapshotFileId?: string
}

export interface SharedWalletMember {
  id: string
  email: string
  role: SharedWalletRole
  status: 'invited' | 'active' | 'removed'
  invitedAt: string
  joinedAt?: string
  canonicalName?: string
  googleSub?: string
  /** Public, encrypted feed file owned by this member. */
  feedFileId?: string
  /** Tiny owner-owned registration file used only during invitation/join. */
  registrationFileId?: string
}

export interface SharedWalletLedger {
  defaultCurrency: string
  accounts: Account[]
  categories: Category[]
  budgets: BudgetConfig[]
  accountCatalogues: AccountCatalogue[]
  transactionRules: TransactionRule[]
  /** Per-shared-profile OCR teaching/templates. Image bytes are not stored here. */
  ocrTemplates?: OcrTemplate[]
  /** Endpoint/model may be profile-specific. The API key remains device-local. */
  aiVision?: AiVisionSettings
  /** Same guided speech-entry configuration used by the personal profile. */
  voiceInput?: VoiceInputSettings
  transactionDefaults?: {
    accountId?: string
    categoryId?: string
  }
}

export interface SharedWalletControl {
  schemaVersion: 1
  groupId: string
  name: string
  ownerMemberId: string
  keyVersion: number
  createdAt: string
  updatedAt: string
  members: SharedWalletMember[]
  /** Existing v0.12/v0.13 controls omit this and are treated as active. */
  lifecycle?: SharedWalletLifecycle
  /** Existing shared wallets omit this and are upgraded lazily to an empty isolated ledger. */
  ledger?: SharedWalletLedger
}

export interface SharedWalletMembership {
  groupId: string
  name: string
  controlFileId: string
  memberId: string
  role: SharedWalletRole
  /** Last live lifecycle observed from control. Stored inside the encrypted personal settings record and used only for instant local UI state. */
  lifecycleCache?: SharedWalletLifecycle
  /** Current group key and its version. */
  groupKey: string
  keyVersion: number
  /** Older keys are retained so historical feeds remain readable after membership rotation. */
  groupKeyHistory?: Record<string, string>
  /** Unique per-member transport secret used only to receive future group-key rotations. */
  transportKey: string
  /** Folder in this user's own Drive. It is never shared as a writable group root. */
  localRootId: string
  /** Public, encrypted feed owned by this member. */
  feedFileId: string
  joinedAt: string
}

export interface SharedTransaction {
  id: string
  groupId: string
  type: TransactionType
  amount: number
  currency: string
  occurredAt: string
  accountId?: string
  destinationAccountId?: string
  categoryId?: string
  /** Legacy free-text category from pre-v0.14 shared wallets. */
  category?: string
  merchant?: string
  balanceAfter?: number
  description?: string
  note?: string
  tags?: string[]
  batch?: TransactionBatchInfo
  createdByMemberId: string
  /** Provenance retained when an archived wallet is reopened as a new wallet. */
  sourceCreatedByMemberId?: string
  sourceCreatedByName?: string
  createdAt: string
  updatedAt: string
  deleted: boolean
}

export interface SharedMemberProfile {
  groupId: string
  memberId: string
  googleSub: string
  email: string
  name: string
  updatedAt: string
}

export interface SharedMemberFeed {
  schemaVersion: 1
  groupId: string
  memberId: string
  revision: number
  keyVersion: number
  profile: SharedMemberProfile
  transactions: SharedTransaction[]
  updatedAt: string
}

export interface SharedWalletArchive {
  id: string
  originalGroupId: string
  name: string
  createdAt: string
  closedAt: string
  archivedAt: string
  ledger: SharedWalletLedger
  transactions: SharedTransaction[]
  members: SharedWalletMember[]
  memberNames: Record<string, string>
  finalBalances: Record<string, number>
  totals: { income: number; expense: number; net: number }
}

export interface EncryptedSharedRecordRow {
  key: string
  groupId: string
  id: string
  fileId?: string
  version: number
  updatedAt: string
  createdByMemberId: string
  deleted: boolean
  payload: EncryptedPayload
}

export interface ExternalImportTrace {
  adapterId: string
  sourceId: string
  sourceRowIds?: string[]
  sourceFileName?: string
}

export interface TransactionBatchInfo {
  id: string
  mode: 'multi-date' | 'recurring' | 'ocr-batch'
  index: number
  count: number
}

export interface Transaction {
  id: string
  type: TransactionType
  amount: number
  currency: string
  occurredAt: string
  categoryId: string
  accountId: string
  destinationAccountId?: string
  merchant?: string
  balanceAfter?: number
  description?: string
  note?: string
  tags?: string[]
  batch?: TransactionBatchInfo
  importSource?: ExternalImportTrace
  imageIds: string[]
  createdAt: string
  updatedAt: string
  deleted: boolean
}

export interface Account {
  id: string
  name: string
  catalogueId?: string
  currency: string
  openingBalance: number
  archived: boolean
  createdAt: string
  updatedAt: string
  deleted: boolean
}

export interface Category {
  id: string
  name: string
  /** Hierarchy is unlimited. Missing nodeType on old data is treated as an item. */
  nodeType?: 'group' | 'item'
  parentId?: string
  icon: string
  kind: 'expense' | 'income' | 'both'
  archived: boolean
  createdAt: string
  updatedAt: string
  deleted: boolean
}

export interface AppSettings {
  id: 'settings'
  theme: ThemeMode
  language?: AppLanguage
  imageRetention: {
    mode: ImageRetentionMode
    days: number
  }
  defaultCurrency: string
  autoSync: boolean
  rememberDefaults?: DeviceSessionPreferences
  ocrTemplates?: OcrTemplate[]
  budgets?: BudgetConfig[]
  accountCatalogues?: AccountCatalogue[]
  transactionRules?: TransactionRule[]
  /** AI endpoint/model sync as encrypted settings. API keys never sync. */
  aiVision?: AiVisionSettings
  /** Guided speech-entry preferences and accent corrections. Audio is never stored. */
  voiceInput?: VoiceInputSettings
  sharedWallets?: SharedWalletMembership[]
  /** Finalized shared wallets are re-encrypted inside the user's personal vault and remain isolated from personal balances. */
  sharedWalletArchives?: SharedWalletArchive[]
  /** Per-user aliases. They are encrypted in the personal vault and never written to the shared wallet. */
  sharedWalletAliases?: Record<string, Record<string, string>>
  /** Owner-only invitation transport secrets. Stored inside the owner's encrypted personal vault. */
  sharedWalletOwnerSecrets?: Record<string, Record<string, string>>
  transactionDefaults?: {
    accountId?: string
    categoryId?: string
  }
  createdAt: string
  updatedAt: string
  deleted: false
}

export type WalletEntity = Transaction | Account | Category | AppSettings
export type RecordKind = 'transaction' | 'account' | 'category' | 'settings'

export interface EncryptedPayload {
  version: 1 | 2
  iv: string
  ciphertext: ArrayBuffer
}

export interface EncryptedRecordRow {
  id: string
  kind: RecordKind
  version: number
  updatedAt: string
  deviceId: string
  deleted: boolean
  payload: EncryptedPayload
}

export interface EncryptedImageRow {
  id: string
  version: number
  updatedAt: string
  deviceId: string
  deleted: boolean
  payload: EncryptedPayload
}

export type SyncEntityType = 'record' | 'image'

export interface SyncQueueRow {
  key: string
  entityType: SyncEntityType
  entityId: string
  queuedAt: string
}

export interface RemoteEntityRow {
  id: string
  fileId: string
  version: number
  updatedAt: string
  deviceId: string
  deleted: boolean
  size?: number
}

export interface SyncState {
  schemaVersion: 1
  changeToken?: string
  driveLayout?: DriveLayout
  vaultFingerprint?: string
  initializedAt?: string
}

export interface SecurityQuestionConfig {
  questionId: string
  answerSalt: string
  answerHash: string
  answerKdfIterations?: number
}

export interface VaultConfig {
  schemaVersion: 1
  createdAt: string
  kdf: {
    name: 'PBKDF2-SHA256'
    iterations: number
    salt: string
  }
  passwordWrappedDek: {
    iv: string
    ciphertext: string
  }
  recovery: {
    wrappedDek: {
      iv: string
      ciphertext: string
    }
    questions: SecurityQuestionConfig[]
  }
}

export interface GoogleUser {
  sub: string
  email: string
  name: string
  picture?: string
}

export interface GoogleSession {
  accessToken: string
  expiresAt: number
  user: GoogleUser
}

export interface DeviceSessionPreferences {
  googleRemember: RememberDuration
  vaultRemember: VaultRememberDuration
}

export interface RememberedVaultUnlock {
  vaultCreatedAt: string
  expiresAt: number
  dek: CryptoKey
}

export interface GoogleAccountBinding extends GoogleUser {}

export interface DriveLayout {
  rootId: string
  recordsId: string
  imagesId: string
  vaultFileId?: string
}

export interface OcrBox {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

export interface OcrResult {
  text: string
  boxes: OcrBox[]
}

export interface ParsedTransactionCandidate {
  type: TransactionType
  amount?: number
  occurredAt?: string
  merchant?: string
  balanceAfter?: number
  description?: string
  rawText: string
}

export interface SyncStats {
  pulledRecords: number
  pushedRecords: number
  pulledImages: number
  pushedImages: number
  conflictsResolved: number
  startedAt: string
  finishedAt: string
}
