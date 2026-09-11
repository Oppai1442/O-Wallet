import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Database, FileUp, ImageOff, LoaderCircle, RefreshCw } from 'lucide-react'
import { useWallet } from '../WalletContext'
import { localizeError, useI18n } from '../i18n'
import { findDuplicateTransaction } from '../lib/duplicates'
import { parseExternalBackup } from '../lib/importers/client'
import type { ExternalImportBundle, ExternalImportTransaction, ExternalImportUnsupportedRow } from '../lib/importers/types'
import type { Account, Category, Transaction, TransactionType, WalletEntity } from '../types'
import { Button, Card, Select } from './ui'

type UnknownTypeMapping = 'skip' | 'income' | 'expense'

interface ImportResult {
  importedTransactions: number
  updatedTransactions: number
  skippedExact: number
  skippedPossible: number
  createdAccounts: number
  createdCategories: number
  skippedUnsupported: number
}

function normalizedName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function externalEntityId(adapterId: string, kind: 'account' | 'category' | 'transaction', sourceId: string) {
  return `import:${adapterId}:${kind}:${sourceId}`
}

function categoryKindCompatible(existing: Category['kind'], incoming: Category['kind']) {
  return existing === incoming || existing === 'both' || incoming === 'both'
}

function combinedCategoryKind(a: Category['kind'], b: Category['kind']): Category['kind'] {
  return a === b ? a : 'both'
}

function unsupportedToTransaction(
  row: ExternalImportUnsupportedRow,
  mapping: UnknownTypeMapping,
): ExternalImportTransaction | undefined {
  if (mapping === 'skip' || !row.occurredAt || !row.accountSourceId || !row.currency || row.amount <= 0) return undefined
  return {
    sourceId: row.sourceId,
    sourceRowIds: [row.sourceId],
    type: mapping,
    amount: row.amount,
    currency: row.currency,
    occurredAt: row.occurredAt,
    accountSourceId: row.accountSourceId,
    categorySourceId: row.categorySourceId,
    description: row.description,
    sourceDoType: row.doType,
  }
}

export function ExternalImport() {
  const { accounts, categories, transactions, saveEntities } = useWallet()
  const { t, locale } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [bundle, setBundle] = useState<ExternalImportBundle>()
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<ImportResult>()
  const [mergeByName, setMergeByName] = useState(true)
  const [onlyUsedCategories, setOnlyUsedCategories] = useState(true)
  const [skipExact, setSkipExact] = useState(true)
  const [skipPossible, setSkipPossible] = useState(false)
  const [type7Mapping, setType7Mapping] = useState<UnknownTypeMapping>('skip')
  const [type8Mapping, setType8Mapping] = useState<UnknownTypeMapping>('skip')

  const unknown7 = bundle?.unsupportedRows.filter((row) => row.doType === '7' && row.reason === 'unknown-transaction-type') ?? []
  const unknown8 = bundle?.unsupportedRows.filter((row) => row.doType === '8' && row.reason === 'unknown-transaction-type') ?? []
  const unpairedTransfers = bundle?.unsupportedRows.filter((row) => row.reason === 'unpaired-transfer').length ?? 0
  const invalidRows = bundle?.unsupportedRows.filter((row) => row.reason === 'invalid-row').length ?? 0
  const selectedAmbiguousCount = (type7Mapping === 'skip' ? 0 : unknown7.length) + (type8Mapping === 'skip' ? 0 : unknown8.length)
  const importableTransactionCount = (bundle?.transactions.length ?? 0) + selectedAmbiguousCount
  const ambiguousBackupHint = locale.startsWith('vi')
    ? 'Tệp sao lưu có một số giao dịch dùng mã nội bộ mà ý nghĩa thu/chi không đủ chắc chắn để O-Wallet tự đoán. Có thể bỏ qua hoặc tự chọn cách nhập.'
    : 'This backup contains a few records with internal codes whose income/expense meaning is not reliable enough for O-Wallet to guess. You can skip them or choose how they should be imported.'

  const sampleTransactions = useMemo(() => bundle?.transactions.slice(0, 5) ?? [], [bundle])

  async function chooseFile(file?: File) {
    if (!file) return
    setReading(true)
    setError(undefined)
    setResult(undefined)
    setBundle(undefined)
    setFileName(file.name)
    try {
      const parsed = await parseExternalBackup(file)
      setBundle(parsed)
    } catch (readError) {
      setError(localizeError(readError, t, 'error.importReadFailed'))
    } finally {
      setReading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function displaySourceCategoryName(source: ExternalImportBundle['categories'][number]) {
    if (source.sourceId === '-4') return t('import.balanceAdjustmentCategory')
    return source.parentName ? `${source.parentName} / ${source.name}` : source.name
  }

  function ambiguousExamples(rows: ExternalImportUnsupportedRow[]) {
    return rows.slice(0, 3).map((row) => {
      const account = bundle?.accounts.find((item) => item.sourceId === row.accountSourceId)
      return (
        <div key={row.sourceId} className="grid min-w-0 grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded-lg bg-white/70 px-2.5 py-2 text-[11px] dark:bg-stone-950/50">
          <span className="font-semibold text-stone-700 dark:text-stone-200">{new Intl.NumberFormat(locale).format(row.amount)} {row.currency || 'VND'}</span>
          <span className="min-w-0 truncate text-right text-stone-500">{row.occurredAt ? new Date(row.occurredAt).toLocaleDateString(locale) : '—'}</span>
          <span className="col-span-2 min-w-0 break-words text-stone-500">{account?.name ?? t('transactions.unknownAccount')} · {row.description || t('transaction.noDescription')}</span>
        </div>
      )
    })
  }

  async function runImport() {
    if (!bundle || importing) return
    setImporting(true)
    setError(undefined)
    setResult(undefined)
    try {
      const now = new Date().toISOString()
      const adapterId = bundle.adapterId
      const syntheticUnknown = [
        ...unknown7.map((row) => unsupportedToTransaction(row, type7Mapping)).filter(Boolean),
        ...unknown8.map((row) => unsupportedToTransaction(row, type8Mapping)).filter(Boolean),
      ] as ExternalImportTransaction[]
      const sourceTransactions = [...bundle.transactions, ...syntheticUnknown]

      const accountMap = new Map<string, string>()
      const newAccounts: Account[] = []
      const allAccounts = [...accounts]
      for (const source of bundle.accounts) {
        const match = mergeByName
          ? allAccounts.find((account) => normalizedName(account.name) === normalizedName(source.name) && account.currency === source.currency)
          : undefined
        if (match) {
          accountMap.set(source.sourceId, match.id)
          continue
        }
        const id = externalEntityId(bundle.adapterId, 'account', source.sourceId)
        const previous = allAccounts.find((account) => account.id === id)
        if (previous) {
          accountMap.set(source.sourceId, previous.id)
          continue
        }
        const account: Account = {
          id,
          name: source.name,
          currency: source.currency || 'VND',
          openingBalance: 0,
          archived: false,
          createdAt: now,
          updatedAt: now,
          deleted: false,
        }
        newAccounts.push(account)
        allAccounts.push(account)
        accountMap.set(source.sourceId, account.id)
      }

      const usedCategoryIds = new Set(sourceTransactions.map((tx) => tx.categorySourceId).filter(Boolean) as string[])
      const categoryMap = new Map<string, string>()
      const newCategories: Category[] = []
      const allCategories = [...categories]
      const sourceCategories = onlyUsedCategories
        ? bundle.categories.filter((category) => usedCategoryIds.has(category.sourceId))
        : bundle.categories

      for (const source of sourceCategories) {
        const name = displaySourceCategoryName(source)
        const match = mergeByName
          ? allCategories.find((category) => normalizedName(category.name) === normalizedName(name) && categoryKindCompatible(category.kind, source.kind))
          : undefined
        if (match) {
          categoryMap.set(source.sourceId, match.id)
          continue
        }

        const sameNew = newCategories.find((category) => normalizedName(category.name) === normalizedName(name))
        if (sameNew) {
          sameNew.kind = combinedCategoryKind(sameNew.kind, source.kind)
          categoryMap.set(source.sourceId, sameNew.id)
          continue
        }

        const id = externalEntityId(bundle.adapterId, 'category', source.sourceId)
        const previous = allCategories.find((category) => category.id === id)
        if (previous) {
          categoryMap.set(source.sourceId, previous.id)
          continue
        }
        const category: Category = {
          id,
          name,
          nodeType: 'item',
          icon: 'Database',
          kind: source.kind,
          archived: false,
          createdAt: now,
          updatedAt: now,
          deleted: false,
        }
        newCategories.push(category)
        allCategories.push(category)
        categoryMap.set(source.sourceId, category.id)
      }

      function fallbackCategoryId(type: TransactionType) {
        const compatible = allCategories.find((category) => type === 'transfer' || category.kind === type || category.kind === 'both')
        if (compatible) return compatible.id
        const kind: Category['kind'] = type === 'transfer' ? 'both' : type
        const id = externalEntityId(adapterId, 'category', `fallback:${kind}`)
        const previous = allCategories.find((category) => category.id === id)
        if (previous) return previous.id
        const category: Category = {
          id,
          name: t('import.otherCategory'),
          nodeType: 'item',
          icon: 'Database',
          kind,
          archived: false,
          createdAt: now,
          updatedAt: now,
          deleted: false,
        }
        newCategories.push(category)
        allCategories.push(category)
        return id
      }

      const importedBySource = new Map(
        transactions
          .filter((tx) => tx.importSource?.adapterId === bundle.adapterId)
          .map((tx) => [tx.importSource!.sourceId, tx]),
      )
      const newTransactions: Transaction[] = []
      let importedTransactions = 0
      let updatedTransactions = 0
      let skippedExact = 0
      let skippedPossible = 0

      for (const source of sourceTransactions) {
        const accountId = accountMap.get(source.accountSourceId)
        if (!accountId) continue
        const destinationAccountId = source.destinationAccountSourceId
          ? accountMap.get(source.destinationAccountSourceId)
          : undefined
        if (source.type === 'transfer' && (!destinationAccountId || destinationAccountId === accountId)) continue

        const categoryId = source.categorySourceId
          ? categoryMap.get(source.categorySourceId) ?? fallbackCategoryId(source.type)
          : fallbackCategoryId(source.type)
        const previousImport = importedBySource.get(source.sourceId)
        const candidate: Transaction = {
          id: previousImport?.id ?? externalEntityId(bundle.adapterId, 'transaction', source.sourceId),
          type: source.type,
          amount: source.amount,
          currency: source.currency,
          occurredAt: source.occurredAt,
          categoryId,
          accountId,
          destinationAccountId,
          merchant: source.merchant,
          description: source.description,
          note: source.note,
          tags: source.tags,
          imageIds: previousImport?.imageIds ?? [],
          createdAt: previousImport?.createdAt ?? now,
          updatedAt: now,
          deleted: false,
          importSource: {
            adapterId: bundle.adapterId,
            sourceId: source.sourceId,
            sourceRowIds: source.sourceRowIds,
            sourceFileName: bundle.sourceFileName,
          },
        }

        if (!previousImport) {
          const duplicate = findDuplicateTransaction(candidate, transactions)
          if (duplicate?.level === 'exact' && skipExact) {
            skippedExact += 1
            continue
          }
          if (duplicate?.level === 'possible' && skipPossible) {
            skippedPossible += 1
            continue
          }
          importedTransactions += 1
        } else {
          updatedTransactions += 1
        }
        newTransactions.push(candidate)
      }

      const entities: WalletEntity[] = [...newAccounts, ...newCategories, ...newTransactions]
      if (entities.length) await saveEntities<WalletEntity>(entities)

      const mappedUnknown = syntheticUnknown.length
      const skippedUnsupported = Math.max(0, bundle.unsupportedRows.length - mappedUnknown)
      setResult({
        importedTransactions,
        updatedTransactions,
        skippedExact,
        skippedPossible,
        createdAccounts: newAccounts.length,
        createdCategories: newCategories.length,
        skippedUnsupported,
      })
    } catch (importError) {
      setError(localizeError(importError, t, 'import.importError'))
    } finally {
      setImporting(false)
    }
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Database size={18} className="text-blue-500" />
            <h2 className="font-bold text-stone-900 dark:text-white">{t('import.title')}</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-500">{t('import.hint')}</p>
        </div>
      </div>

      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept=".mmbak,.db,.sqlite,.sqlite3,application/x-sqlite3"
        onChange={(event) => void chooseFile(event.target.files?.[0])}
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={reading || importing}>
          {reading ? <LoaderCircle size={17} className="animate-spin" /> : <FileUp size={17} />}
          {reading ? t('import.reading') : t('import.chooseFile')}
        </Button>
        {bundle && <Button variant="ghost" onClick={() => inputRef.current?.click()} disabled={reading || importing}><RefreshCw size={16} /> {t('import.chooseAnother')}</Button>}
      </div>

      {fileName && <div className="mt-3 break-all text-xs text-stone-500">{fileName}</div>}
      {error && <div className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}

      {bundle && (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950"><div className="text-xs text-stone-500">{t('import.transactions')}</div><div className="mt-1 text-lg font-semibold text-stone-900 dark:text-white">{importableTransactionCount}</div><div className="text-xs text-stone-500">{t('import.fromRawRows', { count: bundle.stats.rawTransactions })}</div></div>
            <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950"><div className="text-xs text-stone-500">{t('import.accounts')}</div><div className="mt-1 text-lg font-semibold text-stone-900 dark:text-white">{bundle.accounts.length}</div></div>
            <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950"><div className="text-xs text-stone-500">{t('import.categories')}</div><div className="mt-1 text-lg font-semibold text-stone-900 dark:text-white">{bundle.categories.filter((item) => item.sourceId !== '-4').length}</div></div>
            <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950"><div className="text-xs text-stone-500">{t('import.transferPairs')}</div><div className="mt-1 text-lg font-semibold text-stone-900 dark:text-white">{bundle.stats.transferPairs}</div></div>
          </div>

          {bundle.dateRange && <div className="text-xs text-stone-500">{t('import.dateRange', { from: new Date(bundle.dateRange.min).toLocaleDateString(locale), to: new Date(bundle.dateRange.max).toLocaleDateString(locale) })}</div>}

          {bundle.photoReferences.length > 0 && (
            <div className="flex gap-3 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              <ImageOff size={18} className="mt-0.5 shrink-0" />
              <div>{t('import.photosMissing', { count: bundle.photoReferences.length })}</div>
            </div>
          )}

          {(unknown7.length > 0 || unknown8.length > 0) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/20 dark:bg-amber-500/5">
              <div className="flex items-start gap-2 text-sm font-bold text-amber-800 dark:text-amber-200"><AlertTriangle size={17} className="mt-0.5 shrink-0" /> {t('import.balanceAdjustmentTitle')}</div>
              <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-300">{ambiguousBackupHint}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {unknown7.length > 0 && <div className="min-w-0"><div className="mb-1 text-xs font-semibold text-stone-600 dark:text-stone-300">{t('import.sourceTypeCount', { type: 'A', count: unknown7.length })}</div><Select value={type7Mapping} onChange={(e) => setType7Mapping(e.target.value as UnknownTypeMapping)}><option value="skip">{t('import.mappingSkip')}</option><option value="income">{t('transaction.income')}</option><option value="expense">{t('transaction.expense')}</option></Select><div className="mt-2 text-[11px] font-semibold text-amber-800/80 dark:text-amber-200/80">{t('import.examples')}</div><div className="mt-1 space-y-1">{ambiguousExamples(unknown7)}</div></div>}
                {unknown8.length > 0 && <div className="min-w-0"><div className="mb-1 text-xs font-semibold text-stone-600 dark:text-stone-300">{t('import.sourceTypeCount', { type: 'B', count: unknown8.length })}</div><Select value={type8Mapping} onChange={(e) => setType8Mapping(e.target.value as UnknownTypeMapping)}><option value="skip">{t('import.mappingSkip')}</option><option value="income">{t('transaction.income')}</option><option value="expense">{t('transaction.expense')}</option></Select><div className="mt-2 text-[11px] font-semibold text-amber-800/80 dark:text-amber-200/80">{t('import.examples')}</div><div className="mt-1 space-y-1">{ambiguousExamples(unknown8)}</div></div>}
              </div>
            </div>
          )}

          {(unpairedTransfers > 0 || invalidRows > 0) && <div className="rounded-xl bg-stone-50 p-3 text-xs leading-5 text-stone-500 dark:bg-stone-950">{t('import.unsupportedRows', { count: unpairedTransfers + invalidRows })}</div>}

          <div className="grid gap-2 md:grid-cols-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 p-3 dark:border-stone-800"><input className="mt-1" type="checkbox" checked={mergeByName} onChange={(e) => setMergeByName(e.target.checked)} /><span><span className="block text-sm font-semibold text-stone-800 dark:text-stone-100">{t('import.mergeByName')}</span><span className="mt-0.5 block text-xs leading-5 text-stone-500">{t('import.mergeByNameHint')}</span></span></label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 p-3 dark:border-stone-800"><input className="mt-1" type="checkbox" checked={onlyUsedCategories} onChange={(e) => setOnlyUsedCategories(e.target.checked)} /><span><span className="block text-sm font-semibold text-stone-800 dark:text-stone-100">{t('import.onlyUsedCategories')}</span><span className="mt-0.5 block text-xs leading-5 text-stone-500">{t('import.onlyUsedCategoriesHint')}</span></span></label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 p-3 dark:border-stone-800"><input className="mt-1" type="checkbox" checked={skipExact} onChange={(e) => setSkipExact(e.target.checked)} /><span><span className="block text-sm font-semibold text-stone-800 dark:text-stone-100">{t('import.skipExact')}</span><span className="mt-0.5 block text-xs leading-5 text-stone-500">{t('import.skipExactHint')}</span></span></label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 p-3 dark:border-stone-800"><input className="mt-1" type="checkbox" checked={skipPossible} onChange={(e) => setSkipPossible(e.target.checked)} /><span><span className="block text-sm font-semibold text-stone-800 dark:text-stone-100">{t('import.skipPossible')}</span><span className="mt-0.5 block text-xs leading-5 text-stone-500">{t('import.skipPossibleHint')}</span></span></label>
          </div>

          {sampleTransactions.length > 0 && (
            <div>
              <div className="text-sm font-bold text-stone-800 dark:text-stone-100">{t('import.preview')}</div>
              <div className="mt-2 overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800">
                {sampleTransactions.map((tx) => {
                  const sourceAccount = bundle.accounts.find((account) => account.sourceId === tx.accountSourceId)
                  return <div key={tx.sourceId} className="grid gap-1 border-b border-stone-100 px-3 py-2 text-xs last:border-b-0 dark:border-stone-800 sm:grid-cols-[110px_110px_1fr]"><div className="font-semibold text-stone-700 dark:text-stone-200">{new Intl.NumberFormat(locale).format(tx.amount)} {tx.currency}</div><div className="text-stone-500">{new Date(tx.occurredAt).toLocaleDateString(locale)}</div><div className="min-w-0 truncate text-stone-500">{sourceAccount?.name ?? t('transactions.unknownAccount')} · {tx.description || t('transaction.noDescription')}</div></div>
                })}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void runImport()} disabled={importing || importableTransactionCount === 0}>
              {importing ? <LoaderCircle size={17} className="animate-spin" /> : <FileUp size={17} />}
              {importing ? t('import.importing') : t('import.importButton')}
            </Button>
            <div className="text-xs leading-5 text-stone-500">{t('import.localOnly')}</div>
          </div>

          {result && (
            <div className="flex gap-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-bold">{t('import.done')}</div>
                <div className="mt-1 text-xs leading-5">{t('import.doneDetail', {
                  imported: result.importedTransactions,
                  updated: result.updatedTransactions,
                  accounts: result.createdAccounts,
                  categories: result.createdCategories,
                  duplicates: result.skippedExact + result.skippedPossible,
                  skipped: result.skippedUnsupported,
                })}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
