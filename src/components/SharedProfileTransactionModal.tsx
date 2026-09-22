import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, CalendarDays, Images, Mic, Repeat2, ScanText, Sparkles, Square, X } from 'lucide-react'
import type {
  AppSettings,
  OcrDetectedLine,
  OcrField,
  OcrRegion,
  OcrResult,
  OcrTemplate,
  SharedTransaction,
  SharedWalletLedger,
  SharedWalletMembership,
  Transaction,
  TransactionType,
} from '../types'
import { useWallet } from '../WalletContext'
import { localizeError, useI18n } from '../i18n'
import { AI_OPENROUTER_KEY_SECRET, analyzeTransactionImage } from '../lib/ai'
import { selectableCategories } from '../lib/categories'
import { findDuplicateTransaction } from '../lib/duplicates'
import { imageImportRecordId } from '../lib/importIdentity'
import { fromLocalInputDateTime, toLocalInputDateTime } from '../lib/format'
import { buildDetectedLines, buildPatternTemplate, parseTransactionFromOcr, parseTransactionFromRegions, recognizeImageTiled } from '../lib/ocr'
import { mapDetectedLinesToRegions } from '../lib/ocrHeuristics'
import { findMatchingTransactionRule } from '../lib/rules'
import { combineLocalDateAndTime, localDateKeyFromInputDateTime, localTimeFromInputDateTime, localWeekday, recurringDateKeys } from '../lib/scheduling'
import { validateImageBatch } from '../lib/security'
import { saveSharedTransaction, saveSharedTransactions, type SharedTransactionInput } from '../lib/sharedWallet'
import { sharedTransactionsAsPersonalShape } from '../lib/sharedLedger'
import { AccountSelect } from './AccountSelect'
import { BatchOcrReview, type BatchOcrDraft } from './BatchOcrReview'
import { Button, Input, Label, Select, Textarea } from './ui'
import { CategoryPicker } from './CategoryPicker'
import { ImageImportMode, type ImageImportSettings } from './ImageImportMode'
import { MultiDatePicker } from './MultiDatePicker'
import { OcrTeachingPanel } from './OcrTeachingPanel'
import { VoiceEntry, type VoiceEntryDraft } from './VoiceEntry'

const OcrRegionEditor = lazy(() => import('./OcrRegionEditor').then((module) => ({ default: module.OcrRegionEditor })))

function profileSettings(ledger: SharedWalletLedger, personal?: AppSettings): ImageImportSettings {
  return {
    defaultCurrency: ledger.defaultCurrency,
    transactionCurrency: personal?.transactionCurrency ?? ledger.defaultCurrency,
    accountCatalogues: ledger.accountCatalogues,
    transactionRules: ledger.transactionRules,
    ocrTemplates: ledger.ocrTemplates ?? [],
    transactionDefaults: ledger.transactionDefaults,
  }
}

function uniqueTags(raw: string) {
  return [...new Set(raw.split(/[,;#\n]/).map((item) => item.trim()).filter(Boolean))].slice(0, 20)
}

export function SharedProfileTransactionModal({
  membership,
  ledger,
  transactions,
  transaction,
  initialVoice = false,
  onClose,
  onSaved,
  onSaveLedger,
}: {
  membership: SharedWalletMembership
  ledger: SharedWalletLedger
  transactions: SharedTransaction[]
  transaction?: SharedTransaction
  initialVoice?: boolean
  onClose: () => void
  onSaved: () => void
  onSaveLedger: (ledger: SharedWalletLedger) => Promise<void>
}) {
  const { googleSession, settings: personalSettings, repository } = useWallet()
  const { t, locale } = useI18n()
  const adaptedSettings = profileSettings(ledger, personalSettings)
  const editing = Boolean(transaction)
  const [type, setType] = useState<TransactionType>(transaction?.type ?? 'expense')
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : '')
  const [currency, setCurrency] = useState(transaction?.currency ?? ledger.defaultCurrency)
  const initialOccurredAt = transaction ? toLocalInputDateTime(transaction.occurredAt) : toLocalInputDateTime()
  const initialDate = localDateKeyFromInputDateTime(initialOccurredAt)
  const [occurredAt, setOccurredAt] = useState(initialOccurredAt)
  const [creationMode, setCreationMode] = useState<'single' | 'multiple' | 'repeat'>('single')
  const [batchTime, setBatchTime] = useState(localTimeFromInputDateTime(initialOccurredAt))
  const [selectedDates, setSelectedDates] = useState<string[]>([initialDate])
  const [repeatStartDate, setRepeatStartDate] = useState(initialDate)
  const [repeatUntilDate, setRepeatUntilDate] = useState(initialDate)
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[]>([localWeekday(initialDate)])
  const activeAccounts = ledger.accounts.filter((item) => !item.deleted && !item.archived)
  const activeCategories = ledger.categories.filter((item) => !item.deleted && !item.archived)
  const [accountId, setAccountId] = useState(transaction?.accountId ?? ledger.transactionDefaults?.accountId ?? activeAccounts[0]?.id ?? '')
  const [destinationAccountId, setDestinationAccountId] = useState(transaction?.destinationAccountId ?? activeAccounts.find((item) => item.id !== accountId)?.id ?? '')
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? ledger.transactionDefaults?.categoryId ?? '')
  const [merchant, setMerchant] = useState(transaction?.merchant ?? '')
  const [description, setDescription] = useState(transaction?.description ?? '')
  const [note, setNote] = useState(transaction?.note ?? '')
  const [tags, setTags] = useState((transaction?.tags ?? []).join(', '))
  const [files, setFiles] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [regions, setRegions] = useState<OcrRegion[]>([])
  const [showRegions, setShowRegions] = useState(false)
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>()
  const [templateId, setTemplateId] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [ocrBusy, setOcrBusy] = useState(false)
  const ocrAbortRef = useRef<AbortController | undefined>(undefined)
  const [aiBusy, setAiBusy] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrStatus, setOcrStatus] = useState('')
  const [ocrResult, setOcrResult] = useState<OcrResult>()
  const [detectedLines, setDetectedLines] = useState<OcrDetectedLine[]>([])
  const [lineMappings, setLineMappings] = useState<Record<string, OcrField | ''>>({})
  const [batchDrafts, setBatchDrafts] = useState<BatchOcrDraft[]>([])
  const [activeBatchId, setActiveBatchId] = useState<string>()
  const [showVoice, setShowVoice] = useState(initialVoice)
  const [addMode, setAddMode] = useState<'manual' | 'image'>('manual')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const templates = ledger.ocrTemplates ?? []
  const personalShape = useMemo(() => sharedTransactionsAsPersonalShape(transactions), [transactions])
  const eligibleCategories = useMemo(() => selectableCategories(activeCategories, type), [activeCategories, type])

  useEffect(() => {
    if (!activeAccounts.some((item) => item.id === accountId)) setAccountId(activeAccounts[0]?.id ?? '')
    if (!activeAccounts.some((item) => item.id === destinationAccountId) || destinationAccountId === accountId) {
      setDestinationAccountId(activeAccounts.find((item) => item.id !== accountId)?.id ?? '')
    }
  }, [activeAccounts, accountId, destinationAccountId])

  useEffect(() => {
    if (categoryId && !eligibleCategories.some((item) => item.id === categoryId)) setCategoryId('')
  }, [eligibleCategories, categoryId])

  useEffect(() => {
    if (!showRegions || !files[0]) {
      setPreviewUrls([])
      return
    }
    const url = URL.createObjectURL(files[0])
    setPreviewUrls([url])
    return () => URL.revokeObjectURL(url)
  }, [files, showRegions])

  useEffect(() => () => ocrAbortRef.current?.abort(), [])

  async function chooseImages(selected: File[]) {
    setError(undefined)
    try {
      await validateImageBatch(selected)
      setFiles(selected)
      setRegions([])
      setImageSize(undefined)
      setOcrResult(undefined)
      setDetectedLines([])
      setLineMappings({})
      setBatchDrafts([])
      setActiveBatchId(undefined)
    } catch (validationError) {
      setFiles([])
      setError(localizeError(validationError, t, 'error.imageInvalid'))
    }
  }

  function applyRule(parsedType: TransactionType, parsed: { amount?: number; merchant?: string; description?: string }) {
    const rule = findMatchingTransactionRule({ type: parsedType, amount: parsed.amount, merchant: parsed.merchant, description: parsed.description }, ledger.transactionRules)
    if (rule?.categoryId && selectableCategories(activeCategories, parsedType).some((item) => item.id === rule.categoryId)) setCategoryId(rule.categoryId)
    if (rule?.accountId && activeAccounts.some((item) => item.id === rule.accountId)) setAccountId(rule.accountId)
  }

  function applyParsed(parsed: ReturnType<typeof parseTransactionFromOcr>) {
    if (parsed.amount) setAmount(String(parsed.amount))
    if (parsed.occurredAt) {
      const local = toLocalInputDateTime(parsed.occurredAt)
      const date = localDateKeyFromInputDateTime(local)
      setOccurredAt(local)
      setBatchTime(localTimeFromInputDateTime(local))
      if (creationMode === 'repeat') {
        setRepeatStartDate(date)
        setRepeatUntilDate((current) => current < date ? date : current)
      }
    }
    if (parsed.merchant) setMerchant(parsed.merchant)
    if (parsed.description) setDescription(parsed.description)
    setType(parsed.type)
    applyRule(parsed.type, parsed)
  }

  async function runOcr() {
    if (!files[0]) return
    const controller = new AbortController()
    ocrAbortRef.current = controller
    setOcrBusy(true)
    setError(undefined)
    setOcrProgress(0)
    try {
      const ocr = await recognizeImageTiled(files[0], (progress, status) => {
        setOcrProgress(progress)
        setOcrStatus(status)
      }, { retries: 1, signal: controller.signal })
      const result = ocr.result
      const size = { width: ocr.width, height: ocr.height }
      setImageSize(size)
      setOcrResult(result)
      const lines = buildDetectedLines(result, size.width, size.height)
      const inferredMappings = mapDetectedLinesToRegions(lines, regions) as Record<string, OcrField | ''>
      setDetectedLines(lines)
      setLineMappings(inferredMappings)
      applyParsed(regions.length ? parseTransactionFromRegions(result, regions, size.width, size.height) : parseTransactionFromOcr(result))
    } catch (ocrError) {
      if ((ocrError as Error)?.name !== 'AbortError') setError(localizeError(ocrError, t, 'modal.errorOcr'))
    } finally {
      if (ocrAbortRef.current === controller) ocrAbortRef.current = undefined
      setOcrBusy(false)
    }
  }

  async function runAi() {
    if (!files[0] || !repository) return
    setAiBusy(true)
    setError(undefined)
    try {
      const endpoint = ledger.aiVision?.endpoint?.trim()
      const model = ledger.aiVision?.model?.trim()
      const apiKey = await repository.getLocalSecret(AI_OPENROUTER_KEY_SECRET)
      if (!endpoint || !model || !apiKey) throw new Error('error.aiNotConfigured')
      const parsed = await analyzeTransactionImage(files[0], { endpoint, model, apiKey })
      const nextType = parsed.type ?? type
      if (parsed.type) setType(parsed.type)
      if (parsed.amount !== undefined) setAmount(String(parsed.amount))
      if (parsed.currency) setCurrency(parsed.currency)
      if (parsed.occurredAt) {
        const local = toLocalInputDateTime(parsed.occurredAt)
        setOccurredAt(local)
        setBatchTime(localTimeFromInputDateTime(local))
      }
      if (parsed.merchant !== undefined) setMerchant(parsed.merchant)
      if (parsed.description !== undefined) setDescription(parsed.description)
      applyRule(nextType, parsed)
    } catch (aiError) {
      setError(localizeError(aiError, t, 'error.aiRequestFailed'))
    } finally {
      setAiBusy(false)
    }
  }

  function applyTemplate(id: string) {
    setTemplateId(id)
    const template = templates.find((item) => item.id === id)
    if (!template) return
    setRegions(template.regions.map((region) => ({ ...region, id: crypto.randomUUID() })))
    setShowRegions(true)
  }

  async function saveTemplate() {
    if (!regions.length || !templateName.trim()) return
    const now = new Date().toISOString()
    const name = templateName.trim().slice(0, 120)
    const aspectRatio = imageSize ? imageSize.width / imageSize.height : undefined
    const fallbackRegions = regions.map((region) => ({ ...region, id: crypto.randomUUID(), sourceLineId: undefined }))
    const semanticMappings = Object.values(lineMappings).filter((field) => field && field !== 'generic' && field !== 'ignore')
    const pattern = detectedLines.length && semanticMappings.length >= 2
      ? buildPatternTemplate(name, detectedLines, lineMappings)
      : undefined
    const template: OcrTemplate = pattern
      ? {
        ...pattern,
        aspectRatio,
        aspectRatios: aspectRatio ? [aspectRatio] : pattern.aspectRatios,
        regions: fallbackRegions,
        createdAt: now,
        updatedAt: now,
      }
      : {
        id: crypto.randomUUID(),
        name,
        schemaVersion: 1,
        aspectRatio,
        regions: fallbackRegions,
        createdAt: now,
        updatedAt: now,
      }
    await onSaveLedger({ ...ledger, ocrTemplates: [...templates, template] })
    setTemplateId(template.id)
    setTemplateName('')
  }

  function mapDetectedLine(line: OcrDetectedLine, field: OcrField | '') {
    setLineMappings((current) => ({ ...current, [line.id]: field }))
    const without = regions.filter((region) => region.sourceLineId !== line.id)
    const next = field ? [...without, {
      id: crypto.randomUUID(),
      field,
      x: Math.max(0, line.x - 0.006),
      y: Math.max(0, line.y - 0.004),
      width: Math.min(1 - Math.max(0, line.x - 0.006), line.width + 0.012),
      height: Math.min(1 - Math.max(0, line.y - 0.004), line.height + 0.008),
      stripLabel: field !== 'generic' && field !== 'ignore',
      sourceLineId: line.id,
    } satisfies OcrRegion] : without
    setRegions(next)
    setShowRegions(true)
    if (ocrResult && imageSize) applyParsed(parseTransactionFromRegions(ocrResult, next, imageSize.width, imageSize.height))
  }

  async function runBatchOcr() {
    if (!files.length || editing) return
    const controller = new AbortController()
    ocrAbortRef.current = controller
    setOcrBusy(true)
    setError(undefined)
    setBatchDrafts([])
    try {
      const drafts: BatchOcrDraft[] = []
      const batchCandidates: Transaction[] = []
      const existingIds = new Set(personalShape.map((item) => item.id))
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        const ocr = await recognizeImageTiled(file, (progress, status) => { setOcrProgress((index + progress) / files.length); setOcrStatus(`${index + 1}/${files.length} · ${status}`) }, { retries: 1, signal: controller.signal })
        const result = ocr.result
        const size = { width: ocr.width, height: ocr.height }
        const parsed = regions.length ? parseTransactionFromRegions(result, regions, size.width, size.height) : parseTransactionFromOcr(result)
        const local = parsed.occurredAt ? toLocalInputDateTime(parsed.occurredAt) : occurredAt
        const compatible = selectableCategories(activeCategories, parsed.type)
        const rule = findMatchingTransactionRule({ type: parsed.type, amount: parsed.amount, merchant: parsed.merchant, description: parsed.description }, ledger.transactionRules)
        const resolvedCategory = rule?.categoryId && compatible.some((item) => item.id === rule.categoryId) ? rule.categoryId : compatible.some((item) => item.id === categoryId) ? categoryId : compatible[0]?.id ?? ''
        const resolvedAccount = rule?.accountId && activeAccounts.some((item) => item.id === rule.accountId) ? rule.accountId : activeAccounts.some((item) => item.id === accountId) ? accountId : activeAccounts[0]?.id ?? ''
        const occurredIso = fromLocalInputDateTime(local)
        const conflict = parsed.amount ? findDuplicateTransaction({ type: parsed.type, amount: parsed.amount, occurredAt: occurredIso, accountId: resolvedAccount, merchant: parsed.merchant, description: parsed.description }, [...personalShape, ...batchCandidates]) : undefined
        const id = crypto.randomUUID()
        drafts.push({
          id,
          fileIndex: index,
          selected: conflict?.level !== 'exact',
          type: parsed.type,
          amount: parsed.amount ? String(parsed.amount) : '',
          currency,
          occurredAt: local,
          categoryId: resolvedCategory,
          accountId: resolvedAccount,
          destinationAccountId: parsed.type === 'transfer' ? activeAccounts.find((item) => item.id !== resolvedAccount)?.id : undefined,
          merchant: parsed.merchant ?? '',
          balanceAfter: '',
          description: parsed.description ?? '',
          rawText: parsed.rawText,
          sourceBBox: { x: 0, y: 0, width: size.width, height: size.height },
          sourceWidth: size.width,
          sourceHeight: size.height,
          confidence: result.boxes.length ? result.boxes.reduce((sum, box) => sum + box.confidence, 0) / result.boxes.length : undefined,
          conflict: conflict ? { level: conflict.level, source: existingIds.has(conflict.transaction.id) ? 'existing' : 'batch', transactionId: conflict.transaction.id, occurredAt: conflict.transaction.occurredAt, amount: conflict.transaction.amount, merchant: conflict.transaction.merchant } : undefined,
        })
        if (parsed.amount) batchCandidates.push({ id, type: parsed.type, amount: parsed.amount, currency, occurredAt: occurredIso, categoryId: resolvedCategory, accountId: resolvedAccount, destinationAccountId: parsed.type === 'transfer' ? activeAccounts.find((item) => item.id !== resolvedAccount)?.id : undefined, merchant: parsed.merchant, description: parsed.description, imageIds: [], createdAt: occurredIso, updatedAt: occurredIso, deleted: false })
      }
      setBatchDrafts(drafts)
      setActiveBatchId(drafts[0]?.id)
      setOcrProgress(1)
    } catch (ocrError) {
      if ((ocrError as Error)?.name !== 'AbortError') setError(localizeError(ocrError, t, 'modal.errorOcr'))
    } finally {
      if (ocrAbortRef.current === controller) ocrAbortRef.current = undefined
      setOcrBusy(false)
    }
  }

  function updateBatchDraft(next: BatchOcrDraft) {
    const compatible = selectableCategories(activeCategories, next.type)
    setBatchDrafts((current) => current.map((item) => item.id === next.id ? { ...next, categoryId: compatible.some((category) => category.id === next.categoryId) ? next.categoryId : compatible[0]?.id ?? '' } : item))
  }

  async function saveBatch() {
    if (!googleSession) return
    const selected = batchDrafts.filter((item) => item.selected)
    if (!selected.length) return setError(t('batch.errorNoneSelected'))
    for (const draft of selected) {
      if (!(Number(draft.amount) > 0) || !draft.accountId || !draft.occurredAt) return setError(t('batch.errorInvalidDraft'))
      if (draft.type === 'transfer' && (!draft.destinationAccountId || draft.destinationAccountId === draft.accountId)) return setError(t('modal.errorTransferAccounts'))
    }
    setSaving(true)
    try {
      const batchId = selected.length > 1 ? crypto.randomUUID() : undefined
      await saveSharedTransactions(googleSession.accessToken, membership, selected.map((draft,index) => ({
        id: crypto.randomUUID(),
        type: draft.type,
        amount: Number(draft.amount),
        currency: draft.currency || ledger.defaultCurrency,
        occurredAt: fromLocalInputDateTime(draft.occurredAt),
        accountId: draft.accountId,
        destinationAccountId: draft.type === 'transfer' ? draft.destinationAccountId : undefined,
        categoryId: draft.categoryId || undefined,
        merchant: draft.merchant.trim() || undefined,
        balanceAfter: draft.balanceAfter ? Number(draft.balanceAfter) : undefined,
        description: draft.description.trim() || undefined,
        note: note.trim() || undefined,
        tags: uniqueTags(tags),
        batch: batchId ? { id: batchId, mode: 'ocr-batch', index, count: selected.length } : undefined,
      })))
      onSaved(); onClose()
    } catch (saveError) {
      setError(localizeError(saveError, t, 'error.sharedSaveFailed'))
    } finally { setSaving(false) }
  }

  function plannedOccurrences() {
    if (editing || creationMode === 'single') return [fromLocalInputDateTime(occurredAt)]
    if (creationMode === 'multiple') return [...new Set(selectedDates)].sort().map((date) => combineLocalDateAndTime(date, batchTime))
    return recurringDateKeys(repeatStartDate, repeatUntilDate, repeatWeekdays).map((date) => combineLocalDateAndTime(date, batchTime))
  }

  async function save() {
    if (!googleSession || !(Number(amount) > 0) || !accountId) return setError(t('modal.errorMissingFields'))
    if (type === 'transfer' && (!destinationAccountId || destinationAccountId === accountId)) return setError(t('modal.errorTransferAccounts'))
    const times = plannedOccurrences()
    if (!times.length) return setError(t('schedule.errorNoOccurrences'))
    if (times.length > 5000) return setError(t('schedule.errorTooMany'))
    setSaving(true)
    setError(undefined)
    try {
      for (const [index, time] of times.entries()) {
        await saveSharedTransaction(googleSession.accessToken, membership, {
          id: editing ? transaction!.id : crypto.randomUUID(),
          type,
          amount: Number(amount),
          currency: currency.trim().toUpperCase() || ledger.defaultCurrency,
          occurredAt: time,
          accountId,
          destinationAccountId: type === 'transfer' ? destinationAccountId : undefined,
          categoryId: categoryId || undefined,
          merchant: merchant.trim() || undefined,
          description: description.trim() || undefined,
          note: note.trim() || undefined,
          tags: uniqueTags(tags),
          createdAt: editing ? transaction!.createdAt : undefined,
          sourceCreatedByMemberId: editing ? transaction?.sourceCreatedByMemberId : undefined,
          sourceCreatedByName: editing ? transaction?.sourceCreatedByName : undefined,
        })
        if (editing || index >= times.length - 1) break
      }
      onSaved(); onClose()
    } catch (saveError) {
      setError(localizeError(saveError, t, 'error.sharedSaveFailed'))
    } finally { setSaving(false) }
  }

  async function saveImageImportDrafts(drafts: BatchOcrDraft[], sourceFiles: File[]) {
    if (!googleSession) throw new Error('error.sharedSaveFailed')
    const now = new Date().toISOString()
    const batchId = drafts.length > 1 ? crypto.randomUUID() : undefined
    const records = await Promise.all(drafts.map(async (draft, index): Promise<SharedTransactionInput> => {
      const sourceRowIds = draft.sourceRowIds?.length ? draft.sourceRowIds : draft.sourceRowId ? [draft.sourceRowId] : []
      return {
      id: draft.sourceHash && sourceRowIds.length ? await imageImportRecordId(draft.sourceHash, sourceRowIds) : crypto.randomUUID(),
      type: draft.type,
      amount: Number(draft.amount),
      currency: draft.currency || ledger.defaultCurrency,
      occurredAt: fromLocalInputDateTime(draft.occurredAt),
      accountId: draft.accountId,
      destinationAccountId: draft.type === 'transfer' ? draft.destinationAccountId : undefined,
      categoryId: draft.categoryId || undefined,
      merchant: draft.merchant.trim() || undefined,
      balanceAfter: draft.balanceAfter ? Number(draft.balanceAfter) : undefined,
      description: draft.description.trim() || undefined,
      note: note.trim() || undefined,
      tags: uniqueTags(tags),
      batch: batchId ? { id: batchId, mode: 'ocr-batch', index, count: drafts.length } : undefined,
      importSource: draft.sourceHash ? {
        adapterId: 'owallet-image-v2',
        sourceId: draft.sourceHash,
        sourceRowIds: draft.sourceRowIds?.length ? draft.sourceRowIds : draft.sourceRowId ? [draft.sourceRowId] : [],
        sourceFileName: sourceFiles[draft.fileIndex]?.name,
      } : undefined,
      createdAt: now,
    }
    }))
    await saveSharedTransactions(googleSession.accessToken, membership, records)
    onSaved()
  }

  const voiceDraft: VoiceEntryDraft = {
    type,
    amount,
    date: localDateKeyFromInputDateTime(occurredAt),
    time: localTimeFromInputDateTime(occurredAt),
    accountId,
    destinationAccountId,
    categoryId,
    merchant,
    description,
  }

  const transientHint = locale === 'vi'
    ? 'Ảnh trong Shared Profile hiện chỉ được dùng tạm để OCR/AI trên lần nhập này; ảnh gốc chưa được lưu vào shared Drive.'
    : 'Shared Profile images are currently transient for OCR/AI during this entry; the original image is not stored in shared Drive yet.'
  const imagesTitle = locale === 'vi' ? 'Ảnh chụp / hóa đơn' : 'Images / receipts'

  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-stone-950/55 sm:items-center sm:p-4" onClick={onClose}>
    <div className="flex max-h-[100dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-stone-900 sm:max-h-[94dvh] sm:rounded-3xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex shrink-0 items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-800 sm:px-5">
        <div><div className="text-lg font-semibold">{editing ? t('shared.editTransaction') : t('shared.addTransaction')}</div><div className="text-xs text-stone-500">{locale === 'vi' ? 'Shared Profile · cùng luồng nhập như Personal Wallet' : 'Shared Profile · same entry workflow as Personal Wallet'}</div></div>
        <div className="flex gap-1"><Button variant="ghost" onClick={() => setShowVoice(true)}><Mic size={17} /></Button><Button variant="ghost" onClick={onClose}><X size={18} /></Button></div>
      </div>
      {!editing&&<div className="shrink-0 border-b border-stone-200 bg-white px-4 py-2 dark:border-stone-800 dark:bg-stone-900 sm:px-5"><div className="grid max-w-md grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-800"><button type="button" onClick={()=>setAddMode('manual')} className={`rounded-lg px-3 py-2 text-sm font-bold transition ${addMode==='manual'?'bg-white text-stone-900 shadow-sm dark:bg-stone-950 dark:text-white':'text-stone-500 dark:text-stone-400'}`}>{t('imageImport.modeManual')}</button><button type="button" onClick={()=>setAddMode('image')} className={`rounded-lg px-3 py-2 text-sm font-bold transition ${addMode==='image'?'bg-white text-stone-900 shadow-sm dark:bg-stone-950 dark:text-white':'text-stone-500 dark:text-stone-400'}`}>{t('imageImport.modeImage')}</button></div></div>}
      {!editing&&addMode==='image'?<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><ImageImportMode
        onClose={onClose}
        accountsOverride={activeAccounts}
        categoriesOverride={activeCategories}
        cataloguesOverride={ledger.accountCatalogues}
        settingsOverride={adaptedSettings}
        transactionsOverride={personalShape}
        checkpointKey={`image-import-v2:shared:${membership.groupId}`}
        onSaveTemplates={async (nextTemplates)=>{ await onSaveLedger({ ...ledger, ocrTemplates: nextTemplates }) }}
        onSaveDrafts={saveImageImportDrafts}
      /></div>:<>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        {!editing && <div className="mb-4 flex flex-wrap gap-2">
          <Button variant={creationMode === 'single' ? 'secondary' : 'ghost'} onClick={() => setCreationMode('single')}>{t('schedule.single')}</Button>
          <Button variant={creationMode === 'multiple' ? 'secondary' : 'ghost'} onClick={() => setCreationMode('multiple')}><CalendarDays size={15} />{t('schedule.multiple')}</Button>
          <Button variant={creationMode === 'repeat' ? 'secondary' : 'ghost'} onClick={() => setCreationMode('repeat')}><Repeat2 size={15} />{t('schedule.repeat')}</Button>
        </div>}

        {!editing && creationMode === 'multiple' && <div className="mb-5"><MultiDatePicker value={selectedDates} onChange={setSelectedDates} /></div>}
        {!editing && creationMode === 'repeat' && <div className="mb-5 grid gap-3 sm:grid-cols-2"><div><Label>{t('schedule.start')}</Label><Input type="date" value={repeatStartDate} onChange={(event) => setRepeatStartDate(event.target.value)} /></div><div><Label>{t('schedule.until')}</Label><Input type="date" value={repeatUntilDate} onChange={(event) => setRepeatUntilDate(event.target.value)} /></div><div className="sm:col-span-2"><Label>{t('schedule.weekdays')}</Label><div className="mt-2 flex flex-wrap gap-2">{[0,1,2,3,4,5,6].map((day) => <button type="button" key={day} className={`h-9 w-9 rounded-xl border text-xs font-semibold ${repeatWeekdays.includes(day) ? 'border-stone-950 bg-stone-950 text-white dark:border-white dark:bg-white dark:text-stone-950' : 'border-stone-200 dark:border-stone-700'}`} onClick={() => setRepeatWeekdays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day])}>{new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(2024, 0, 7 + day))}</button>)}</div></div></div>}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,.8fr)]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>{t('batch.type')}</Label><Select value={type} onChange={(event) => setType(event.target.value as TransactionType)}><option value="expense">{t('transaction.expense')}</option><option value="income">{t('transaction.income')}</option><option value="transfer">{t('transaction.transfer')}</option></Select></div>
              <div><Label>{t('modal.amount')}</Label><Input type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
              <div><Label>{t('modal.currency')}</Label><Input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></div>
              <div><Label>{t('modal.time')}</Label><Input type="datetime-local" value={occurredAt} onChange={(event) => { setOccurredAt(event.target.value); setBatchTime(localTimeFromInputDateTime(event.target.value)) }} /></div>
              <div><Label>{t('modal.account')}</Label><AccountSelect accounts={activeAccounts} catalogues={ledger.accountCatalogues} value={accountId} onChange={setAccountId} /></div>
              {type === 'transfer' && <div><Label>{t('modal.destinationAccount')}</Label><AccountSelect accounts={activeAccounts} catalogues={ledger.accountCatalogues} value={destinationAccountId} onChange={setDestinationAccountId} excludeId={accountId} /></div>}
              <div><Label>{t('modal.category')}</Label><CategoryPicker categories={activeCategories} type={type} value={categoryId} onChange={setCategoryId} placeholder={t('categoryPicker.placeholder')} /></div>
              <div><Label>{t('modal.merchant')}</Label><Input value={merchant} onChange={(event) => setMerchant(event.target.value)} /></div>
              <div className="sm:col-span-2"><Label>{t('modal.description')}</Label><Input value={description} onChange={(event) => setDescription(event.target.value)} /></div>
              <div className="sm:col-span-2"><Label>{t('modal.note')}</Label><Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></div>
              <div className="sm:col-span-2"><Label>{t('modal.tags')}</Label><Input value={tags} onChange={(event) => setTags(event.target.value)} /></div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-stone-200 p-4 dark:border-stone-800">
              <div className="flex items-center gap-2 font-semibold"><Images size={17} />{imagesTitle}</div>
              <p className="mt-1 text-xs leading-5 text-stone-500">{transientHint}</p>
              <Input className="mt-3" type="file" accept="image/*" multiple disabled={editing} onChange={(event) => void chooseImages(Array.from(event.target.files ?? []))} />
              {files.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{files.slice(0, 6).map((file,index) => <div key={`${file.name}-${file.size}-${index}`} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-700 dark:bg-stone-950/40"><div className="truncate text-xs font-semibold">{file.name}</div><div className="mt-1 text-[11px] text-stone-400">{Math.max(1,Math.round(file.size/1024))} KB</div></div>)}</div>}
              <div className="mt-3 flex flex-wrap gap-2">
                {ocrBusy ? <Button variant="secondary" onClick={() => ocrAbortRef.current?.abort()}><Square size={15}/>{t('imageImport.cancel')}</Button> : <Button variant="secondary" disabled={!files[0]} onClick={() => void runOcr()}><ScanText size={16}/>OCR</Button>}
                <Button variant="secondary" disabled={!files[0] || aiBusy || !ledger.aiVision?.endpoint || !ledger.aiVision?.model} onClick={() => void runAi()}><Sparkles size={16}/>{aiBusy ? t('ai.analyzing') : 'AI'}</Button>
                {files.length > 1 && <Button variant="secondary" disabled={ocrBusy} onClick={() => void runBatchOcr()}><Images size={16}/>{t('batch.title')}</Button>}
              </div>
              {ocrStatus && <div className="mt-2 text-xs text-stone-500">{ocrStatus}</div>}
            </div>

            {files[0] && <div className="rounded-2xl border border-stone-200 p-4 dark:border-stone-800">
              <div className="flex items-center gap-2 font-semibold"><Bot size={17}/>{t('settings.ocrTemplates')}</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"><Select value={templateId} onChange={(event) => applyTemplate(event.target.value)}><option value="">{t('common.none')}</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</Select><Button variant="secondary" onClick={() => setShowRegions((value) => !value)}>{showRegions ? t('common.close') : t('ocr.editRegions')}</Button></div>
              {showRegions && previewUrls[0] && <Suspense fallback={null}><div className="mt-3"><OcrRegionEditor imageUrl={previewUrls[0]} regions={regions} onChange={setRegions} onDimensions={setImageSize} /></div></Suspense>}
              {regions.length > 0 && <div className="mt-3 flex gap-2"><Input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder={t('ocr.templateName')} /><Button onClick={() => void saveTemplate()} disabled={!templateName.trim()}>{t('common.save')}</Button></div>}
            </div>}
          </div>
        </div>

        {detectedLines.length > 0 && <div className="mt-5"><OcrTeachingPanel lines={detectedLines} mappings={lineMappings} onMap={mapDetectedLine} /></div>}
        {batchDrafts.length > 0 && <div className="mt-5"><BatchOcrReview drafts={batchDrafts} files={files} accounts={activeAccounts} categories={activeCategories} catalogues={ledger.accountCatalogues} activeId={activeBatchId} onActiveId={setActiveBatchId} onChange={updateBatchDraft} /><div className="mt-3 flex justify-end"><Button onClick={() => void saveBatch()} disabled={saving}>{saving ? t('modal.saving') : t('batch.saveSelected')}</Button></div></div>}
        {error && <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-stone-200 px-4 py-3 dark:border-stone-800"><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button onClick={() => void save()} disabled={saving || batchDrafts.length > 0}>{saving ? t('modal.saving') : t('common.save')}</Button></div>
      </>}
    </div>

    {showVoice && <VoiceEntry
      initial={voiceDraft}
      settings={adaptedSettings}
      accounts={activeAccounts}
      categories={activeCategories}
      onClose={() => setShowVoice(false)}
      onApply={(draft) => {
        setType(draft.type); setAmount(draft.amount); setOccurredAt(`${draft.date}T${draft.time}`); setBatchTime(draft.time)
        setAccountId(draft.accountId); setDestinationAccountId(draft.destinationAccountId); setCategoryId(draft.categoryId); setMerchant(draft.merchant); setDescription(draft.description); setShowVoice(false)
      }}
    />}
  </div>
}
