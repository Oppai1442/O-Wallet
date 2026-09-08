export type TransactionType = 'expense' | 'income' | 'transfer'
export type ThemeMode = 'system' | 'light' | 'dark'
export type ImageRetentionMode = 'forever' | 'days'
export type RememberDuration = 'off' | 'tab' | '1h' | '8h' | '1d' | '7d' | '30d'
export type VaultRememberDuration = 'off' | '15m' | '1h' | '8h' | '1d' | '7d' | '30d'
export type AppLanguage = 'vi' | 'en'
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

export interface BudgetConfig {
  id: string
  categoryId: string
  monthlyLimit: number
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
  imageIds: string[]
  createdAt: string
  updatedAt: string
  deleted: boolean
}

export interface Account {
  id: string
  name: string
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
  version: 1
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

export interface SecurityQuestionConfig {
  questionId: string
  answerSalt: string
  answerHash: string
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
