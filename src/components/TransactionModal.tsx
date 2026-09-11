import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Bot, CalendarDays, CopyPlus, ImagePlus, Images, LoaderCircle, Mic, Repeat2, ScanText, Sparkles, X } from 'lucide-react'
import { useWallet } from '../WalletContext'
import { localizeError, useI18n } from '../i18n'
import { buildDetectedLines, parseTransactionFromOcr, parseTransactionFromRegions, recognizeImage } from '../lib/ocr'
import { fromLocalInputDateTime, toLocalInputDateTime } from '../lib/format'
import { combineLocalDateAndTime, localDateKeyFromInputDateTime, localTimeFromInputDateTime, localWeekday, recurringDateKeys } from '../lib/scheduling'
import { accountCurrencies } from '../lib/accounts'
import type { OcrDetectedLine, OcrField, OcrRegion, OcrResult, OcrTemplate, Transaction, TransactionType } from '../types'
import { Button, Input, Label, Select, Textarea } from './ui'
import { MultiDatePicker } from './MultiDatePicker'
import { BatchOcrReview, type BatchOcrDraft } from './BatchOcrReview'
import { OcrTeachingPanel } from './OcrTeachingPanel'
import { findDuplicateTransaction } from '../lib/duplicates'
import { selectableCategories } from '../lib/categories'
import { findMatchingTransactionRule } from '../lib/rules'
import { validateImageBatch } from '../lib/security'
import { AI_OPENROUTER_KEY_SECRET, analyzeTransactionImage } from '../lib/ai'
import { CategoryPicker } from './CategoryPicker'
import { AccountSelect } from './AccountSelect'
import { VoiceEntry, type VoiceEntryDraft } from './VoiceEntry'

const OcrRegionEditor = lazy(() => import('./OcrRegionEditor').then((module) => ({ default: module.OcrRegionEditor })))

function uniqueTags(raw: string) {
  return [...new Set(raw.split(/[,;#\n]/).map((item) => item.trim()).filter(Boolean))].slice(0, 20)
}

function validCurrency(code: string) {
  return /^[A-Z]{3}$/.test(code.trim().toUpperCase())
}

export function TransactionModal({ onClose, transaction, duplicateFrom, initialVoice = false }: {
  onClose: () => void
  transaction?: Transaction
  duplicateFrom?: Transaction
  initialVoice?: boolean
}) {
  const { accounts, categories, repository, saveEntity, saveEntities, settings, transactions } = useWallet()
  const { t, locale } = useI18n()
  const seed = transaction ?? duplicateFrom
  const editing = Boolean(transaction)
  const seedAccountId = seed?.accountId ?? settings?.transactionDefaults?.accountId ?? accounts[0]?.id ?? ''
  const seedAccount = accounts.find((account) => account.id === seedAccountId)
  const seedCurrencies = seedAccount ? accountCurrencies(seedAccount) : []

  const [type, setType] = useState<TransactionType>(seed?.type ?? 'expense')
  const [amount, setAmount] = useState(seed?.amount ? String(seed.amount) : '')
  const [currency, setCurrency] = useState(seed?.currency ?? seedCurrencies[0] ?? 'VND')
  const initialOccurredAt = seed ? toLocalInputDateTime(seed.occurredAt) : toLocalInputDateTime()
  const initialDateKey = localDateKeyFromInputDateTime(initialOccurredAt)
  const [occurredAt, setOccurredAt] = useState(initialOccurredAt)
  const [creationMode, setCreationMode] = useState<'single' | 'multiple' | 'repeat'>('single')
  const [batchTime, setBatchTime] = useState(localTimeFromInputDateTime(initialOccurredAt))
  const [selectedDates, setSelectedDates] = useState<string[]>([initialDateKey])
  const [repeatStartDate, setRepeatStartDate] = useState(initialDateKey)
  const [repeatUntilDate, setRepeatUntilDate] = useState(initialDateKey)
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[]>([localWeekday(initialDateKey)])
  const [categoryId, setCategoryId] = useState(seed?.categoryId ?? settings?.transactionDefaults?.categoryId ?? '')
  const [accountId, setAccountId] = useState(seedAccountId)
  const [destinationAccountId, setDestinationAccountId] = useState(seed?.destinationAccountId ?? '')
  const [destinationCurrency, setDestinationCurrency] = useState(seed?.destinationCurrency ?? seed?.currency ?? '')
  const [destinationAmount, setDestinationAmount] = useState(seed?.destinationAmount !== undefined ? String(seed.destinationAmount) : '')
  const [merchant, setMerchant] = useState(seed?.merchant ?? '')
  const [balanceAfter, setBalanceAfter] = useState(seed?.balanceAfter !== undefined ? String(seed.balanceAfter) : '')
  const [description, setDescription] = useState(seed?.description ?? '')
  const [note, setNote] = useState(seed?.note ?? '')
  const [tags, setTags] = useState((seed?.tags ?? []).join(', '))
  const [files, setFiles] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [regions, setRegions] = useState<OcrRegion[]>([])
  const [showRegions, setShowRegions] = useState(false)
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>()
  const [templateId, setTemplateId] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [ocrBusy, setOcrBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrStatus, setOcrStatus] = useState('')
  const [ocrRaw, setOcrRaw] = useState('')
  const [ocrResult, setOcrResult] = useState<OcrResult>()
  const [detectedLines, setDetectedLines] = useState<OcrDetectedLine[]>([])
  const [lineMappings, setLineMappings] = useState<Record<string, OcrField | ''>>({})
  const [batchDrafts, setBatchDrafts] = useState<BatchOcrDraft[]>([])
  const [activeBatchId, setActiveBatchId] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [showVoiceEntry, setShowVoiceEntry] = useState(initialVoice)
  const [error, setError] = useState<string>()

  const sourceAccount = accounts.find((account) => account.id === accountId)
  const sourceCurrencies = sourceAccount ? accountCurrencies(sourceAccount) : []
  const destinationAccount = accounts.find((account) => account.id === destinationAccountId)
  const destinationCurrencies = destinationAccount ? accountCurrencies(destinationAccount) : []
  const crossCurrencyTransfer = type === 'transfer' && Boolean(destinationCurrency) && destinationCurrency !== currency
  const eligibleCategories = useMemo(() => selectableCategories(categories, type), [categories, type])
  const templates = settings?.ocrTemplates ?? []
  const plannedDates = useMemo(() => {
    if (editing || creationMode === 'single') return [localDateKeyFromInputDateTime(occurredAt)]
    if (creationMode === 'multiple') return [...selectedDates].sort()
    return recurringDateKeys(repeatStartDate, repeatUntilDate, repeatWeekdays)
  }, [creationMode, editing, occurredAt, repeatStartDate, repeatUntilDate, repeatWeekdays, selectedDates])

  useEffect(() => {
    if (!accounts.some((account) => account.id === accountId)) setAccountId(accounts[0]?.id ?? '')
    if (type === 'transfer' && !accounts.some((account) => account.id === destinationAccountId && account.id !== accountId)) {
      setDestinationAccountId(accounts.find((account) => account.id !== accountId)?.id ?? '')
    }
  }, [accounts, accountId, destinationAccountId, type])

  useEffect(() => {
    if (sourceCurrencies.length && !sourceCurrencies.includes(currency)) setCurrency(sourceCurrencies[0])
  }, [currency, sourceCurrencies])

  useEffect(() => {
    if (type !== 'transfer') return
    if (!destinationCurrencies.length) return
    if (!destinationCurrencies.includes(destinationCurrency)) {
      setDestinationCurrency(destinationCurrencies.includes(currency) ? currency : destinationCurrencies[0])
      setDestinationAmount('')
    }
  }, [currency, destinationCurrencies, destinationCurrency, type])

  useEffect(() => {
    if (categoryId && !eligibleCategories.some((category) => category.id === categoryId)) setCategoryId('')
  }, [eligibleCategories, categoryId])

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file))
    setPreviewUrls(urls)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [files])

  async function chooseImages(selected: File[]) {
    setError(undefined)
    try {
      await validateImageBatch(selected)
      setFiles(selected); setRegions([]); setImageSize(undefined); setOcrResult(undefined); setDetectedLines([]); setLineMappings({}); setBatchDrafts([]); setActiveBatchId(undefined); setOcrRaw('')
    } catch (validationError) {
      setFiles([])
      setError(localizeError(validationError, t, 'error.imageInvalid'))
    }
  }

  function applyTemplate(id: string) {
    setTemplateId(id)
    const template = templates.find((item) => item.id === id)
    if (template) { setRegions(template.regions.map((region) => ({ ...region, id: crypto.randomUUID() }))); setShowRegions(true) }
  }

  async function saveTemplate() {
    if (!settings || !regions.length || !templateName.trim()) return
    const now = new Date().toISOString()
    const template: OcrTemplate = { id: crypto.randomUUID(), name: templateName.trim(), aspectRatio: imageSize ? imageSize.width / imageSize.height : undefined, regions: regions.map((region) => ({ ...region, id: crypto.randomUUID(), sourceLineId: undefined })), createdAt: now, updatedAt: now }
    await saveEntity({ ...settings, ocrTemplates: [...templates, template], updatedAt: now })
    setTemplateId(template.id); setTemplateName('')
  }

  function applyParsedCandidate(parsed: ReturnType<typeof parseTransactionFromOcr>) {
    setOcrRaw(parsed.rawText)
    if (parsed.amount) setAmount(String(parsed.amount))
    if (parsed.occurredAt) {
      const local = toLocalInputDateTime(parsed.occurredAt); const dateKey = localDateKeyFromInputDateTime(local)
      setOccurredAt(local); setBatchTime(localTimeFromInputDateTime(local))
      if (creationMode === 'repeat') { setRepeatStartDate(dateKey); setRepeatUntilDate((current) => current < dateKey ? dateKey : current) }
    }
    if (parsed.merchant) setMerchant(parsed.merchant)
    if (parsed.balanceAfter) setBalanceAfter(String(parsed.balanceAfter))
    if (parsed.description) setDescription(parsed.description)
    setType(parsed.type)
    const rule = findMatchingTransactionRule({ type: parsed.type, amount: parsed.amount, merchant: parsed.merchant, description: parsed.description }, settings?.transactionRules ?? [])
    if (rule?.categoryId && selectableCategories(categories, parsed.type).some((category) => category.id === rule.categoryId)) setCategoryId(rule.categoryId)
    if (rule?.accountId && accounts.some((account) => account.id === rule.accountId)) setAccountId(rule.accountId)
  }

  async function readImageSize(file: File) {
    if ('createImageBitmap' in window) { const bitmap = await createImageBitmap(file); const value = { width: bitmap.width, height: bitmap.height }; bitmap.close(); return value }
    const url = URL.createObjectURL(file)
    try { return await new Promise<{ width: number; height: number }>((resolve, reject) => { const image = new window.Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error('modal.errorOcr')); image.src = url }) } finally { URL.revokeObjectURL(url) }
  }

  async function ensureImageSize(file: File) { if (imageSize) return imageSize; const value = await readImageSize(file); setImageSize(value); return value }

  async function runOcr() {
    if (!files[0]) return
    setOcrBusy(true); setError(undefined); setOcrProgress(0)
    try {
      const [result, size] = await Promise.all([recognizeImage(files[0], (progress, status) => { setOcrProgress(progress); setOcrStatus(status) }), ensureImageSize(files[0])])
      setOcrResult(result); setDetectedLines(buildDetectedLines(result, size.width, size.height)); setLineMappings(Object.fromEntries(regions.filter((region) => region.sourceLineId).map((region) => [region.sourceLineId!, region.field])))
      applyParsedCandidate(regions.length ? parseTransactionFromRegions(result, regions, size.width, size.height) : parseTransactionFromOcr(result))
    } catch (e) { setError(localizeError(e, t, 'modal.errorOcr')) } finally { setOcrBusy(false) }
  }

  async function runAi() {
    if (!files[0] || !repository) return
    setAiBusy(true); setError(undefined)
    try {
      const endpoint = settings?.aiVision?.endpoint?.trim(); const model = settings?.aiVision?.model?.trim(); const apiKey = await repository.getLocalSecret(AI_OPENROUTER_KEY_SECRET)
      if (!endpoint || !model || !apiKey) throw new Error('error.aiNotConfigured')
      const parsed = await analyzeTransactionImage(files[0], { endpoint, model, apiKey }); const nextType = parsed.type ?? type
      if (parsed.type) setType(parsed.type)
      if (parsed.amount !== undefined) setAmount(String(parsed.amount))
      if (parsed.currency && validCurrency(parsed.currency) && sourceCurrencies.includes(parsed.currency.trim().toUpperCase())) setCurrency(parsed.currency.trim().toUpperCase())
      if (parsed.occurredAt) { const local = toLocalInputDateTime(parsed.occurredAt); const dateKey = localDateKeyFromInputDateTime(local); setOccurredAt(local); setBatchTime(localTimeFromInputDateTime(local)); if (creationMode === 'repeat') { setRepeatStartDate(dateKey); setRepeatUntilDate((current) => current < dateKey ? dateKey : current) } }
      if (parsed.merchant !== undefined) setMerchant(parsed.merchant)
      if (parsed.balanceAfter !== undefined) setBalanceAfter(String(parsed.balanceAfter))
      if (parsed.description !== undefined) setDescription(parsed.description)
      const rule = findMatchingTransactionRule({ type: nextType, amount: parsed.amount, merchant: parsed.merchant, description: parsed.description }, settings?.transactionRules ?? [])
      if (rule?.categoryId && selectableCategories(categories, nextType).some((category) => category.id === rule.categoryId)) setCategoryId(rule.categoryId)
      if (rule?.accountId && accounts.some((account) => account.id === rule.accountId)) setAccountId(rule.accountId)
    } catch (aiError) { setError(localizeError(aiError, t, 'error.aiRequestFailed')) } finally { setAiBusy(false) }
  }

  function mapDetectedLine(line: OcrDetectedLine, mappedField: OcrField | '') {
    setLineMappings((current) => ({ ...current, [line.id]: mappedField }))
    const withoutLine = regions.filter((region) => region.sourceLineId !== line.id)
    const nextRegions = mappedField ? [...withoutLine, { id: crypto.randomUUID(), field: mappedField, x: Math.max(0, line.x - 0.006), y: Math.max(0, line.y - 0.004), width: Math.min(1 - Math.max(0, line.x - 0.006), line.width + 0.012), height: Math.min(1 - Math.max(0, line.y - 0.004), line.height + 0.008), stripLabel: mappedField !== 'generic' && mappedField !== 'ignore', sourceLineId: line.id } satisfies OcrRegion] : withoutLine
    setRegions(nextRegions); setShowRegions(true)
    if (ocrResult && imageSize) applyParsedCandidate(parseTransactionFromRegions(ocrResult, nextRegions, imageSize.width, imageSize.height))
  }

  async function runBatchOcr() {
    if (!files.length || editing) return
    setOcrBusy(true); setError(undefined); setBatchDrafts([]); setOcrProgress(0)
    try {
      const drafts: BatchOcrDraft[] = []; const batchCandidates: Transaction[] = []; const existingIds = new Set(transactions.map((item) => item.id))
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        const [result, size] = await Promise.all([recognizeImage(file, (progress, status) => { setOcrProgress((index + progress) / files.length); setOcrStatus(`${index + 1}/${files.length} · ${status}`) }), readImageSize(file)])
        const parsed = regions.length ? parseTransactionFromRegions(result, regions, size.width, size.height) : parseTransactionFromOcr(result)
        const localOccurredAt = parsed.occurredAt ? toLocalInputDateTime(parsed.occurredAt) : occurredAt; const parsedType = parsed.type; const compatibleCategories = selectableCategories(categories, parsedType)
        const matchedRule = findMatchingTransactionRule({ type: parsedType, amount: parsed.amount, merchant: parsed.merchant, description: parsed.description }, settings?.transactionRules ?? [])
        const resolvedCategoryId = matchedRule?.categoryId && compatibleCategories.some((category) => category.id === matchedRule.categoryId) ? matchedRule.categoryId : compatibleCategories.some((category) => category.id === categoryId) ? categoryId : compatibleCategories[0]?.id ?? ''
        const resolvedAccountId = matchedRule?.accountId && accounts.some((account) => account.id === matchedRule.accountId) ? matchedRule.accountId : accounts.some((account) => account.id === accountId) ? accountId : accounts[0]?.id ?? ''
        const resolvedAccount = accounts.find((account) => account.id === resolvedAccountId); const allowedCurrencies = resolvedAccount ? accountCurrencies(resolvedAccount) : []
        const resolvedCurrency = parsed.currency && allowedCurrencies.includes(parsed.currency.trim().toUpperCase()) ? parsed.currency.trim().toUpperCase() : allowedCurrencies.includes(currency) ? currency : allowedCurrencies[0] ?? currency
        const amountValue = parsed.amount ? String(parsed.amount) : ''; const candidateOccurredAt = fromLocalInputDateTime(localOccurredAt)
        const conflict = parsed.amount ? findDuplicateTransaction({ type: parsedType, amount: parsed.amount, occurredAt: candidateOccurredAt, accountId: resolvedAccountId, merchant: parsed.merchant, description: parsed.description }, [...transactions, ...batchCandidates]) : undefined
        const draftId = crypto.randomUUID(); const destinationId = parsedType === 'transfer' ? accounts.find((account) => account.id !== resolvedAccountId && accountCurrencies(account).includes(resolvedCurrency))?.id : undefined
        drafts.push({ id: draftId, fileIndex: index, selected: conflict?.level !== 'exact', type: parsedType, amount: amountValue, currency: resolvedCurrency, occurredAt: localOccurredAt, categoryId: resolvedCategoryId, accountId: resolvedAccountId, destinationAccountId: destinationId, merchant: parsed.merchant ?? '', balanceAfter: parsed.balanceAfter !== undefined ? String(parsed.balanceAfter) : '', description: parsed.description ?? '', rawText: parsed.rawText, conflict: conflict ? { level: conflict.level, source: existingIds.has(conflict.transaction.id) ? 'existing' : 'batch', transactionId: conflict.transaction.id, occurredAt: conflict.transaction.occurredAt, amount: conflict.transaction.amount, merchant: conflict.transaction.merchant } : undefined })
        if (parsed.amount) batchCandidates.push({ id: draftId, type: parsedType, amount: parsed.amount, currency: resolvedCurrency, occurredAt: candidateOccurredAt, categoryId: resolvedCategoryId, accountId: resolvedAccountId, destinationAccountId: destinationId, merchant: parsed.merchant, balanceAfter: parsed.balanceAfter, description: parsed.description, imageIds: [], createdAt: candidateOccurredAt, updatedAt: candidateOccurredAt, deleted: false })
      }
      setBatchDrafts(drafts); setActiveBatchId(drafts[0]?.id); setOcrProgress(1)
    } catch (e) { setError(localizeError(e, t, 'modal.errorOcr')) } finally { setOcrBusy(false) }
  }

  function updateBatchDraft(next: BatchOcrDraft) {
    const compatibleCategories = selectableCategories(categories, next.type)
    const account = accounts.find((item) => item.id === next.accountId); const allowedCurrencies = account ? accountCurrencies(account) : []
    const normalized = { ...next, categoryId: compatibleCategories.some((category) => category.id === next.categoryId) ? next.categoryId : compatibleCategories[0]?.id ?? next.categoryId, currency: allowedCurrencies.includes(next.currency) ? next.currency : allowedCurrencies[0] ?? next.currency }
    const amountValue = Number(normalized.amount); let conflict = normalized.conflict
    if (amountValue > 0 && normalized.occurredAt && normalized.accountId) {
      const siblingCandidates: Transaction[] = batchDrafts.filter((draft) => draft.id !== normalized.id && Number(draft.amount) > 0 && draft.occurredAt && draft.accountId).map((draft) => ({ id: draft.id, type: draft.type, amount: Number(draft.amount), currency: draft.currency || currency, occurredAt: fromLocalInputDateTime(draft.occurredAt), categoryId: draft.categoryId, accountId: draft.accountId, destinationAccountId: draft.destinationAccountId, merchant: draft.merchant || undefined, balanceAfter: draft.balanceAfter ? Number(draft.balanceAfter) : undefined, description: draft.description || undefined, imageIds: [], createdAt: fromLocalInputDateTime(draft.occurredAt), updatedAt: fromLocalInputDateTime(draft.occurredAt), deleted: false }))
      const existingIds = new Set(transactions.map((item) => item.id)); const match = findDuplicateTransaction({ type: normalized.type, amount: amountValue, occurredAt: fromLocalInputDateTime(normalized.occurredAt), accountId: normalized.accountId, merchant: normalized.merchant, description: normalized.description }, [...transactions, ...siblingCandidates])
      conflict = match ? { level: match.level, source: existingIds.has(match.transaction.id) ? 'existing' as const : 'batch' as const, transactionId: match.transaction.id, occurredAt: match.transaction.occurredAt, amount: match.transaction.amount, merchant: match.transaction.merchant } : undefined
    }
    setBatchDrafts((current) => current.map((draft) => draft.id === normalized.id ? { ...normalized, conflict } : draft))
  }

  async function saveBatchOcr() {
    if (!repository) return
    const selected = batchDrafts.filter((draft) => draft.selected)
    if (!selected.length) { setError(t('batch.errorNoneSelected')); return }
    for (const draft of selected) {
      const numericAmount = Number(draft.amount); const account = accounts.find((item) => item.id === draft.accountId); const allowed = account ? accountCurrencies(account) : []
      if (!numericAmount || numericAmount <= 0 || !draft.accountId || !draft.occurredAt || !allowed.includes(draft.currency)) { setActiveBatchId(draft.id); setError(t('batch.errorInvalidDraft')); return }
      if (draft.type === 'transfer') {
        const destination = accounts.find((item) => item.id === draft.destinationAccountId)
        if (!destination || destination.id === draft.accountId || !accountCurrencies(destination).includes(draft.currency)) { setActiveBatchId(draft.id); setError(locale.startsWith('vi') ? 'OCR batch chỉ hỗ trợ transfer cùng tiền tệ. Hãy chỉnh giao dịch riêng nếu cần đổi tiền.' : 'OCR batch supports same-currency transfers only. Edit the transaction separately for currency exchange.'); return }
      }
    }
    setSaving(true); setError(undefined)
    try {
      const now = new Date().toISOString(); const batchId = selected.length > 1 ? crypto.randomUUID() : undefined; const records: Transaction[] = []
      for (let index = 0; index < selected.length; index += 1) {
        const draft = selected[index]; const file = files[draft.fileIndex]; const imageId = file ? (await repository.saveImage(file)).id : undefined; const numericAmount = Number(draft.amount)
        records.push({ id: crypto.randomUUID(), type: draft.type, amount: numericAmount, currency: draft.currency, occurredAt: fromLocalInputDateTime(draft.occurredAt), categoryId: draft.categoryId, accountId: draft.accountId, destinationAccountId: draft.type === 'transfer' ? draft.destinationAccountId : undefined, destinationCurrency: draft.type === 'transfer' ? draft.currency : undefined, destinationAmount: draft.type === 'transfer' ? numericAmount : undefined, merchant: draft.merchant.trim() || undefined, balanceAfter: draft.balanceAfter ? Number(draft.balanceAfter) : undefined, description: draft.description.trim() || undefined, note: note.trim() || undefined, tags: uniqueTags(tags), batch: batchId ? { id: batchId, mode: 'ocr-batch', index, count: selected.length } : undefined, imageIds: imageId ? [imageId] : [], createdAt: now, updatedAt: now, deleted: false })
      }
      await saveEntities(records); onClose()
    } catch (e) { setError(localizeError(e, t, 'modal.errorSave')) } finally { setSaving(false) }
  }

  async function save() {
    const numericAmount = Number(amount); const normalizedCurrency = currency.trim().toUpperCase()
    if (!repository || !numericAmount || numericAmount <= 0 || !accountId || !sourceCurrencies.includes(normalizedCurrency)) { setError(t('modal.errorMissingFields')); return }
    if (type === 'transfer' && (!destinationAccountId || destinationAccountId === accountId)) { setError(t('modal.errorTransferAccounts')); return }
    const normalizedDestinationCurrency = destinationCurrency.trim().toUpperCase()
    const numericDestinationAmount = crossCurrencyTransfer ? Number(destinationAmount) : numericAmount
    if (type === 'transfer' && (!destinationCurrencies.includes(normalizedDestinationCurrency) || !numericDestinationAmount || numericDestinationAmount <= 0)) { setError(locale.startsWith('vi') ? 'Hãy chọn pocket đích và nhập số tiền thực nhận.' : 'Choose a destination currency pocket and enter the received amount.'); return }

    let occurrenceTimes: string[]
    if (editing || creationMode === 'single') occurrenceTimes = [fromLocalInputDateTime(occurredAt)]
    else if (creationMode === 'multiple') { if (!selectedDates.length) { setError(t('schedule.errorNoDates')); return }; occurrenceTimes = [...new Set(selectedDates)].sort().map((date) => combineLocalDateAndTime(date, batchTime)) }
    else { if (!repeatStartDate || !repeatUntilDate || repeatUntilDate < repeatStartDate) { setError(t('schedule.errorRepeatRange')); return }; if (!repeatWeekdays.length) { setError(t('schedule.errorWeekdays')); return }; const dates = recurringDateKeys(repeatStartDate, repeatUntilDate, repeatWeekdays); if (!dates.length) { setError(t('schedule.errorNoOccurrences')); return }; occurrenceTimes = dates.map((date) => combineLocalDateAndTime(date, batchTime)) }
    if (occurrenceTimes.length > 5000) { setError(t('schedule.errorTooMany')); return }

    setSaving(true); setError(undefined)
    try {
      const imageIds = editing ? [...(transaction?.imageIds ?? [])] : []; if (!editing && duplicateFrom) imageIds.push(...duplicateFrom.imageIds); for (const file of files) imageIds.push((await repository.saveImage(file)).id)
      const now = new Date().toISOString(); const batchId = occurrenceTimes.length > 1 ? crypto.randomUUID() : undefined; const batchMode = creationMode === 'repeat' ? 'recurring' : 'multi-date'
      const records: Transaction[] = occurrenceTimes.map((time, index) => ({ id: editing ? transaction!.id : crypto.randomUUID(), type, amount: numericAmount, currency: normalizedCurrency, occurredAt: time, categoryId, accountId, destinationAccountId: type === 'transfer' ? destinationAccountId : undefined, destinationCurrency: type === 'transfer' ? normalizedDestinationCurrency : undefined, destinationAmount: type === 'transfer' ? numericDestinationAmount : undefined, merchant: merchant.trim() || undefined, balanceAfter: balanceAfter ? Number(balanceAfter) : undefined, description: description.trim() || undefined, note: note.trim() || undefined, tags: uniqueTags(tags), batch: editing ? transaction?.batch : batchId ? { id: batchId, mode: batchMode, index, count: occurrenceTimes.length } : undefined, imageIds, createdAt: editing ? transaction!.createdAt : now, updatedAt: now, deleted: false }))
      if (records.length === 1) await saveEntity(records[0]); else await saveEntities(records)
      onClose()
    } catch (e) { setError(localizeError(e, t, 'modal.errorSave')) } finally { setSaving(false) }
  }

  function applyVoiceEntry(draft: VoiceEntryDraft) {
    setType(draft.type); setAmount(draft.amount); setAccountId(draft.accountId); setDestinationAccountId(draft.destinationAccountId); setCategoryId(draft.categoryId); setMerchant(draft.merchant); setDescription(draft.description)
    const local = `${draft.date}T${draft.time}`; setOccurredAt(local); setBatchTime(draft.time)
    if (creationMode === 'multiple') setSelectedDates((current) => current.length ? current : [draft.date])
    if (creationMode === 'repeat') { setRepeatStartDate(draft.date); setRepeatUntilDate((current) => current < draft.date ? draft.date : current) }
    setShowVoiceEntry(false)
  }

  return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-stone-950/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
    <div className="flex max-h-[100dvh] w-full max-w-7xl min-w-0 flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-stone-900 sm:max-h-[94dvh] sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
      <div className="flex shrink-0 items-center justify-between border-b border-stone-200 bg-white px-4 py-3 dark:border-stone-800 dark:bg-stone-900 sm:px-5 sm:py-4"><div className="min-w-0"><h2 className="truncate text-lg font-semibold text-stone-950 dark:text-white">{editing ? t('modal.editTitle') : duplicateFrom ? t('modal.duplicateTitle') : t('modal.title')}</h2><p className="truncate text-xs text-stone-500">{t('modal.imageRetentionHint')}</p></div><div className="flex shrink-0 items-center gap-1">{!editing && <Button variant="secondary" className="px-3" onClick={() => setShowVoiceEntry(true)}><Mic size={17}/><span className="hidden sm:inline">{t('voice.entryButton')}</span></Button>}<Button variant="ghost" className="px-3" onClick={onClose}><X size={18}/></Button></div></div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
        <div className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)]">
          <div className="min-w-0 space-y-4 p-4 sm:p-5 lg:border-r lg:border-stone-200 lg:dark:border-stone-800">
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-stone-100 p-1 dark:bg-stone-800">{(['expense','income','transfer'] as TransactionType[]).map((value) => <button key={value} onClick={() => setType(value)} className={`rounded-xl px-3 py-2 text-sm font-bold transition ${type===value?'bg-white text-stone-900 shadow-sm dark:bg-stone-950 dark:text-white':'text-stone-500 dark:text-stone-400'}`}>{t(`transaction.${value}`)}</button>)}</div>

            <div className="grid gap-4 sm:grid-cols-[1.5fr_.9fr]"><div><Label>{t('modal.amount')}</Label><Input type="number" inputMode="decimal" min="0" value={amount} onChange={(e)=>setAmount(e.target.value)} placeholder="150000"/></div><div><Label>{t('modal.currency')}</Label><Select value={currency} onChange={(e)=>setCurrency(e.target.value)} disabled={sourceCurrencies.length<=1}>{sourceCurrencies.length ? sourceCurrencies.map((code)=><option key={code} value={code}>{code}</option>) : <option value={currency}>{currency}</option>}</Select><p className="mt-1 text-xs text-stone-400">{locale.startsWith('vi')?'Currency lấy từ account pocket.':'Currency comes from the account pocket.'}</p></div></div>

            {!editing && <div className="space-y-3 rounded-2xl border border-stone-200 p-3 dark:border-stone-800"><div><Label>{t('schedule.creationMode')}</Label><div className="grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-800">{([['single','schedule.single'],['multiple','schedule.multiple'],['repeat','schedule.repeat']] as const).map(([value,label])=><button type="button" key={value} onClick={()=>setCreationMode(value)} className={`rounded-lg px-2 py-2 text-xs font-bold transition sm:text-sm ${creationMode===value?'bg-white text-stone-900 shadow-sm dark:bg-stone-950 dark:text-white':'text-stone-500 dark:text-stone-400'}`}>{t(label)}</button>)}</div></div>{creationMode==='single'&&<div><Label>{t('modal.time')}</Label><Input type="datetime-local" value={occurredAt} onChange={(e)=>{setOccurredAt(e.target.value);setBatchTime(localTimeFromInputDateTime(e.target.value))}}/></div>}{creationMode==='multiple'&&<div className="space-y-3"><div className="grid gap-3 sm:grid-cols-[180px_1fr] sm:items-end"><div><Label>{t('schedule.sharedTime')}</Label><Input type="time" value={batchTime} onChange={(e)=>setBatchTime(e.target.value)}/></div><div className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{t('schedule.multiHint')}</div></div><MultiDatePicker selected={selectedDates} onChange={setSelectedDates}/></div>}{creationMode==='repeat'&&<div className="space-y-3"><div className="grid gap-3 sm:grid-cols-3"><div><Label>{t('schedule.startDate')}</Label><Input type="date" value={repeatStartDate} onChange={(e)=>{setRepeatStartDate(e.target.value);if(repeatUntilDate<e.target.value)setRepeatUntilDate(e.target.value)}}/></div><div><Label>{t('schedule.untilDate')}</Label><Input type="date" min={repeatStartDate} value={repeatUntilDate} onChange={(e)=>setRepeatUntilDate(e.target.value)}/></div><div><Label>{t('schedule.sharedTime')}</Label><Input type="time" value={batchTime} onChange={(e)=>setBatchTime(e.target.value)}/></div></div><div><Label>{t('schedule.weekdays')}</Label><div className="grid grid-cols-7 gap-1">{([[1,'weekday.mon'],[2,'weekday.tue'],[3,'weekday.wed'],[4,'weekday.thu'],[5,'weekday.fri'],[6,'weekday.sat'],[0,'weekday.sun']] as const).map(([day,label])=>{const active=repeatWeekdays.includes(day);return <button type="button" key={day} onClick={()=>setRepeatWeekdays((current)=>active?current.filter((item)=>item!==day):[...current,day])} className={`rounded-xl border px-1 py-2 text-xs font-bold ${active?'border-blue-500 bg-blue-600 text-white':'border-stone-200 text-stone-600 dark:border-stone-700 dark:text-stone-300'}`}>{t(label)}</button>})}</div></div><div className="flex items-start gap-2 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"><Repeat2 className="mt-0.5 shrink-0" size={15}/><span>{t('schedule.repeatPreview',{count:plannedDates.length})}</span></div></div>}</div>}
            {editing && <div><Label>{t('modal.time')}</Label><Input type="datetime-local" value={occurredAt} onChange={(e)=>setOccurredAt(e.target.value)}/></div>}

            <div className="grid gap-4 sm:grid-cols-2"><div><Label>{t('modal.category')}</Label><CategoryPicker categories={categories} type={type} value={categoryId} onChange={setCategoryId} placeholder={t('categoryPicker.placeholder')}/></div><div><Label>{type==='transfer'?t('modal.sourceAccount'):t('modal.account')}</Label><AccountSelect accounts={accounts} catalogues={settings?.accountCatalogues ?? []} value={accountId} onChange={setAccountId}/></div>{type==='transfer'&&<div><Label>{t('modal.destinationAccount')}</Label><AccountSelect accounts={accounts} catalogues={settings?.accountCatalogues ?? []} value={destinationAccountId} onChange={setDestinationAccountId} excludeId={accountId}/></div>}</div>

            {type==='transfer' && destinationAccount && <div className="rounded-2xl border border-stone-200 p-3 dark:border-stone-800"><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">{locale.startsWith('vi')?'Phía nhận':'Destination side'}</div><div className="grid gap-3 sm:grid-cols-2"><div><Label>{locale.startsWith('vi')?'Pocket nhận':'Destination currency'}</Label><Select value={destinationCurrency} onChange={(e)=>{setDestinationCurrency(e.target.value);setDestinationAmount('')}} disabled={destinationCurrencies.length<=1}>{destinationCurrencies.map((code)=><option key={code} value={code}>{code}</option>)}</Select></div><div><Label>{locale.startsWith('vi')?'Số tiền thực nhận':'Received amount'}</Label><Input type="number" inputMode="decimal" min="0" value={crossCurrencyTransfer?destinationAmount:amount} disabled={!crossCurrencyTransfer} onChange={(e)=>setDestinationAmount(e.target.value)}/><p className="mt-1 text-xs text-stone-400">{crossCurrencyTransfer?(locale.startsWith('vi')?'Nhập số tiền thật vào pocket đích; không dùng tỷ giá report để đoán.':'Enter the actual amount credited to the destination pocket; reporting FX is not used to guess it.'):(locale.startsWith('vi')?'Cùng currency: amount đích bằng amount nguồn.':'Same currency: destination amount equals source amount.')}</p></div></div></div>}

            <div className="grid gap-4 sm:grid-cols-2"><div className="min-w-0"><Label>{t('modal.merchant')}</Label><Input className="min-w-0" value={merchant} onChange={(e)=>setMerchant(e.target.value)}/></div><div><Label>{t('modal.balanceAfter')}</Label><Input type="number" value={balanceAfter} onChange={(e)=>setBalanceAfter(e.target.value)}/></div></div>
            <div><Label>{t('modal.tags')}</Label><Input value={tags} onChange={(e)=>setTags(e.target.value)} placeholder={t('modal.tagsPlaceholder')}/><p className="mt-1 text-xs text-stone-500">{t('modal.tagsHint')}</p></div><div><Label>{t('modal.description')}</Label><Textarea rows={2} value={description} onChange={(e)=>setDescription(e.target.value)}/></div><div><Label>{t('modal.note')}</Label><Textarea rows={2} value={note} onChange={(e)=>setNote(e.target.value)}/></div>
          </div>

          <div className="min-w-0 space-y-4 bg-stone-50/60 p-4 dark:bg-stone-950/30 sm:p-5">
            <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-bold text-stone-800 dark:text-stone-100">{t('modal.screenshot')}</div><div className="text-xs text-stone-500">{t('modal.ocrHint')}</div></div><label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-100"><ImagePlus size={17}/>{t('modal.chooseImages')}<input hidden type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple onChange={(e)=>{const selected=Array.from(e.target.files ?? []);e.currentTarget.value='';void chooseImages(selected)}}/></label></div>{previewUrls.length>0&&<><div className="mt-4 flex gap-2 overflow-x-auto pb-2">{previewUrls.map((url,index)=><img key={url} src={url} alt={`preview ${index+1}`} className="h-28 w-24 shrink-0 rounded-xl border border-stone-200 object-cover dark:border-stone-700"/>)}</div><div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" onClick={()=>setShowRegions((value)=>!value)} disabled={aiBusy}><Sparkles size={17}/>{showRegions?t('ocr.hideRegions'):t('ocr.configureRegions')}</Button><Button onClick={runOcr} disabled={ocrBusy||aiBusy}><ScanText size={17}/>{ocrBusy?`OCR ${Math.round(ocrProgress*100)}%`:regions.length?t('ocr.runRegions'):t('modal.ocrFirst')}</Button><Button variant="secondary" onClick={()=>void runAi()} disabled={ocrBusy||aiBusy}><Bot size={17}/>{aiBusy?t('ai.reading'):t('ai.readImage')}</Button>{!editing&&files.length>1&&<Button variant="secondary" onClick={runBatchOcr} disabled={ocrBusy||aiBusy}><Images size={17}/>{t('batch.run',{count:files.length})}</Button>}</div>{ocrBusy&&<div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800"><div className="h-full bg-blue-500 transition-all" style={{width:`${ocrProgress*100}%`}}/></div>}{ocrStatus&&ocrBusy&&<div className="mt-1 text-xs text-stone-500">{ocrStatus}</div>}<div className="mt-2 text-xs leading-5 text-stone-500">{t('ai.modalPrivacy')}</div></>}</div>
            {detectedLines.length>0&&<OcrTeachingPanel lines={detectedLines} mappings={lineMappings} onMap={mapDetectedLine}/>} 
            {previewUrls[0]&&showRegions&&<div className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"><div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]"><Select value={templateId} onChange={(e)=>applyTemplate(e.target.value)}><option value="">{t('ocr.noTemplate')}</option>{templates.map((template)=><option key={template.id} value={template.id}>{template.name}</option>)}</Select><div className="flex gap-2"><Input className="min-w-0" value={templateName} onChange={(e)=>setTemplateName(e.target.value)} placeholder={t('ocr.templateName')}/><Button variant="secondary" onClick={()=>void saveTemplate()} disabled={!regions.length||!templateName.trim()}>{t('ocr.saveTemplate')}</Button></div></div><Suspense fallback={<div className="py-8 text-center text-sm text-stone-500">{t('common.loading')}</div>}><OcrRegionEditor imageUrl={previewUrls[0]} regions={regions} onChange={setRegions} onDimensions={setImageSize}/></Suspense></div>}
            {ocrRaw&&<details className="rounded-2xl bg-white p-4 dark:bg-stone-900"><summary className="cursor-pointer text-sm font-bold text-stone-700 dark:text-stone-200">{t('modal.rawOcr')}</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-stone-500">{ocrRaw}</pre></details>}{error&&<div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}
          </div>
        </div>

        {batchDrafts.length>0&&<div className="min-w-0 border-t border-stone-200 bg-stone-50/40 p-4 dark:border-stone-800 dark:bg-stone-950/20 sm:p-5"><BatchOcrReview drafts={batchDrafts} previewUrls={previewUrls} files={files} accounts={accounts} categories={categories} catalogues={settings?.accountCatalogues ?? []} activeId={activeBatchId} onActiveId={setActiveBatchId} onChange={updateBatchDraft}/></div>}
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-stone-200 bg-white px-4 py-3 dark:border-stone-800 dark:bg-stone-900 sm:px-5"><div className="mr-auto hidden items-center gap-2 text-xs text-stone-500 sm:flex">{duplicateFrom&&<><CopyPlus size={14}/>{t('modal.duplicating')}</>}{!editing&&plannedDates.length>1&&<><CalendarDays size={14}/>{t('schedule.willCreate',{count:plannedDates.length})}</>}</div><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button onClick={batchDrafts.length?saveBatchOcr:save} disabled={saving||ocrBusy||aiBusy}>{saving?<><LoaderCircle className="animate-spin" size={17}/>{t('modal.saving')}</>:batchDrafts.length?t('batch.saveSelected',{count:batchDrafts.filter((draft)=>draft.selected).length}):editing?t('common.save'):plannedDates.length>1?t('schedule.saveMany',{count:plannedDates.length}):t('modal.save')}</Button></div>
    </div>

    {showVoiceEntry&&<VoiceEntry initial={{type,amount,date:localDateKeyFromInputDateTime(occurredAt),time:localTimeFromInputDateTime(occurredAt),accountId,destinationAccountId,categoryId,merchant,description}} settings={settings} accounts={accounts} categories={categories} onApply={applyVoiceEntry} onClose={()=>setShowVoiceEntry(false)}/>} 
  </div>
}
