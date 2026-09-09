/// <reference lib="webworker" />

import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { SECURITY_LIMITS } from '../lib/security'
import type {
  ExternalImportAccount,
  ExternalImportBundle,
  ExternalImportCategory,
  ExternalImportPhotoReference,
  ExternalImportTransaction,
  ExternalImportUnsupportedRow,
  ExternalImportWorkerRequest,
  ExternalImportWorkerResponse,
} from '../lib/importers/types'

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope

type Row = Record<string, SqlValue>

function queryRows(db: Database, sql: string, params: SqlValue[] = []): Row[] {
  const stmt = db.prepare(sql)
  try {
    if (params.length) stmt.bind(params)
    const rows: Row[] = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    return rows
  } finally {
    stmt.free()
  }
}

function scalarNumber(db: Database, sql: string, fallback = 0) {
  const rows = queryRows(db, sql)
  const first = rows[0]
  if (!first) return fallback
  const value = Object.values(first)[0]
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function text(value: SqlValue | undefined | null) {
  const result = value === null || value === undefined ? '' : String(value)
  return result.length > SECURITY_LIMITS.maxImportedStringLength
    ? result.slice(0, SECURITY_LIMITS.maxImportedStringLength)
    : result
}

function finiteNumber(value: SqlValue | undefined | null) {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function sqliteTables(db: Database) {
  return new Set(queryRows(db, "SELECT name FROM sqlite_master WHERE type='table'").map((row) => text(row.name)))
}

function normalizeMoneyManagerTimestamp(value: SqlValue | undefined | null, fallbackDate?: string) {
  const epoch = finiteNumber(value)
  if (epoch !== undefined && epoch > 0) {
    const millis = epoch < 10_000_000_000 ? epoch * 1000 : epoch
    const date = new Date(millis)
    if (Number.isFinite(date.getTime())) return date.toISOString()
  }
  if (fallbackDate) {
    const parsed = new Date(`${fallbackDate}T12:00:00`)
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString()
  }
  return undefined
}

function cleanOptional(value: SqlValue | undefined | null) {
  const result = text(value).trim()
  return result || undefined
}

function detectMoneyManager(db: Database) {
  const tables = sqliteTables(db)
  return ['INOUTCOME', 'ASSETS', 'ZCATEGORY'].every((table) => tables.has(table))
}

function parseMoneyManager(db: Database, fileName: string): ExternalImportBundle {
  const tables = sqliteTables(db)
  if (!detectMoneyManager(db)) throw new Error('error.importUnsupportedSchema')

  const transactionCount = scalarNumber(db, 'SELECT COUNT(*) FROM INOUTCOME', 0)
  const accountCount = scalarNumber(db, 'SELECT COUNT(*) FROM ASSETS', 0)
  const categoryCount = scalarNumber(db, 'SELECT COUNT(*) FROM ZCATEGORY', 0)
  if (transactionCount > SECURITY_LIMITS.maxImportedTransactions) throw new Error('error.importTooManyTransactions')
  if (accountCount > SECURITY_LIMITS.maxImportedAccounts) throw new Error('error.importTooManyAccounts')
  if (categoryCount > SECURITY_LIMITS.maxImportedCategories) throw new Error('error.importTooManyCategories')

  const sourceSchemaVersion = scalarNumber(db, 'PRAGMA user_version', 0) || undefined
  const accountRows = queryRows(db, `
    SELECT a.uid, a.NIC_NAME, a.groupUid,
           COALESCE(c.ISO, c.MAIN_ISO, 'VND') AS currency,
           g.ACC_GROUP_NAME AS groupName
    FROM ASSETS a
    LEFT JOIN CURRENCY c ON c.uid = a.currencyUid
    LEFT JOIN ASSETGROUP g ON g.uid = a.groupUid
    ORDER BY a.ORDERSEQ, a.ID
  `)

  const accounts: ExternalImportAccount[] = accountRows
    .map((row) => ({
      sourceId: text(row.uid),
      name: text(row.NIC_NAME).trim() || 'Unnamed account',
      currency: text(row.currency).trim() || 'VND',
      groupName: cleanOptional(row.groupName),
    }))
    .filter((item) => item.sourceId)

  const categoryRows = queryRows(db, `
    SELECT c.uid, c.NAME, c.TYPE, c.pUid,
           p.NAME AS parentName
    FROM ZCATEGORY c
    LEFT JOIN ZCATEGORY p ON p.uid = c.pUid
    WHERE COALESCE(c.C_IS_DEL, 0) = 0
    ORDER BY c.TYPE, c.ORDERSEQ, c.ID
  `)

  const categories: ExternalImportCategory[] = categoryRows
    .map((row) => ({
      sourceId: text(row.uid),
      name: text(row.NAME).trim() || 'Other',
      kind: Number(row.TYPE) === 0 ? 'income' as const : 'expense' as const,
      parentSourceId: ['0', ''].includes(text(row.pUid)) ? undefined : text(row.pUid),
      parentName: cleanOptional(row.parentName),
    }))
    .filter((item) => item.sourceId)

  const txRows = queryRows(db, `
    SELECT AID, uid, assetUid, toAssetUid, ctgUid, ZCONTENT, ZDATE, WDATE,
           DO_TYPE, ZMONEY, IN_ZMONEY, AMOUNT_ACCOUNT, currencyUid,
           SMS_PARSE_CONTENT, SMS_ORIGIN, lat, lng
    FROM INOUTCOME
    WHERE COALESCE(IS_DEL, 0) = 0
    ORDER BY CAST(ZDATE AS INTEGER), AID
  `)

  const tagsByTransaction = new Map<string, string[]>()
  if (tables.has('TAG') && tables.has('TX_TAG')) {
    const tagRows = queryRows(db, `
      SELECT x.txUid, t.name
      FROM TX_TAG x
      JOIN TAG t ON t.uid = x.tagUid
      WHERE COALESCE(x.isDel, 0) = 0 AND COALESCE(t.isDel, 0) = 0
      ORDER BY x.orderSeq, x.id
    `)
    for (const row of tagRows) {
      const txUid = text(row.txUid)
      const tagName = text(row.name).trim()
      if (!txUid || !tagName) continue
      const current = tagsByTransaction.get(txUid) ?? []
      current.push(tagName)
      tagsByTransaction.set(txUid, current)
    }
  }

  const currencyByUid = new Map<string, string>()
  if (tables.has('CURRENCY')) {
    for (const row of queryRows(db, `SELECT uid, COALESCE(ISO, MAIN_ISO, 'VND') AS iso FROM CURRENCY WHERE COALESCE(IS_DEL, 0) = 0`)) {
      currencyByUid.set(text(row.uid), text(row.iso).trim() || 'VND')
    }
  }
  const defaultCurrency = accounts[0]?.currency || 'VND'

  const transactions: ExternalImportTransaction[] = []
  const unsupportedRows: ExternalImportUnsupportedRow[] = []
  const consumedTransferRowIds = new Set<string>()
  const rowsByTransferKey = new Map<string, Row[]>()

  for (const row of txRows) {
    const doType = text(row.DO_TYPE)
    if (doType !== '3' && doType !== '4') continue
    const amount = finiteNumber(row.ZMONEY) ?? finiteNumber(row.AMOUNT_ACCOUNT) ?? 0
    const key = `${text(row.ZDATE)}|${amount}`
    const list = rowsByTransferKey.get(key) ?? []
    list.push(row)
    rowsByTransferKey.set(key, list)
  }

  let transferPairs = 0
  let incomeRows = 0
  let expenseRows = 0
  let balanceAdjustmentRows = 0

  for (const row of txRows) {
    const sourceUid = text(row.uid) || `aid:${text(row.AID)}`
    const doType = text(row.DO_TYPE)
    const amount = finiteNumber(row.ZMONEY) ?? finiteNumber(row.AMOUNT_ACCOUNT)
    const occurredAt = normalizeMoneyManagerTimestamp(row.ZDATE, text(row.WDATE))
    const description = cleanOptional(row.ZCONTENT) ?? cleanOptional(row.SMS_PARSE_CONTENT)
    const currency = currencyByUid.get(text(row.currencyUid)) || defaultCurrency

    if (!amount || amount < 0 || !occurredAt || !text(row.assetUid)) {
      unsupportedRows.push({
        sourceId: sourceUid,
        doType,
        amount: amount ?? 0,
        occurredAt,
        description,
        accountSourceId: text(row.assetUid) || undefined,
        destinationAccountSourceId: text(row.toAssetUid) || undefined,
        categorySourceId: text(row.ctgUid) || undefined,
        currency,
        reason: 'invalid-row',
      })
      continue
    }

    if (doType === '0' || doType === '1') {
      const type = doType === '0' ? 'income' : 'expense'
      if (type === 'income') incomeRows += 1
      else expenseRows += 1
      transactions.push({
        sourceId: sourceUid,
        sourceRowIds: [sourceUid],
        type,
        amount,
        currency,
        occurredAt,
        accountSourceId: text(row.assetUid),
        categorySourceId: text(row.ctgUid) || undefined,
        description,
        note: cleanOptional(row.SMS_ORIGIN),
        tags: tagsByTransaction.get(sourceUid),
        sourceDoType: doType,
      })
      continue
    }

    if (doType === '3' || doType === '4') {
      if (consumedTransferRowIds.has(sourceUid)) continue
      const key = `${text(row.ZDATE)}|${amount}`
      const candidates = rowsByTransferKey.get(key) ?? []
      const asset = text(row.assetUid)
      const toAsset = text(row.toAssetUid)
      const opposite = candidates.find((candidate) => {
        const candidateUid = text(candidate.uid) || `aid:${text(candidate.AID)}`
        if (candidateUid === sourceUid || consumedTransferRowIds.has(candidateUid)) return false
        return text(candidate.DO_TYPE) !== doType
          && text(candidate.assetUid) === toAsset
          && text(candidate.toAssetUid) === asset
      })

      if (!opposite || !asset || !toAsset) {
        unsupportedRows.push({
          sourceId: sourceUid,
          doType,
          amount,
          occurredAt,
          description,
          accountSourceId: asset || undefined,
          destinationAccountSourceId: toAsset || undefined,
          categorySourceId: text(row.ctgUid) || undefined,
          currency,
          reason: 'unpaired-transfer',
        })
        continue
      }

      const oppositeUid = text(opposite.uid) || `aid:${text(opposite.AID)}`
      consumedTransferRowIds.add(sourceUid)
      consumedTransferRowIds.add(oppositeUid)

      // Money Manager stores one mirrored row per side of a transfer. In the observed
      // Android schema, DO_TYPE=3 carries the source->destination orientation; when the
      // current row is the DO_TYPE=4 mirror, invert it before creating the O-Wallet row.
      const sourceRow = doType === '3' ? row : opposite
      const sourceRowUid = text(sourceRow.uid) || `aid:${text(sourceRow.AID)}`
      const mirrorRowUid = sourceRowUid === sourceUid ? oppositeUid : sourceUid
      transferPairs += 1
      transactions.push({
        sourceId: `transfer:${sourceRowUid}`,
        sourceRowIds: [sourceRowUid, mirrorRowUid],
        type: 'transfer',
        amount,
        currency,
        occurredAt,
        accountSourceId: text(sourceRow.assetUid),
        destinationAccountSourceId: text(sourceRow.toAssetUid),
        description: cleanOptional(sourceRow.ZCONTENT) ?? description,
        note: cleanOptional(sourceRow.SMS_ORIGIN),
        tags: tagsByTransaction.get(sourceRowUid),
        sourceDoType: '3+4',
      })
      continue
    }

    // Codes 7/8 appear to be balance reconciliation rows in this backup ("Sự khác biệt"),
    // but their sign semantics are not documented reliably enough to import silently.
    if (doType === '7' || doType === '8') balanceAdjustmentRows += 1
    unsupportedRows.push({
      sourceId: sourceUid,
      doType,
      amount,
      occurredAt,
      description,
      accountSourceId: text(row.assetUid) || undefined,
      destinationAccountSourceId: text(row.toAssetUid) || undefined,
      categorySourceId: text(row.ctgUid) || undefined,
      currency,
      reason: 'unknown-transaction-type',
    })
  }

  const usesSpecialCategory = txRows.some((row) => text(row.ctgUid) === '-4')
  if (usesSpecialCategory) {
    categories.push({
      sourceId: '-4',
      name: 'Balance adjustment',
      kind: 'both',
    })
  }

  const photoReferences: ExternalImportPhotoReference[] = []
  if (tables.has('PHOTO')) {
    for (const row of queryRows(db, `
      SELECT uid, txUid, FILE_NAME, ORG_FILE_PATH, FILE_SIZE
      FROM PHOTO
      WHERE COALESCE(IS_DEL, 0) = 0
      ORDER BY DEVICE_ID
    `)) {
      const transactionSourceId = text(row.txUid)
      if (!transactionSourceId) continue
      photoReferences.push({
        sourceId: text(row.uid),
        transactionSourceId,
        fileName: cleanOptional(row.FILE_NAME),
        originalPath: cleanOptional(row.ORG_FILE_PATH),
        fileSize: finiteNumber(row.FILE_SIZE),
      })
    }
  }

  let dateRange: ExternalImportBundle['dateRange']
  const dates = transactions.map((item) => item.occurredAt).filter(Boolean).sort()
  if (dates.length) dateRange = { min: dates[0], max: dates[dates.length - 1] }

  const warnings: string[] = []
  if (photoReferences.length) warnings.push('photos-metadata-only')
  if (balanceAdjustmentRows) warnings.push('unknown-balance-adjustments')
  if (unsupportedRows.some((item) => item.reason === 'unpaired-transfer')) warnings.push('unpaired-transfers')

  return {
    adapterId: 'money-manager-android',
    adapterName: 'Money Manager',
    sourceSchemaVersion,
    sourceFileName: fileName,
    accounts,
    categories,
    transactions,
    unsupportedRows,
    photoReferences,
    dateRange,
    stats: {
      rawTransactions: txRows.length,
      incomeRows,
      expenseRows,
      transferPairs,
      balanceAdjustmentRows,
      skippedRows: unsupportedRows.length,
    },
    warnings,
  }
}

ctx.onmessage = async (event: MessageEvent<ExternalImportWorkerRequest>) => {
  if (!event.data || event.data.type !== 'parse') return
  let db: Database | undefined
  try {
    if (event.data.buffer.byteLength > SECURITY_LIMITS.maxSqliteImportBytes) throw new Error('error.importTooLarge')
    const header = new Uint8Array(event.data.buffer, 0, Math.min(16, event.data.buffer.byteLength))
    const expected = new TextEncoder().encode('SQLite format 3\0')
    if (header.length < expected.length || !expected.every((value, index) => header[index] === value)) {
      throw new Error('error.importNotSqlite')
    }
    const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl })
    db = new SQL.Database(new Uint8Array(event.data.buffer))
    const bundle = parseMoneyManager(db, event.data.fileName)
    const response: ExternalImportWorkerResponse = { type: 'result', bundle }
    ctx.postMessage(response)
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith('error.')
      ? error.message
      : 'error.importReadFailed'
    const response: ExternalImportWorkerResponse = { type: 'error', message }
    ctx.postMessage(response)
  } finally {
    db?.close()
  }
}

export {}
