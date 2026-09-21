import { useEffect, useMemo, useRef, useState } from 'react'
import { BrainCircuit, Download, ImagePlus, Images, LoaderCircle, ScanText, Square } from 'lucide-react'
import type { OcrDetectedLine, OcrField, OcrResult, OcrRuntimeDiagnostics, OcrTemplate, OcrTransactionBlock, OcrVisualFingerprint, ParsedTransactionCandidate, Transaction, TransactionType } from '../types'
import { useWallet } from '../WalletContext'
import { localizeError, useI18n } from '../i18n'
import { accountCurrencies } from '../lib/accounts'
import { findDuplicateTransaction } from '../lib/duplicates'
import { sourceFingerprint } from '../lib/fileFingerprint'
import { fromLocalInputDateTime, toLocalInputDateTime } from '../lib/format'
import {
  buildDetectedLines,
  buildPatternTemplate,
  detectTransactionBlocks,
  mergePatternTemplateEvidence,
  parseDateTimeText,
  parseMoneyText,
  rankOcrTemplates,
  recognizeImageTiled,
} from '../lib/ocr'
import { bboxOverlapRatio, canAutoLearnTemplate, isCredibleTemplateMatch, OCR_HEURISTIC_THRESHOLDS } from '../lib/ocrHeuristics'
import { findMatchingTransactionRule } from '../lib/rules'
import { selectableCategories } from '../lib/categories'
import { validateImageBatch } from '../lib/security'
import { BatchOcrReview, type BatchOcrDraft } from './BatchOcrReview'
import { Button, Input } from './ui'
import { OcrTeachingPanel } from './OcrTeachingPanel'

interface SourceAnalysis {
  fileIndex: number
  result: OcrResult
  width: number
  height: number
  visual: OcrVisualFingerprint
  templateId?: string
  templateScore?: number
  templateAnchorScore?: number
  templateVisualScore?: number
  sourceHash: string
  diagnostics?: OcrRuntimeDiagnostics
}

interface ImageImportCheckpoint {
  version: 1
  updatedAt: string
  analyses: SourceAnalysis[]
  drafts: BatchOcrDraft[]
  reviewedIds: string[]
  activeId?: string
}

function normalized(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ').trim()
}

function draftId(fileIndex: number, block: OcrTransactionBlock) {
  return `image-${fileIndex}-${Math.round(block.bbox.y)}-${Math.round(block.bbox.height)}`
}

function candidateCurrency(candidate: ParsedTransactionCandidate) {
  return (candidate as ParsedTransactionCandidate & { currency?: string }).currency
}


function preservedDraft(oldDraft: BatchOcrDraft, freshDraft: BatchOcrDraft): BatchOcrDraft {
  return {
    ...freshDraft,
    selected: oldDraft.selected,
    type: oldDraft.type,
    amount: oldDraft.amount,
    currency: oldDraft.currency,
    occurredAt: oldDraft.occurredAt,
    categoryId: oldDraft.categoryId,
    accountId: oldDraft.accountId,
    destinationAccountId: oldDraft.destinationAccountId,
    merchant: oldDraft.merchant,
    balanceAfter: oldDraft.balanceAfter,
    description: oldDraft.description,
  }
}

export function ImageImportMode({ onClose }: { onClose: () => void }) {
  const { accounts, categories, repository, saveEntity, saveEntities, settings, transactions } = useWallet()
  const { t } = useI18n()
  const [files, setFiles] = useState<File[]>([])
  const [fileHashes, setFileHashes] = useState<string[]>([])
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [analyses, setAnalyses] = useState<SourceAnalysis[]>([])
  const [drafts, setDrafts] = useState<BatchOcrDraft[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string>()
  const [patternName, setPatternName] = useState('')
  const [lineMappings, setLineMappings] = useState<Record<string, OcrField | ''>>({})
  const [sessionTemplates, setSessionTemplates] = useState<OcrTemplate[]>(settings?.ocrTemplates ?? [])
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(() => new Set())
  const [checkpointAvailable, setCheckpointAvailable] = useState(false)
  const abortRef = useRef<AbortController | undefined>(undefined)

  useEffect(() => setSessionTemplates(settings?.ocrTemplates ?? []), [settings?.ocrTemplates])

  useEffect(() => {
    let cancelled = false
    void repository?.getEncryptedCheckpoint<ImageImportCheckpoint>('image-import-v2').then((checkpoint) => {
      if (!cancelled) setCheckpointAvailable(Boolean(checkpoint?.analyses?.length || checkpoint?.drafts?.length))
    })
    return () => {
      cancelled = true
      abortRef.current?.abort()
    }
  }, [repository])

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file))
    setPreviewUrls(urls)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [files])

  const active = drafts.find((draft) => draft.id === activeId) ?? drafts[0]
  const activeAnalysis = active ? analyses.find((item) => item.fileIndex === active.fileIndex) : undefined
  const activeTemplate = active?.templateId ? sessionTemplates.find((item) => item.id === active.templateId) : undefined

  const activeLines = useMemo(() => {
    if (!active || !activeAnalysis || !active.sourceBBox) return [] as OcrDetectedLine[]
    const box = active.sourceBBox
    return buildDetectedLines(activeAnalysis.result, activeAnalysis.width, activeAnalysis.height)
      .filter((line) => {
        const center = (line.y + line.height / 2) * activeAnalysis.height
        return center >= box.y && center <= box.y + box.height
      })
      .map((line) => ({
        ...line,
        y: Math.max(0, ((line.y * activeAnalysis.height) - box.y) / Math.max(1, box.height)),
        height: Math.min(1, (line.height * activeAnalysis.height) / Math.max(1, box.height)),
      }))
  }, [active, activeAnalysis])

  useEffect(() => {
    setLineMappings({})
    setPatternName(activeTemplate?.name ?? '')
  }, [activeId, activeTemplate?.id])

  async function chooseImages(selected: File[]) {
    setError(undefined)
    try {
      await validateImageBatch(selected)
      const hashes: string[] = []
      for (const file of selected) hashes.push(await sourceFingerprint(file))
      setFiles(selected)
      setFileHashes(hashes)
      setProgress(0)

      const checkpoint = await repository?.getEncryptedCheckpoint<ImageImportCheckpoint>('image-import-v2')
      const indexByHash = new Map(hashes.map((hash, index) => [hash, index]))
      const restoredAnalyses = (checkpoint?.analyses ?? [])
        .filter((analysis) => indexByHash.has(analysis.sourceHash))
        .map((analysis) => ({ ...analysis, fileIndex: indexByHash.get(analysis.sourceHash)! }))
      const restoredDrafts = (checkpoint?.drafts ?? [])
        .filter((draft) => Boolean(draft.sourceHash && indexByHash.has(draft.sourceHash)))
        .map((draft) => ({ ...draft, fileIndex: indexByHash.get(draft.sourceHash!)! }))

      setAnalyses(restoredAnalyses)
      setDrafts(restoredDrafts)
      setReviewedIds(new Set((checkpoint?.reviewedIds ?? []).filter((id) => restoredDrafts.some((draft) => draft.id === id))))
      setActiveId(restoredDrafts.some((draft) => draft.id === checkpoint?.activeId) ? checkpoint?.activeId : restoredDrafts[0]?.id)
      setCheckpointAvailable(Boolean(restoredAnalyses.length || restoredDrafts.length))
      setStatus(restoredAnalyses.length ? t('imageImport.resumeRestored',{count:restoredAnalyses.length}) : '')
    } catch (validationError) {
      setFiles([])
      setFileHashes([])
      setError(localizeError(validationError, t, 'error.imageInvalid'))
    }
  }

  async function persistCheckpoint(nextAnalyses = analyses, nextDrafts = drafts, nextReviewed = reviewedIds, nextActiveId = activeId) {
    if (!repository) return
    try {
      await repository.setEncryptedCheckpoint<ImageImportCheckpoint>('image-import-v2', {
        version: 1,
        updatedAt: new Date().toISOString(),
        analyses: nextAnalyses,
        drafts: nextDrafts,
        reviewedIds: [...nextReviewed],
        activeId: nextActiveId,
      })
      setCheckpointAvailable(true)
    } catch {
      // Checkpoint failure must never block importing or saving transactions.
    }
  }

  function cancelAnalysis() {
    abortRef.current?.abort()
  }

  function exportDiagnostics() {
    const payload = {
      schema: 'o-wallet-ocr-diagnostics-v1',
      generatedAt: new Date().toISOString(),
      sources: analyses.map((analysis) => ({
        fileIndex: analysis.fileIndex,
        sourceFingerprintPrefix: analysis.sourceHash.slice(0, 36),
        width: analysis.width,
        height: analysis.height,
        templateId: analysis.templateId,
        templateScore: analysis.templateScore,
        templateAnchorScore: analysis.templateAnchorScore,
        templateVisualScore: analysis.templateVisualScore,
        diagnostics: analysis.diagnostics,
      })),
      blocks: drafts.map((draft) => ({
        fileIndex: draft.fileIndex,
        sourceBBox: draft.sourceBBox,
        templateId: draft.templateId,
        blockConfidence: draft.confidence,
        conflictLevel: draft.conflict?.level,
        selected: draft.selected,
        fieldConfidence: Object.fromEntries(Object.entries(draft.fieldEvidence ?? {}).map(([field, evidence]) => [field, evidence?.confidence])),
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `o-wallet-ocr-diagnostics-${new Date().toISOString().replace(/[:.]/g,'-')}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function resolveDraft(
    fileIndex: number,
    block: OcrTransactionBlock,
    sourceWidth: number,
    sourceHeight: number,
    priorTransactions: Transaction[],
    sourceHash: string,
    sourceRowId: string,
  ): BatchOcrDraft {
    const parsed = block.candidate
    const parsedType = parsed.type
    const compatibleCategories = selectableCategories(categories, parsedType)
    const matchedRule = findMatchingTransactionRule(
      { type: parsedType, amount: parsed.amount, merchant: parsed.merchant, description: parsed.description },
      settings?.transactionRules ?? [],
    )
    const defaultCategory = settings?.transactionDefaults?.categoryId
    const resolvedCategoryId = matchedRule?.categoryId && compatibleCategories.some((category) => category.id === matchedRule.categoryId)
      ? matchedRule.categoryId
      : defaultCategory && compatibleCategories.some((category) => category.id === defaultCategory)
        ? defaultCategory
        : compatibleCategories[0]?.id ?? ''
    const defaultAccount = settings?.transactionDefaults?.accountId
    const resolvedAccountId = matchedRule?.accountId && accounts.some((account) => account.id === matchedRule.accountId)
      ? matchedRule.accountId
      : defaultAccount && accounts.some((account) => account.id === defaultAccount)
        ? defaultAccount
        : accounts[0]?.id ?? ''
    const resolvedAccount = accounts.find((account) => account.id === resolvedAccountId)
    const allowedCurrencies = resolvedAccount ? accountCurrencies(resolvedAccount) : []
    const parsedCurrency = candidateCurrency(parsed)?.trim().toUpperCase()
    const resolvedCurrency = parsedCurrency && allowedCurrencies.includes(parsedCurrency)
      ? parsedCurrency
      : allowedCurrencies[0] ?? settings?.transactionCurrency ?? settings?.defaultCurrency ?? 'VND'
    const localOccurredAt = parsed.occurredAt ? toLocalInputDateTime(parsed.occurredAt) : toLocalInputDateTime()
    const destinationId = parsedType === 'transfer'
      ? accounts.find((account) => account.id !== resolvedAccountId && accountCurrencies(account).includes(resolvedCurrency))?.id
      : undefined
    const amountValue = parsed.amount ? String(parsed.amount) : ''
    const candidateOccurredAt = fromLocalInputDateTime(localOccurredAt)
    const sourceDuplicate = priorTransactions.find((tx) =>
      tx.importSource?.adapterId === 'owallet-image-v2'
      && tx.importSource.sourceId === sourceHash
      && (tx.importSource.sourceRowIds ?? []).includes(sourceRowId),
    )
    const conflict = sourceDuplicate
      ? { level: 'exact' as const, transaction: sourceDuplicate, score: 1 }
      : parsed.amount
        ? findDuplicateTransaction(
          {
            type: parsedType,
            amount: parsed.amount,
            occurredAt: candidateOccurredAt,
            accountId: resolvedAccountId,
            merchant: parsed.merchant,
            description: parsed.description,
          },
          priorTransactions,
        )
        : undefined

    return {
      id: draftId(fileIndex, block),
      fileIndex,
      selected: conflict?.level !== 'exact',
      type: parsedType,
      amount: amountValue,
      currency: resolvedCurrency,
      occurredAt: localOccurredAt,
      categoryId: resolvedCategoryId,
      accountId: resolvedAccountId,
      destinationAccountId: destinationId,
      merchant: parsed.merchant ?? '',
      balanceAfter: parsed.balanceAfter !== undefined ? String(parsed.balanceAfter) : '',
      description: parsed.description ?? '',
      rawText: parsed.rawText,
      sourceBBox: block.bbox,
      sourceWidth,
      sourceHeight,
      templateId: block.templateId,
      confidence: block.confidence,
      fieldEvidence: block.fieldEvidence,
      sourceHash,
      sourceRowId,
      conflict: conflict ? {
        level: conflict.level,
        source: transactions.some((item) => item.id === conflict.transaction.id) ? 'existing' : 'batch',
        transactionId: conflict.transaction.id,
        occurredAt: conflict.transaction.occurredAt,
        amount: conflict.transaction.amount,
        merchant: conflict.transaction.merchant,
      } : undefined,
    }
  }

  function blocksForAnalysis(analysis: SourceAnalysis, templates = sessionTemplates) {
    const ranked = rankOcrTemplates(templates, analysis.result, analysis.width, analysis.height, analysis.visual)
    const top = ranked[0]
    const credibleMatch = isCredibleTemplateMatch(top)
    const best = credibleMatch && top ? top.template : undefined
    return {
      template: best,
      score: credibleMatch ? top?.score ?? 0 : 0,
      anchorScore: credibleMatch ? top?.anchorScore ?? 0 : 0,
      visualScore: credibleMatch ? top?.visualScore ?? 0 : 0,
      blocks: detectTransactionBlocks(analysis.result, analysis.width, analysis.height, best, analysis.visual),
    }
  }

  function buildDraftsFromAnalyses(nextAnalyses: SourceAnalysis[], templates = sessionTemplates, preserveReviewed = true, preserveIds = reviewedIds) {
    const next: BatchOcrDraft[] = []
    const candidates: Transaction[] = [...transactions]
    for (const analysis of nextAnalyses) {
      const matched = blocksForAnalysis(analysis, templates)
      analysis.templateId = matched.template?.id
      analysis.templateScore = matched.score
      analysis.templateAnchorScore = matched.anchorScore
      analysis.templateVisualScore = matched.visualScore
      for (let blockIndex = 0; blockIndex < matched.blocks.length; blockIndex += 1) {
        const block = matched.blocks[blockIndex]
        const sourceRowId = `row:${blockIndex}`
        const nextDraft = resolveDraft(analysis.fileIndex, block, analysis.width, analysis.height, candidates, analysis.sourceHash, sourceRowId)
        const exactOld = drafts.find((draft) => draft.id === nextDraft.id)
        const overlapOld = exactOld ?? drafts
          .filter((draft) => draft.fileIndex === nextDraft.fileIndex && preserveIds.has(draft.id))
          .map((draft) => ({ draft, overlap: bboxOverlapRatio(draft.sourceBBox, nextDraft.sourceBBox) }))
          .filter((item) => item.overlap >= OCR_HEURISTIC_THRESHOLDS.preserveBlockMinOverlap)
          .sort((a, b) => b.overlap - a.overlap)[0]?.draft
        const chosen = preserveReviewed && overlapOld && preserveIds.has(overlapOld.id)
          ? preservedDraft(overlapOld, nextDraft)
          : nextDraft
        next.push(chosen)
        const numericAmount = Number(chosen.amount)
        if (numericAmount > 0) {
          candidates.push({
            id: chosen.id,
            type: chosen.type,
            amount: numericAmount,
            currency: chosen.currency,
            occurredAt: fromLocalInputDateTime(chosen.occurredAt),
            categoryId: chosen.categoryId,
            accountId: chosen.accountId,
            destinationAccountId: chosen.destinationAccountId,
            merchant: chosen.merchant || undefined,
            balanceAfter: chosen.balanceAfter ? Number(chosen.balanceAfter) : undefined,
            description: chosen.description || undefined,
            importSource: chosen.sourceHash ? { adapterId: 'owallet-image-v2', sourceId: chosen.sourceHash, sourceRowIds: chosen.sourceRowId ? [chosen.sourceRowId] : [] } : undefined,
            imageIds: [],
            createdAt: fromLocalInputDateTime(chosen.occurredAt),
            updatedAt: fromLocalInputDateTime(chosen.occurredAt),
            deleted: false,
          })
        }
      }
    }
    setAnalyses([...nextAnalyses])
    setDrafts(next)
    setActiveId((current) => current && next.some((draft) => draft.id === current) ? current : next[0]?.id)
    return next
  }

  async function analyzeImages() {
    if (!files.length || busy) return
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setError(undefined)
    setProgress(0)
    setStatus('')
    try {
      const nextAnalyses: SourceAnalysis[] = analyses.filter((analysis) => fileHashes[analysis.fileIndex] === analysis.sourceHash)
      for (let index = 0; index < files.length; index += 1) {
        const existing = nextAnalyses.find((analysis) => analysis.sourceHash === fileHashes[index])
        if (existing) {
          setProgress((index + 1) / files.length)
          continue
        }
        const file = files[index]
        const ocr = await recognizeImageTiled(file, (value, text) => {
          setProgress((index + value * 0.98) / files.length)
          setStatus(`${index + 1}/${files.length} · ${text}`)
        }, { signal: controller.signal, retries: 1 })
        nextAnalyses.push({
          fileIndex: index,
          sourceHash: fileHashes[index],
          result: ocr.result,
          width: ocr.width,
          height: ocr.height,
          visual: ocr.visual,
          diagnostics: ocr.diagnostics,
        })
        nextAnalyses.sort((a,b)=>a.fileIndex-b.fileIndex)
        const partialDrafts = buildDraftsFromAnalyses(nextAnalyses, sessionTemplates, true)
        await persistCheckpoint(nextAnalyses, partialDrafts, reviewedIds, partialDrafts[0]?.id)
      }
      const nextDrafts = buildDraftsFromAnalyses(nextAnalyses, sessionTemplates, true)
      await persistCheckpoint(nextAnalyses, nextDrafts, reviewedIds, activeId ?? nextDrafts[0]?.id)
      if (!nextDrafts.length) setError(t('imageImport.noDrafts'))
      setProgress(1)
      setStatus('')
    } catch (analysisError) {
      if ((analysisError as Error)?.name === 'AbortError') {
        setStatus(t('imageImport.cancelled'))
      } else {
        setError(localizeError(analysisError, t, 'modal.errorOcr'))
      }
    } finally {
      abortRef.current = undefined
      setBusy(false)
    }
  }

  function updateDraft(next: BatchOcrDraft) {
    const compatibleCategories = selectableCategories(categories, next.type)
    const account = accounts.find((item) => item.id === next.accountId)
    const allowedCurrencies = account ? accountCurrencies(account) : []
    const normalizedDraft: BatchOcrDraft = {
      ...next,
      categoryId: compatibleCategories.some((category) => category.id === next.categoryId) ? next.categoryId : compatibleCategories[0]?.id ?? next.categoryId,
      currency: allowedCurrencies.includes(next.currency) ? next.currency : allowedCurrencies[0] ?? next.currency,
    }
    const numericAmount = Number(normalizedDraft.amount)
    let conflict: BatchOcrDraft['conflict']
    const sourceDuplicate = normalizedDraft.sourceHash && normalizedDraft.sourceRowId
      ? transactions.find((tx) => tx.importSource?.adapterId === 'owallet-image-v2' && tx.importSource.sourceId === normalizedDraft.sourceHash && (tx.importSource.sourceRowIds ?? []).includes(normalizedDraft.sourceRowId!))
      : undefined
    if (sourceDuplicate) {
      conflict = { level: 'exact', source: 'existing', transactionId: sourceDuplicate.id, occurredAt: sourceDuplicate.occurredAt, amount: sourceDuplicate.amount, merchant: sourceDuplicate.merchant }
    } else if (numericAmount > 0 && normalizedDraft.occurredAt && normalizedDraft.accountId) {
      const siblingCandidates: Transaction[] = drafts
        .filter((draft) => draft.id !== normalizedDraft.id && Number(draft.amount) > 0 && draft.occurredAt && draft.accountId)
        .map((draft) => ({
          id: draft.id,
          type: draft.type,
          amount: Number(draft.amount),
          currency: draft.currency,
          occurredAt: fromLocalInputDateTime(draft.occurredAt),
          categoryId: draft.categoryId,
          accountId: draft.accountId,
          destinationAccountId: draft.destinationAccountId,
          merchant: draft.merchant || undefined,
          balanceAfter: draft.balanceAfter ? Number(draft.balanceAfter) : undefined,
          description: draft.description || undefined,
          imageIds: [],
          createdAt: fromLocalInputDateTime(draft.occurredAt),
          updatedAt: fromLocalInputDateTime(draft.occurredAt),
          deleted: false,
        }))
      const existingIds = new Set(transactions.map((item) => item.id))
      const match = findDuplicateTransaction({
        type: normalizedDraft.type,
        amount: numericAmount,
        occurredAt: fromLocalInputDateTime(normalizedDraft.occurredAt),
        accountId: normalizedDraft.accountId,
        merchant: normalizedDraft.merchant,
        description: normalizedDraft.description,
      }, [...transactions, ...siblingCandidates])
      conflict = match ? {
        level: match.level,
        source: existingIds.has(match.transaction.id) ? 'existing' : 'batch',
        transactionId: match.transaction.id,
        occurredAt: match.transaction.occurredAt,
        amount: match.transaction.amount,
        merchant: match.transaction.merchant,
      } : undefined
    }
    setDrafts((current) => current.map((draft) => draft.id === normalizedDraft.id ? { ...normalizedDraft, conflict } : draft))
  }

  function mappingsFromCorrectedDraft(draft: BatchOcrDraft, lines: OcrDetectedLine[]) {
    const mappings: Record<string, OcrField | ''> = {}
    const unused = new Set(lines.map((line) => line.id))
    const take = (field: OcrField, predicate: (line: OcrDetectedLine) => boolean) => {
      const line = lines.find((item) => unused.has(item.id) && predicate(item))
      if (!line) return
      mappings[line.id] = field
      unused.delete(line.id)
    }

    const amountValue = Number(draft.amount)
    if (amountValue > 0) take('amount', (line) => parseMoneyText(line.text) === amountValue)
    if (draft.balanceAfter && Number(draft.balanceAfter) > 0) take('balanceAfter', (line) => parseMoneyText(line.text) === Number(draft.balanceAfter))
    if (draft.occurredAt) {
      const expected = Date.parse(fromLocalInputDateTime(draft.occurredAt))
      take('occurredAt', (line) => {
        const parsed = parseDateTimeText(line.text)
        return Boolean(parsed && Math.abs(Date.parse(parsed) - expected) <= 60_000)
      })
    }
    if (draft.merchant.trim()) {
      const target = normalized(draft.merchant)
      take('merchant', (line) => normalized(line.text).includes(target) || target.includes(normalized(line.text)))
    }
    if (draft.description.trim()) {
      const target = normalized(draft.description)
      take('description', (line) => normalized(line.text).includes(target) || target.includes(normalized(line.text)))
    }
    return mappings
  }

  async function persistTemplates(next: OcrTemplate[]) {
    if (!settings) return
    const now = new Date().toISOString()
    await saveEntity({ ...settings, ocrTemplates: next, updatedAt: now })
    setSessionTemplates(next)
  }

  async function learnFromDraft(draft: BatchOcrDraft, preserveIds = reviewedIds) {
    if (!draft.templateId || !activeAnalysis || !activeTemplate || !activeLines.length || !settings) return
    const mappings = mappingsFromCorrectedDraft(draft, activeLines)
    const mappedFields = Object.values(mappings).filter((field): field is OcrField => Boolean(field))
    if (!canAutoLearnTemplate(activeAnalysis.templateScore, mappedFields)) return
    const learned = buildPatternTemplate(activeTemplate.name, activeLines, mappings, activeAnalysis.visual, activeTemplate.id)
    const merged = mergePatternTemplateEvidence(activeTemplate, learned)
    const nextTemplates = sessionTemplates.map((template) => template.id === merged.id ? merged : template)
    await persistTemplates(nextTemplates)
    buildDraftsFromAnalyses(analyses, nextTemplates, true, preserveIds)
  }

  async function changeActive(nextId: string) {
    const current = drafts.find((draft) => draft.id === activeId)
    if (current) {
      const nextReviewed = new Set(reviewedIds)
      nextReviewed.add(current.id)
      setReviewedIds(nextReviewed)
      try { await learnFromDraft(current, nextReviewed) } catch { /* corrections still remain in the draft */ }
    }
    setActiveId(nextId)
    void persistCheckpoint(analyses, drafts, new Set([...reviewedIds, ...(current ? [current.id] : [])]), nextId)
  }

  async function savePattern() {
    if (!settings || !activeAnalysis || !activeLines.length || !patternName.trim()) return
    const effectiveMappings = Object.values(lineMappings).some(Boolean)
      ? lineMappings
      : active ? mappingsFromCorrectedDraft(active, activeLines) : {}
    if (Object.values(effectiveMappings).filter(Boolean).length < 2) return
    const existing = activeTemplate
    const learned = buildPatternTemplate(patternName.trim(), activeLines, effectiveMappings, activeAnalysis.visual, existing?.id)
    const effectiveTemplate = existing ? mergePatternTemplateEvidence(existing, learned) : learned
    const nextTemplates = existing
      ? sessionTemplates.map((template) => template.id === existing.id ? effectiveTemplate : template)
      : [...sessionTemplates, effectiveTemplate]
    await persistTemplates(nextTemplates)
    buildDraftsFromAnalyses(analyses, nextTemplates, false)
    setLineMappings({})
    setPatternName(effectiveTemplate.name)
    setError(undefined)
  }

  async function saveSelected() {
    if (!repository || saving) return
    if (active) {
      const nextReviewed = new Set(reviewedIds)
      nextReviewed.add(active.id)
      setReviewedIds(nextReviewed)
      try { await learnFromDraft(active, nextReviewed) } catch { /* saving the corrected draft remains authoritative */ }
    }
    const selected = drafts.filter((draft) => draft.selected)
    if (!selected.length) {
      setError(t('batch.errorNoneSelected'))
      return
    }
    for (const draft of selected) {
      const numericAmount = Number(draft.amount)
      const account = accounts.find((item) => item.id === draft.accountId)
      const allowed = account ? accountCurrencies(account) : []
      if (!numericAmount || numericAmount <= 0 || !draft.accountId || !draft.occurredAt || !allowed.includes(draft.currency)) {
        setActiveId(draft.id)
        setError(t('batch.errorInvalidDraft'))
        return
      }
    }

    setSaving(true)
    setError(undefined)
    try {
      const imageIds = new Map<number, string>()
      for (const fileIndex of [...new Set(selected.map((draft) => draft.fileIndex))]) {
        const file = files[fileIndex]
        if (file) imageIds.set(fileIndex, (await repository.saveImage(file)).id)
      }
      const now = new Date().toISOString()
      const batchId = selected.length > 1 ? crypto.randomUUID() : undefined
      const records: Transaction[] = selected.map((draft, index) => {
        const numericAmount = Number(draft.amount)
        return {
          id: crypto.randomUUID(),
          type: draft.type,
          amount: numericAmount,
          currency: draft.currency,
          occurredAt: fromLocalInputDateTime(draft.occurredAt),
          categoryId: draft.categoryId,
          accountId: draft.accountId,
          destinationAccountId: draft.type === 'transfer' ? draft.destinationAccountId : undefined,
          destinationCurrency: draft.type === 'transfer' ? draft.currency : undefined,
          destinationAmount: draft.type === 'transfer' ? numericAmount : undefined,
          merchant: draft.merchant.trim() || undefined,
          balanceAfter: draft.balanceAfter ? Number(draft.balanceAfter) : undefined,
          description: draft.description.trim() || undefined,
          importSource: draft.sourceHash ? { adapterId: 'owallet-image-v2', sourceId: draft.sourceHash, sourceRowIds: draft.sourceRowId ? [draft.sourceRowId] : [], sourceFileName: files[draft.fileIndex]?.name } : undefined,
          batch: batchId ? { id: batchId, mode: 'ocr-batch', index, count: selected.length } : undefined,
          imageIds: imageIds.has(draft.fileIndex) ? [imageIds.get(draft.fileIndex)!] : [],
          createdAt: now,
          updatedAt: now,
          deleted: false,
        }
      })
      await saveEntities(records)
      await repository.deleteEncryptedCheckpoint('image-import-v2')
      setCheckpointAvailable(false)
      onClose()
    } catch (saveError) {
      setError(localizeError(saveError, t, 'modal.errorSave'))
    } finally {
      setSaving(false)
    }
  }

  const selectedCount = drafts.filter((draft) => draft.selected).length

  return <div className="min-w-0 space-y-4 p-4 sm:p-5">
    <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-500/30 dark:bg-blue-500/5">
      <div className="flex items-start gap-3">
        <Images className="mt-0.5 shrink-0 text-blue-500" size={20}/>
        <div className="min-w-0"><h3 className="font-bold text-stone-900 dark:text-white">{t('imageImport.title')}</h3><p className="mt-1 text-sm leading-6 text-stone-500">{t('imageImport.hint')}</p></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-stone-800 shadow-sm ring-1 ring-stone-200 hover:bg-stone-50 dark:bg-stone-900 dark:text-stone-100 dark:ring-stone-700"><ImagePlus size={17}/>{t('modal.chooseImages')}<input hidden type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple onChange={(event)=>{const selected=Array.from(event.target.files??[]);event.currentTarget.value='';void chooseImages(selected)}}/></label>
        <Button onClick={()=>void analyzeImages()} disabled={!files.length||busy}><ScanText size={17}/>{busy?t('imageImport.analyzing'):t('imageImport.analyze')}</Button>
        {busy&&<Button variant="secondary" onClick={cancelAnalysis}><Square size={15}/>{t('imageImport.cancel')}</Button>}
      </div>
      {previewUrls.length>0&&<div className="mt-3 flex gap-2 overflow-x-auto pb-1">{previewUrls.map((url,index)=><img key={url} src={url} alt="" className="h-24 w-20 shrink-0 rounded-xl border border-stone-200 object-cover dark:border-stone-700"/>)}</div>}
      {busy&&<><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"><div className="h-full bg-blue-500 transition-all" style={{width:`${Math.round(progress*100)}%`}}/></div><div className="mt-1 text-xs text-stone-500">{status}</div></>}
      {!busy&&status&&<div className="mt-2 text-xs text-stone-500">{status}</div>}
      {checkpointAvailable&&<div className="mt-2 text-xs text-stone-500">{t('imageImport.checkpointReady')}</div>}
      {activeAnalysis?.diagnostics&&<details className="mt-2 text-xs text-stone-500"><summary className="cursor-pointer font-semibold">{t('imageImport.diagnostics')}</summary><div className="mt-1 grid gap-1 sm:grid-cols-2"><span>{t('imageImport.tiles',{count:activeAnalysis.diagnostics.tileCount})}</span><span>{t('imageImport.retries',{count:activeAnalysis.diagnostics.retryCount})}</span><span>tile {activeAnalysis.diagnostics.tileHeight}px</span><span>{Math.round(activeAnalysis.diagnostics.tileDurationsMs.reduce((a,b)=>a+b,0)/Math.max(1,activeAnalysis.diagnostics.tileDurationsMs.length))} ms/tile</span></div><Button variant="ghost" className="mt-2 px-2 py-1 text-xs" onClick={exportDiagnostics}><Download size={14}/>{t('imageImport.exportDiagnostics')}</Button><p className="mt-1 text-[10px] leading-4 opacity-80">{t('imageImport.diagnosticsPrivacy')}</p></details>}
    </div>

    {drafts.length>0&&<BatchOcrReview drafts={drafts} previewUrls={previewUrls} files={files} accounts={accounts} categories={categories} catalogues={settings?.accountCatalogues??[]} activeId={activeId} onActiveId={(id)=>void changeActive(id)} onChange={updateDraft}/>}

    {active&&activeAnalysis&&<details className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <summary className="cursor-pointer list-none"><div className="flex items-center gap-2 font-bold text-stone-800 dark:text-stone-100"><BrainCircuit size={18} className="text-blue-500"/>{t('imageImport.patternTitle')}</div><p className="mt-1 text-xs leading-5 text-stone-500">{activeTemplate?t('imageImport.templateMatched',{name:activeTemplate.name}):t('imageImport.templateNone')}</p></summary>
      <div className="mt-4 space-y-3">
        <p className="text-xs leading-5 text-stone-500">{t('imageImport.patternHint')}</p>
        <OcrTeachingPanel lines={activeLines} mappings={lineMappings} onMap={(line,field)=>setLineMappings((current)=>({...current,[line.id]:field}))}/>
        <div className="flex flex-col gap-2 sm:flex-row"><Input value={patternName} onChange={(event)=>setPatternName(event.target.value)} placeholder={t('imageImport.patternName')}/><Button variant="secondary" onClick={()=>void savePattern()} disabled={!patternName.trim()||Object.values(lineMappings).filter(Boolean).length<2}><BrainCircuit size={17}/>{t('imageImport.savePattern')}</Button></div>
      </div>
    </details>}

    {error&&<div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}

    <div className="flex justify-end gap-2 border-t border-stone-200 pt-4 dark:border-stone-800"><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button onClick={()=>void saveSelected()} disabled={!selectedCount||busy||saving}>{saving?<><LoaderCircle className="animate-spin" size={17}/>{t('modal.saving')}</>:t('imageImport.saveSelected',{count:selectedCount})}</Button></div>
  </div>
}
