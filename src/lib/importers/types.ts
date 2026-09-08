import type { TransactionType } from '../../types'

export type ExternalImportAdapterId = 'money-manager-android'

export interface ExternalImportAccount {
  sourceId: string
  name: string
  currency: string
  groupName?: string
}

export interface ExternalImportCategory {
  sourceId: string
  name: string
  kind: 'expense' | 'income' | 'both'
  parentSourceId?: string
  parentName?: string
}

export interface ExternalImportTransaction {
  sourceId: string
  /** Source ids that were collapsed into this one O-Wallet transaction, e.g. a mirrored transfer pair. */
  sourceRowIds: string[]
  type: TransactionType
  amount: number
  currency: string
  occurredAt: string
  accountSourceId: string
  destinationAccountSourceId?: string
  categorySourceId?: string
  description?: string
  merchant?: string
  note?: string
  tags?: string[]
  sourceDoType?: string
}

export interface ExternalImportUnsupportedRow {
  sourceId: string
  doType: string
  amount: number
  occurredAt?: string
  description?: string
  accountSourceId?: string
  destinationAccountSourceId?: string
  categorySourceId?: string
  currency?: string
  reason: 'unknown-transaction-type' | 'unpaired-transfer' | 'invalid-row'
}

export interface ExternalImportPhotoReference {
  sourceId: string
  transactionSourceId: string
  fileName?: string
  originalPath?: string
  fileSize?: number
}

export interface ExternalImportBundle {
  adapterId: ExternalImportAdapterId
  adapterName: string
  sourceSchemaVersion?: number
  sourceFileName: string
  accounts: ExternalImportAccount[]
  categories: ExternalImportCategory[]
  transactions: ExternalImportTransaction[]
  unsupportedRows: ExternalImportUnsupportedRow[]
  photoReferences: ExternalImportPhotoReference[]
  dateRange?: { min: string; max: string }
  stats: {
    rawTransactions: number
    incomeRows: number
    expenseRows: number
    transferPairs: number
    balanceAdjustmentRows: number
    skippedRows: number
  }
  warnings: string[]
}

export interface ExternalImportWorkerRequest {
  type: 'parse'
  fileName: string
  buffer: ArrayBuffer
}

export type ExternalImportWorkerResponse =
  | { type: 'result'; bundle: ExternalImportBundle }
  | { type: 'error'; message: string }
