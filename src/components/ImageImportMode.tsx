import { useEffect, useMemo, useRef, useState } from 'react'
import { BrainCircuit, Download, ImagePlus, Images, LoaderCircle, ScanText, Square } from 'lucide-react'
import type { Account, AccountCatalogue, AppSettings, Category, OcrDetectedLine, OcrField, OcrResult, OcrRuntimeDiagnostics, OcrTemplate, OcrTileResumeState, OcrTransactionBlock, OcrVisualFingerprint, ParsedTransactionCandidate, Transaction, TransactionType } from '../types'
import { useWallet } from '../WalletContext'
import { localizeError, useI18n } from '../i18n'
import { accountCurrencies } from '../lib/accounts'
import { findDuplicateTransaction } from '../lib/duplicates'
import { sourceFingerprint } from '../lib/fileFingerprint'
import { buildImageImportBlockRowId, buildImageImportSemanticRowId, imageImportBlockFingerprint, imageImportImageId, imageImportRecordId, imageImportTransactionHash, importSourcesMatch, sourceIdsMatch } from '../lib/importIdentity'
import { sanitizeOcrTileResumeMap } from '../lib/ocrCheckpoint'
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
import { bboxOverlapRatio, canAutoLearnTemplate, isCredibleTemplateMatch, mapDetectedLinesToRegions, OCR_HEURISTIC_THRESHOLDS } from '../lib/ocrHeuristics'
import { findMatchingTransactionRule } from '../lib/rules'
import { selectableCategories } from '../lib/categories'
import { validateImageBatch } from '../lib/security'
import { suggestOcrMappings } from '../lib/ocrSemantic'
import { BatchOcrReview, type BatchOcrDraft } from './BatchOcrReview'
import { Button, Input, Select } from './ui'
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
  version: 1 | 2
  updatedAt: string
  analyses: SourceAnalysis[]
  drafts: BatchOcrDraft[]
  reviewedIds: string[]
  activeId?: string
  partialTiles?: Record<string, OcrTileResumeState>
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

function detectedLinesForDraft(draft: BatchOcrDraft | undefined, analysis: SourceAnalysis | undefined) {
  if (!draft || !analysis || !draft.sourceBBox) return [] as OcrDetectedLine[]
  const box = draft.sourceBBox
  return buildDetectedLines(analysis.result, analysis.width, analysis.height)
    .filter((line) => {
      const center = (line.y + line.height / 2) * analysis.height
      return center >= box.y && center <= box.y + box.height
    })
    .map((line) => ({
      ...line,
      y: Math.max(0, ((line.y * analysis.height) - box.y) / Math.max(1, box.height)),
      height: Math.min(1, (line.height * analysis.height) / Math.max(1, box.height)),
    }))
}

function patternVisualForDraft(draft: BatchOcrDraft | undefined, analysis: SourceAnalysis | undefined) {
  if (!analysis) return undefined
  if (!draft?.sourceBBox?.width || !draft.sourceBBox.height) return analysis.visual
  return {
    ...analysis.visual,
    aspectRatio: draft.sourceBBox.width / Math.max(1, draft.sourceBBox.height),
  }
}

export type ImageImportSettings = Partial<Pick<AppSettings,
  'ocrTemplates' | 'accountCatalogues' | 'transactionRules' | 'transactionDefaults' | 'transactionCurrency' | 'defaultCurrency'
>>

export interface ImageImportModeProps {
  onClose: () => void
  accountsOverride?: Account[]
  categoriesOverride?: Category[]
  cataloguesOverride?: AccountCatalogue[]
  settingsOverride?: ImageImportSettings
  transactionsOverride?: Transaction[]
  checkpointKey?: string
  onSaveTemplates?: (templates: OcrTemplate[]) => Promise<void>
  onSaveDrafts?: (drafts: BatchOcrDraft[], files: File[]) => Promise<void>
}

export function ImageImportMode({
  onClose,
  accountsOverride,
  categoriesOverride,
  cataloguesOverride,
  settingsOverride,
  transactionsOverride,
  checkpointKey = 'image-import-v2',
  onSaveTemplates,
  onSaveDrafts,
}: ImageImportModeProps) {
  const wallet = useWallet()
  const repository = wallet.repository
  const saveEntity = wallet.saveEntity
  const saveEntities = wallet.saveEntities
  const personalSettings = wallet.settings
  const accounts = accountsOverride ?? wallet.accounts
  const categories = categoriesOverride ?? wallet.categories
  const settings: ImageImportSettings | undefined = settingsOverride ?? personalSettings
  const transactions = transactionsOverride ?? wallet.transactions
  const catalogues = cataloguesOverride ?? settings?.accountCatalogues ?? []
  const { t } = useI18n()
  const [files, setFiles] = useState<File[]>([])
  const [fileHashes, setFileHashes] = useState<string[]>([])
  const [analyses, setAnalyses] = useState<SourceAnalysis[]>([])
  const [drafts, setDrafts] = useState<BatchOcrDraft[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [patternSourceIndex, setPatternSourceIndex] = useState<number>()
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string>()
  const [patternName, setPatternName] = useState('')
  const [legacyTemplateId, setLegacyTemplateId] = useState('')
  const [lineMappings, setLineMappings] = useState<Record<string, OcrField | ''>>({})
  const [sessionTemplates, setSessionTemplates] = useState<OcrTemplate[]>(settings?.ocrTemplates ?? [])
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(() => new Set())
  const [checkpointAvailable, setCheckpointAvailable] = useState(false)
  const [tileResumeByHash, setTileResumeByHash] = useState<Record<string, OcrTileResumeState>>({})
  const abortRef = useRef<AbortController | undefined>(undefined)
  const checkpointWriteRef = useRef<Promise<void>>(Promise.resolve())
  const checkpointGenerationRef = useRef(0)
  const sessionTemplatesRef = useRef<OcrTemplate[]>(settings?.ocrTemplates ?? [])
  const reviewedIdsRef = useRef<Set<string>>(new Set())
  const learningQueueRef = useRef<Promise<void>>(Promise.resolve())
  const learningRevisionRef = useRef<Map<string, number>>(new Map())
  const learningGenerationRef = useRef(0)
  const saveGuardRef = useRef(false)

  useEffect(() => {
    const nextTemplates = settings?.ocrTemplates ?? []
    sessionTemplatesRef.current = nextTemplates
    setSessionTemplates(nextTemplates)
  }, [settings?.ocrTemplates])

  useEffect(() => {
    reviewedIdsRef.current = reviewedIds
  }, [reviewedIds])

  useEffect(() => {
    let cancelled = false
    void repository?.getEncryptedCheckpoint<ImageImportCheckpoint>(checkpointKey).then(async (checkpoint) => {
      const age = checkpoint?.updatedAt ? Date.now() - Date.parse(checkpoint.updatedAt) : Number.POSITIVE_INFINITY
      const stale = !Number.isFinite(age) || age > 7 * 24 * 60 * 60_000
      if (stale && checkpoint) {
        await repository.deleteEncryptedCheckpoint(checkpointKey)
        if (!cancelled) setCheckpointAvailable(false)
        return
      }
      if (!cancelled) {
        const partialTiles = sanitizeOcrTileResumeMap(checkpoint?.partialTiles)
        setCheckpointAvailable(Boolean(checkpoint?.analyses?.length || checkpoint?.drafts?.length || Object.keys(partialTiles).length))
        setTileResumeByHash(partialTiles)
      }
    })
    return () => {
      cancelled = true
      learningGenerationRef.current += 1
      abortRef.current?.abort()
    }
  }, [checkpointKey, repository])

  const active = drafts.find((draft) => draft.id === activeId) ?? drafts[0]
  const activeAnalysis = active ? analyses.find((item) => item.fileIndex === active.fileIndex) : undefined
  const patternAnalysis = activeAnalysis
    ?? analyses.find((item) => item.fileIndex === patternSourceIndex)
    ?? analyses[0]
  const activeTemplate = active?.templateId ? sessionTemplates.find((item) => item.id === active.templateId) : undefined
  const patternTemplate = activeTemplate
    ?? (patternAnalysis?.templateId ? sessionTemplates.find((item) => item.id === patternAnalysis.templateId) : undefined)
  const legacyTemplates = sessionTemplates.filter((template) => template.schemaVersion !== 2 && template.enabled !== false && template.regions.length)

  const activePatternVisual = useMemo(
    () => patternVisualForDraft(active, patternAnalysis),
    [active, patternAnalysis],
  )

  const activeLines = useMemo(
    () => {
      if (!patternAnalysis) return [] as OcrDetectedLine[]
      return active
        ? detectedLinesForDraft(active, patternAnalysis)
        : buildDetectedLines(patternAnalysis.result, patternAnalysis.width, patternAnalysis.height)
    },
    [active, patternAnalysis],
  )

  useEffect(() => {
    setLineMappings({})
    setPatternName(patternTemplate?.name ?? '')
  }, [activeId, patternAnalysis?.fileIndex, patternTemplate?.id])

  async function chooseImages(selected: File[]) {
    setError(undefined)
    try {
      await validateImageBatch(selected, { unlimitedCount: true })
      const hashes: string[] = []
      for (const file of selected) hashes.push(await sourceFingerprint(file))
      setFiles(selected)
      setFileHashes(hashes)
      setPatternSourceIndex(undefined)
      learningGenerationRef.current += 1
      learningRevisionRef.current.clear()
      setProgress(0)

      const checkpoint = await repository?.getEncryptedCheckpoint<ImageImportCheckpoint>(checkpointKey)
      const resolveHash = (storedHash?: string) => {
        if (!storedHash) return undefined
        const index = hashes.findIndex((hash) => sourceIdsMatch(hash, storedHash))
        return index >= 0 ? { index, hash: hashes[index] } : undefined
      }
      const restoredAnalyses = (checkpoint?.analyses ?? []).flatMap((analysis): SourceAnalysis[] => {
        const resolved = resolveHash(analysis.sourceHash)
        return resolved ? [{ ...analysis, fileIndex: resolved.index, sourceHash: resolved.hash }] : []
      })
      const restoredDrafts = (checkpoint?.drafts ?? []).flatMap((draft): BatchOcrDraft[] => {
        const resolved = resolveHash(draft.sourceHash)
        return resolved ? [{ ...draft, fileIndex: resolved.index, sourceHash: resolved.hash }] : []
      })

      const sanitizedPartial = sanitizeOcrTileResumeMap(checkpoint?.partialTiles)
      const restoredPartial: Record<string, OcrTileResumeState> = {}
      for (const [storedHash, state] of Object.entries(sanitizedPartial)) {
        const resolved = resolveHash(storedHash)
        if (resolved) restoredPartial[resolved.hash] = state
      }
      setAnalyses(restoredAnalyses)
      setDrafts(restoredDrafts)
      setTileResumeByHash(restoredPartial)
      const restoredReviewed = new Set((checkpoint?.reviewedIds ?? []).filter((id) => restoredDrafts.some((draft) => draft.id === id)))
      reviewedIdsRef.current = restoredReviewed
      setReviewedIds(restoredReviewed)
      setActiveId(restoredDrafts.some((draft) => draft.id === checkpoint?.activeId) ? checkpoint?.activeId : restoredDrafts[0]?.id)
      setCheckpointAvailable(Boolean(restoredAnalyses.length || restoredDrafts.length || Object.keys(restoredPartial).length))
      setStatus(restoredAnalyses.length ? t('imageImport.resumeRestored',{count:restoredAnalyses.length}) : '')
    } catch (validationError) {
      setFiles([])
      setFileHashes([])
      setError(localizeError(validationError, t, 'error.imageInvalid'))
    }
  }

  async function persistCheckpoint(
    nextAnalyses = analyses,
    nextDrafts = drafts,
    nextReviewed = reviewedIdsRef.current,
    nextActiveId = activeId,
    nextPartialTiles = tileResumeByHash,
  ) {
    if (!repository) return
    const generation = checkpointGenerationRef.current
    const payload: ImageImportCheckpoint = {
      version: 2,
      updatedAt: new Date().toISOString(),
      analyses: nextAnalyses,
      drafts: nextDrafts,
      reviewedIds: [...nextReviewed],
      activeId: nextActiveId,
      partialTiles: nextPartialTiles,
    }
    const write = checkpointWriteRef.current.catch(() => undefined).then(async () => {
      if (generation !== checkpointGenerationRef.current) return
      await repository.setEncryptedCheckpoint<ImageImportCheckpoint>(checkpointKey, payload)
      if (generation === checkpointGenerationRef.current) setCheckpointAvailable(true)
    })
    checkpointWriteRef.current = write.catch(() => undefined)
    try {
      await write
    } catch {
      // Checkpoint failure must never block importing or saving transactions.
    }
  }

  async function invalidateCheckpointWrites() {
    checkpointGenerationRef.current += 1
    try { await checkpointWriteRef.current } catch { /* stale writes are ignored */ }
  }

  function cancelAnalysis() {
    abortRef.current?.abort()
  }

  async function discardCheckpoint() {
    await invalidateCheckpointWrites()
    await repository?.deleteEncryptedCheckpoint(checkpointKey)
    setTileResumeByHash({})
    setCheckpointAvailable(false)
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
    sourceRowIds: string[],
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
    const candidateImportSource = { adapterId: 'owallet-image-v2', sourceId: sourceHash, sourceRowIds }
    const sourceDuplicate = priorTransactions.find((tx) => importSourcesMatch(tx.importSource, candidateImportSource))
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
      selected: !conflict,
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
      sourceRowIds,
      conflictDecision: conflict ? 'pending' : undefined,
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

  async function enrichTransactionHashes(input: BatchOcrDraft[]) {
    const hashes = new Map<string, string[]>()
    const next = await Promise.all(input.map(async (draft) => {
      const numericAmount = Number(draft.amount)
      if (!(numericAmount > 0) || !draft.occurredAt) return draft
      const transactionHash = await imageImportTransactionHash({
        type: draft.type,
        amount: numericAmount,
        currency: draft.currency,
        occurredAt: fromLocalInputDateTime(draft.occurredAt),
        accountId: draft.accountId,
        merchant: draft.merchant,
        description: draft.description,
      })
      const ids = hashes.get(transactionHash) ?? []
      ids.push(draft.id)
      hashes.set(transactionHash, ids)
      return { ...draft, transactionHash }
    }))
    const duplicateHashes = new Set([...hashes.entries()].filter(([, ids]) => ids.length > 1).map(([hash]) => hash))
    return next.map((draft) => {
      if (!draft.transactionHash || !duplicateHashes.has(draft.transactionHash) || draft.conflict) return draft
      const sibling = next.find((candidate) => candidate.id !== draft.id && candidate.transactionHash === draft.transactionHash)
      if (!sibling) return draft
      return {
        ...draft,
        selected: false,
        conflictDecision: 'pending' as const,
        conflict: {
          level: 'exact' as const,
          source: 'batch' as const,
          transactionId: sibling.id,
          occurredAt: fromLocalInputDateTime(sibling.occurredAt),
          amount: Number(sibling.amount),
          merchant: sibling.merchant || undefined,
        },
      }
    })
  }

  function buildDraftsFromAnalyses(nextAnalyses: SourceAnalysis[], templates = sessionTemplatesRef.current, preserveReviewed = true, preserveIds = reviewedIdsRef.current) {
    const next: BatchOcrDraft[] = []
    const candidates: Transaction[] = [...transactions]
    for (const analysis of nextAnalyses) {
      const matched = blocksForAnalysis(analysis, templates)
      analysis.templateId = matched.template?.id
      analysis.templateScore = matched.score
      analysis.templateAnchorScore = matched.anchorScore
      analysis.templateVisualScore = matched.visualScore
      const semanticOccurrences = new Map<string, number>()
      const blockOccurrences = new Map<string, number>()
      for (let blockIndex = 0; blockIndex < matched.blocks.length; blockIndex += 1) {
        const block = matched.blocks[blockIndex]
        const sourceRowId = `row:${blockIndex}`
        const semanticId = buildImageImportSemanticRowId(block.candidate)
        const occurrence = semanticId ? (semanticOccurrences.get(semanticId) ?? 0) : undefined
        if (semanticId) semanticOccurrences.set(semanticId, occurrence! + 1)
        const blockFingerprint = imageImportBlockFingerprint(block.candidate.rawText)
        const blockOccurrence = blockFingerprint ? (blockOccurrences.get(blockFingerprint) ?? 0) : undefined
        if (blockFingerprint) blockOccurrences.set(blockFingerprint, blockOccurrence! + 1)
        const blockId = buildImageImportBlockRowId(block.candidate.rawText, blockOccurrence)
        const sourceRowIds = [
          sourceRowId,
          ...(semanticId ? [semanticId, `occ:${occurrence}`] : []),
          ...(blockId ? [blockId] : []),
        ]
        const nextDraft = resolveDraft(analysis.fileIndex, block, analysis.width, analysis.height, candidates, analysis.sourceHash, sourceRowId, sourceRowIds)
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
            importSource: chosen.sourceHash ? { adapterId: 'owallet-image-v2', sourceId: chosen.sourceHash, sourceRowIds: chosen.sourceRowIds?.length ? chosen.sourceRowIds : chosen.sourceRowId ? [chosen.sourceRowId] : [] } : undefined,
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
    const nextAnalyses: SourceAnalysis[] = analyses.filter((analysis) => fileHashes[analysis.fileIndex] === analysis.sourceHash)
    let nextPartialTiles = { ...tileResumeByHash }
    let lastTileCheckpointPersistAt = 0
    try {
      for (let index = 0; index < files.length; index += 1) {
        const existing = nextAnalyses.find((analysis) => analysis.sourceHash === fileHashes[index])
        if (existing) {
          setProgress((index + 1) / files.length)
          continue
        }
        const file = files[index]
        const sourceHash = fileHashes[index]
        const ocr = await recognizeImageTiled(file, (value, text) => {
          setProgress((index + value * 0.98) / files.length)
          setStatus(`${index + 1}/${files.length} · ${text}`)
        }, {
          signal: controller.signal,
          retries: 1,
          resumeState: nextPartialTiles[sourceHash],
          onTileCheckpoint: async (state) => {
            nextPartialTiles = { ...nextPartialTiles, [sourceHash]: state }
            setTileResumeByHash(nextPartialTiles)
            const now = performance.now()
            const due = state.nextTileIndex % 3 === 0 || now - lastTileCheckpointPersistAt >= 2_500
            if (due) {
              lastTileCheckpointPersistAt = now
              await persistCheckpoint(nextAnalyses, drafts, reviewedIdsRef.current, activeId, nextPartialTiles)
            }
          },
        })
        const { [sourceHash]: _completedPartial, ...remainingPartials } = nextPartialTiles
        nextPartialTiles = remainingPartials
        setTileResumeByHash(nextPartialTiles)
        nextAnalyses.push({
          fileIndex: index,
          sourceHash,
          result: ocr.result,
          width: ocr.width,
          height: ocr.height,
          visual: ocr.visual,
          diagnostics: ocr.diagnostics,
        })
        nextAnalyses.sort((a,b)=>a.fileIndex-b.fileIndex)
        const partialDrafts = await enrichTransactionHashes(buildDraftsFromAnalyses(nextAnalyses, sessionTemplates, true))
        setDrafts(partialDrafts)
        await persistCheckpoint(nextAnalyses, partialDrafts, reviewedIdsRef.current, partialDrafts[0]?.id, nextPartialTiles)
      }
      const nextDrafts = await enrichTransactionHashes(buildDraftsFromAnalyses(nextAnalyses, sessionTemplates, true))
      setDrafts(nextDrafts)
      await persistCheckpoint(nextAnalyses, nextDrafts, reviewedIdsRef.current, activeId ?? nextDrafts[0]?.id, nextPartialTiles)
      setError(undefined)
      setProgress(1)
      setStatus('')
    } catch (analysisError) {
      if ((analysisError as Error)?.name === 'AbortError') {
        await persistCheckpoint(nextAnalyses, drafts, reviewedIdsRef.current, activeId, nextPartialTiles)
        setStatus(t('imageImport.cancelled'))
      } else {
        setError(localizeError(analysisError, t, 'modal.errorOcr'))
      }
    } finally {
      abortRef.current = undefined
      setBusy(false)
    }
  }

  function refreshDraftSourceIdentities(input: BatchOcrDraft[]) {
    const bySource = new Map<string, BatchOcrDraft[]>()
    for (const draft of input) {
      const key = draft.sourceHash ? `${draft.fileIndex}|${draft.sourceHash}` : `file:${draft.fileIndex}`
      const group = bySource.get(key) ?? []
      group.push(draft)
      bySource.set(key, group)
    }

    const updates = new Map<string, BatchOcrDraft>()
    for (const group of bySource.values()) {
      const semanticOccurrences = new Map<string, number>()
      const sorted = [...group].sort((a, b) => (a.sourceBBox?.y ?? 0) - (b.sourceBBox?.y ?? 0))
      for (const draft of sorted) {
        const numericAmount = Number(draft.amount)
        const semanticId = buildImageImportSemanticRowId({
          type: draft.type,
          amount: numericAmount > 0 ? numericAmount : undefined,
          occurredAt: draft.occurredAt ? fromLocalInputDateTime(draft.occurredAt) : undefined,
          merchant: draft.merchant.trim() || undefined,
          description: draft.description.trim() || undefined,
        })
        const occurrence = semanticId ? (semanticOccurrences.get(semanticId) ?? 0) : undefined
        if (semanticId) semanticOccurrences.set(semanticId, occurrence! + 1)

        const stableIds = (draft.sourceRowIds?.length
          ? draft.sourceRowIds
          : draft.sourceRowId ? [draft.sourceRowId] : [])
          .filter((id) => !id.startsWith('sig:') && !id.startsWith('occ:'))
        const sourceRowIds = semanticId
          ? [...stableIds, semanticId, `occ:${occurrence}`]
          : stableIds
        updates.set(draft.id, {
          ...draft,
          sourceRowIds,
          sourceRowId: stableIds.find((id) => id.startsWith('row:')) ?? draft.sourceRowId,
        })
      }
    }
    return input.map((draft) => updates.get(draft.id) ?? draft)
  }

  function updateDraft(next: BatchOcrDraft) {
    const previous = drafts.find((draft) => draft.id === next.id)
    const feedbackChanged = Boolean(previous && (
      previous.type !== next.type
      || previous.amount !== next.amount
      || previous.occurredAt !== next.occurredAt
      || previous.merchant !== next.merchant
      || previous.balanceAfter !== next.balanceAfter
      || previous.description !== next.description
    ))
    if (feedbackChanged) {
      learningRevisionRef.current.set(next.id, (learningRevisionRef.current.get(next.id) ?? 0) + 1)
      if (reviewedIdsRef.current.has(next.id)) {
        const updatedReviewed = new Set(reviewedIdsRef.current)
        updatedReviewed.delete(next.id)
        reviewedIdsRef.current = updatedReviewed
        setReviewedIds(updatedReviewed)
      }
    }
    const compatibleCategories = selectableCategories(categories, next.type)
    const account = accounts.find((item) => item.id === next.accountId)
    const allowedCurrencies = account ? accountCurrencies(account) : []
    const normalizedDraft: BatchOcrDraft = {
      ...next,
      categoryId: compatibleCategories.some((category) => category.id === next.categoryId) ? next.categoryId : compatibleCategories[0]?.id ?? next.categoryId,
      currency: allowedCurrencies.includes(next.currency) ? next.currency : allowedCurrencies[0] ?? next.currency,
    }
    const numericAmount = Number(normalizedDraft.amount)
    const identityRefreshed = refreshDraftSourceIdentities(
      drafts.map((draft) => draft.id === normalizedDraft.id ? normalizedDraft : draft),
    )
    const refreshedDraft = identityRefreshed.find((draft) => draft.id === normalizedDraft.id) ?? normalizedDraft
    normalizedDraft.sourceRowIds = refreshedDraft.sourceRowIds
    normalizedDraft.sourceRowId = refreshedDraft.sourceRowId
    const sourceRowIds = normalizedDraft.sourceRowIds ?? []
    let conflict: BatchOcrDraft['conflict']
    const sourceDuplicate = normalizedDraft.sourceHash && sourceRowIds.length
      ? transactions.find((tx) => importSourcesMatch(tx.importSource, { adapterId: 'owallet-image-v2', sourceId: normalizedDraft.sourceHash!, sourceRowIds }))
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
    setDrafts((current) => {
      const next = refreshDraftSourceIdentities(
        current.map((draft) => draft.id === normalizedDraft.id ? {
          ...normalizedDraft,
          conflict,
          conflictDecision: conflict ? (normalizedDraft.conflictDecision ?? 'pending') : undefined,
        } : draft),
      )
      void enrichTransactionHashes(next).then((hashed) => {
        setDrafts(hashed)
        void persistCheckpoint(analyses, hashed, reviewedIdsRef.current, activeId)
      })
      return next
    })
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
    if (!onSaveTemplates && !personalSettings) return
    const previous = sessionTemplatesRef.current
    sessionTemplatesRef.current = next
    try {
      if (onSaveTemplates) {
        await onSaveTemplates(next)
      } else {
        if (!personalSettings) return
        const now = new Date().toISOString()
        await saveEntity({ ...personalSettings, ocrTemplates: next, updatedAt: now })
      }
      setSessionTemplates(next)
    } catch (persistError) {
      if (sessionTemplatesRef.current === next) sessionTemplatesRef.current = previous
      throw persistError
    }
  }

  async function learnFromDraft(draft: BatchOcrDraft, preserveIds = reviewedIdsRef.current) {
    if (!draft.templateId || (!personalSettings && !onSaveTemplates)) return
    const analysis = analyses.find((item) => item.fileIndex === draft.fileIndex)
    const template = sessionTemplatesRef.current.find((item) => item.id === draft.templateId)
    const lines = detectedLinesForDraft(draft, analysis)
    if (!analysis || !template || !lines.length) return
    const mappings = mappingsFromCorrectedDraft(draft, lines)
    const mappedFields = Object.values(mappings).filter((field): field is OcrField => Boolean(field))
    if (!canAutoLearnTemplate(analysis.templateScore, mappedFields)) return
    const learned = buildPatternTemplate(template.name, lines, mappings, patternVisualForDraft(draft, analysis), template.id)
    const merged = mergePatternTemplateEvidence(template, learned, { lines, mappings })
    const nextTemplates = sessionTemplatesRef.current.map((item) => item.id === merged.id ? merged : item)
    await persistTemplates(nextTemplates)
    const rebuilt = await enrichTransactionHashes(buildDraftsFromAnalyses(analyses, nextTemplates, true, preserveIds))
    setDrafts(rebuilt)
  }

  function enqueueLearnFromDraft(draft: BatchOcrDraft, preserveIds: Set<string>) {
    const revision = learningRevisionRef.current.get(draft.id) ?? 0
    const generation = learningGenerationRef.current
    const task = learningQueueRef.current
      .catch(() => undefined)
      .then(() => {
        if (learningGenerationRef.current !== generation) return
        if ((learningRevisionRef.current.get(draft.id) ?? 0) !== revision) return
        return learnFromDraft(draft, preserveIds)
      })
    learningQueueRef.current = task.catch(() => undefined)
    return task
  }

  function changeActive(nextId: string) {
    const current = drafts.find((draft) => draft.id === activeId)
    let nextReviewed = reviewedIdsRef.current
    if (current && !nextReviewed.has(current.id)) {
      nextReviewed = new Set(nextReviewed)
      nextReviewed.add(current.id)
      reviewedIdsRef.current = nextReviewed
      setReviewedIds(nextReviewed)
      void enqueueLearnFromDraft(current, nextReviewed).catch(() => undefined)
    }
    setActiveId(nextId)
    void persistCheckpoint(analyses, drafts, nextReviewed, nextId)
  }

  async function upgradeLegacyTemplate() {
    if (!legacyTemplateId || !patternAnalysis || !activeLines.length || (!personalSettings && !onSaveTemplates)) return
    await learningQueueRef.current.catch(() => undefined)
    const legacy = sessionTemplatesRef.current.find((template) => template.id === legacyTemplateId && template.schemaVersion !== 2)
    if (!legacy) return
    const inferred = mapDetectedLinesToRegions(activeLines, legacy.regions) as Record<string, OcrField | ''>
    const semanticCount = Object.values(inferred).filter((field) => field && field !== 'generic' && field !== 'ignore').length
    if (semanticCount < 2) {
      setError(t('imageImport.legacyUpgradeFailed'))
      return
    }
    const upgraded = buildPatternTemplate(
      t('imageImport.legacyUpgradeName', { name: legacy.name }),
      activeLines,
      inferred,
      activePatternVisual,
    )
    const nextTemplates = [...sessionTemplatesRef.current, upgraded]
    await persistTemplates(nextTemplates)
    setLineMappings(inferred)
    setPatternName(upgraded.name)
    setLegacyTemplateId('')
    const rebuilt = await enrichTransactionHashes(buildDraftsFromAnalyses(analyses, nextTemplates, false))
    setDrafts(rebuilt)
    setError(undefined)
  }

  async function savePattern() {
    if ((!personalSettings && !onSaveTemplates) || !patternAnalysis || !activeLines.length || !patternName.trim()) return
    await learningQueueRef.current.catch(() => undefined)
    const effectiveMappings = Object.values(lineMappings).some(Boolean)
      ? lineMappings
      : active
        ? mappingsFromCorrectedDraft(active, activeLines)
        : suggestOcrMappings(activeLines)
    if (Object.values(effectiveMappings).filter(Boolean).length < 2) return
    const existing = patternTemplate?.schemaVersion === 2
      ? sessionTemplatesRef.current.find((template) => template.id === patternTemplate.id)
      : undefined
    const learned = buildPatternTemplate(patternName.trim(), activeLines, effectiveMappings, activePatternVisual, existing?.id)
    const effectiveTemplate = existing ? mergePatternTemplateEvidence(existing, learned) : learned
    const nextTemplates = existing
      ? sessionTemplatesRef.current.map((template) => template.id === existing.id ? effectiveTemplate : template)
      : [...sessionTemplatesRef.current, effectiveTemplate]
    await persistTemplates(nextTemplates)
    const rebuilt = await enrichTransactionHashes(buildDraftsFromAnalyses(analyses, nextTemplates, false))
    setDrafts(rebuilt)
    setLineMappings({})
    setPatternName(effectiveTemplate.name)
    setError(undefined)
  }

  async function withPersonalImageImportLock<T>(task: () => Promise<T>) {
    const manager = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!manager) return task()
    return manager.request('owallet-personal-image-import-save', { mode: 'exclusive' }, task)
  }

  async function saveSelected() {
    if (!repository || saving || saveGuardRef.current) return
    const identityRefreshedDrafts = refreshDraftSourceIdentities(drafts)
    const unresolvedConflict = identityRefreshedDrafts.find((draft) => draft.conflict && (!draft.conflictDecision || draft.conflictDecision === 'pending'))
    if (unresolvedConflict) {
      setActiveId(unresolvedConflict.id)
      setError(t('batch.errorConflictPending'))
      return
    }
    const selected = identityRefreshedDrafts.filter((draft) => draft.selected && draft.conflictDecision !== 'ignore')
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

    saveGuardRef.current = true
    setSaving(true)
    setError(undefined)
    if (active && !reviewedIdsRef.current.has(active.id)) {
      const nextReviewed = new Set(reviewedIdsRef.current)
      nextReviewed.add(active.id)
      reviewedIdsRef.current = nextReviewed
      setReviewedIds(nextReviewed)
      try { await enqueueLearnFromDraft(active, nextReviewed) } catch { /* saving the corrected draft remains authoritative */ }
    } else {
      await learningQueueRef.current.catch(() => undefined)
    }
    if (onSaveDrafts) {
      try {
        await onSaveDrafts(selected, files)
        await invalidateCheckpointWrites()
        await repository.deleteEncryptedCheckpoint(checkpointKey)
        setTileResumeByHash({})
        setCheckpointAvailable(false)
        onClose()
      } catch (saveError) {
        setError(localizeError(saveError, t, 'modal.errorSave'))
      } finally {
        saveGuardRef.current = false
        setSaving(false)
      }
      return
    }

    const imageIds = new Map<number, string>()
    let pendingRecords: Transaction[] = []
    try {
      await withPersonalImageImportLock(async () => {
        const latestTransactions = await repository.getAll<Transaction>('transaction')
        const freshSelected = selected.filter((draft) => {
          if (!draft.sourceHash) return true
          const sourceRowIds = draft.sourceRowIds?.length ? draft.sourceRowIds : draft.sourceRowId ? [draft.sourceRowId] : []
          if (!sourceRowIds.length) return true
          const source = { adapterId: 'owallet-image-v2', sourceId: draft.sourceHash, sourceRowIds }
          return !latestTransactions.some((tx) => importSourcesMatch(tx.importSource, source))
        })
        if (!freshSelected.length) return

        for (const fileIndex of [...new Set(freshSelected.map((draft) => draft.fileIndex))]) {
          const file = files[fileIndex]
          const sourceHash = fileHashes[fileIndex]
          if (file) imageIds.set(fileIndex, (await repository.saveImage(file, sourceHash ? await imageImportImageId(sourceHash) : undefined)).id)
        }
        const now = new Date().toISOString()
        const batchId = freshSelected.length > 1 ? crypto.randomUUID() : undefined
        const records = await Promise.all(freshSelected.map(async (draft, index): Promise<Transaction> => {
          const numericAmount = Number(draft.amount)
          const sourceRowIds = draft.sourceRowIds?.length ? draft.sourceRowIds : draft.sourceRowId ? [draft.sourceRowId] : []
          return {
            id: draft.sourceHash && sourceRowIds.length ? await imageImportRecordId(draft.sourceHash, sourceRowIds) : crypto.randomUUID(),
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
            importSource: draft.sourceHash ? { adapterId: 'owallet-image-v2', sourceId: draft.sourceHash, sourceRowIds: draft.sourceRowIds?.length ? draft.sourceRowIds : draft.sourceRowId ? [draft.sourceRowId] : [], sourceFileName: files[draft.fileIndex]?.name } : undefined,
            batch: batchId ? { id: batchId, mode: 'ocr-batch', index, count: freshSelected.length } : undefined,
            imageIds: imageIds.has(draft.fileIndex) ? [imageIds.get(draft.fileIndex)!] : [],
            createdAt: now,
            updatedAt: now,
            deleted: false,
          }
        }))
        pendingRecords = records
        await saveEntities(records)
      })
      await invalidateCheckpointWrites()
      await repository.deleteEncryptedCheckpoint(checkpointKey)
      setTileResumeByHash({})
      setCheckpointAvailable(false)
      onClose()
    } catch (saveError) {
      if (imageIds.size && pendingRecords.length) {
        let verificationFailed = false
        const persisted: Transaction[] = []
        for (const record of pendingRecords) {
          try {
            const stored = await repository.get<Transaction>(record.id)
            if (stored && !stored.deleted) persisted.push(stored)
          } catch {
            verificationFailed = true
            break
          }
        }
        if (!verificationFailed) {
          const referenced = new Set(persisted.flatMap((record) => record.imageIds ?? []))
          for (const imageId of imageIds.values()) {
            if (!referenced.has(imageId)) {
              try { await repository.deleteImage(imageId) } catch { /* cleanup is best effort */ }
            }
          }
        }
      }
      setError(localizeError(saveError, t, 'modal.errorSave'))
    } finally {
      saveGuardRef.current = false
      setSaving(false)
    }
  }

  const selectedCount = drafts.filter((draft) => draft.selected).length
  const needsPattern = !busy && analyses.length > 0 && drafts.length === 0

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
      {files.length>0&&<div className="mt-3"><div className="mb-1 text-xs font-semibold text-stone-500">{t('imageImport.queueCount',{count:files.length})}</div><div className="flex gap-2 overflow-x-auto pb-1">{files.slice(0,24).map((file,index)=><div key={`${file.name}-${file.size}-${index}`} className="w-40 shrink-0 rounded-xl border border-stone-200 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-900"><div className="truncate text-xs font-semibold text-stone-700 dark:text-stone-200">{file.name}</div><div className="mt-1 text-[11px] text-stone-400">{Math.max(1,Math.round(file.size/1024))} KB</div></div>)}{files.length>24&&<div className="flex w-28 shrink-0 items-center justify-center rounded-xl border border-dashed border-stone-300 px-3 text-xs font-semibold text-stone-500 dark:border-stone-700">+{files.length-24}</div>}</div></div>}
      {busy&&<><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"><div className="h-full bg-blue-500 transition-all" style={{width:`${Math.round(progress*100)}%`}}/></div><div className="mt-1 text-xs text-stone-500">{status}</div></>}
      {!busy&&status&&<div className="mt-2 text-xs text-stone-500">{status}</div>}
      {checkpointAvailable&&<div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500"><span>{t('imageImport.checkpointReady')}</span><button type="button" className="font-semibold text-rose-600 hover:underline dark:text-rose-300" onClick={()=>void discardCheckpoint()}>{t('imageImport.discardCheckpoint')}</button></div>}
      {patternAnalysis?.diagnostics&&<details className="mt-2 text-xs text-stone-500"><summary className="cursor-pointer font-semibold">{t('imageImport.diagnostics')}</summary><div className="mt-1 grid gap-1 sm:grid-cols-2"><span>{t('imageImport.tiles',{count:patternAnalysis.diagnostics.tileCount})}</span><span>{t('imageImport.retries',{count:patternAnalysis.diagnostics.retryCount})}</span><span>tile {patternAnalysis.diagnostics.tileHeight}px</span><span>{Math.round(patternAnalysis.diagnostics.tileDurationsMs.reduce((a,b)=>a+b,0)/Math.max(1,patternAnalysis.diagnostics.tileDurationsMs.length))} ms/tile</span></div><Button variant="ghost" className="mt-2 px-2 py-1 text-xs" onClick={exportDiagnostics}><Download size={14}/>{t('imageImport.exportDiagnostics')}</Button><p className="mt-1 text-[10px] leading-4 opacity-80">{t('imageImport.diagnosticsPrivacy')}</p></details>}
    </div>

    {drafts.length>0&&<BatchOcrReview drafts={drafts} files={files} accounts={accounts} categories={categories} catalogues={catalogues} activeId={activeId} onActiveId={(id)=>void changeActive(id)} onChange={updateDraft}/>}

    {needsPattern&&<div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100"><div className="font-semibold">{t('imageImport.noDrafts')}</div><p className="mt-1 text-xs leading-5 opacity-80">{t('imageImport.noDraftsHint')}</p></div>}

    {patternAnalysis&&activeLines.length>0&&<details key={needsPattern?'pattern-required':'pattern-review'} open={needsPattern||undefined} className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <summary className="cursor-pointer list-none"><div className="flex items-center gap-2 font-bold text-stone-800 dark:text-stone-100"><BrainCircuit size={18} className="text-blue-500"/>{t('imageImport.patternTitle')}</div><p className="mt-1 text-xs leading-5 text-stone-500">{patternTemplate?t('imageImport.templateMatched',{name:patternTemplate.name}):t('imageImport.templateNone')}</p></summary>
      <div className="mt-4 space-y-3">
        <p className="text-xs leading-5 text-stone-500">{t('imageImport.patternHint')}</p>
        {!active&&analyses.length>1&&<div><div className="mb-1 text-xs font-semibold text-stone-600 dark:text-stone-300">{t('imageImport.patternSource')}</div><Select value={String(patternAnalysis.fileIndex)} onChange={(event)=>setPatternSourceIndex(Number(event.target.value))}>{analyses.map((analysis)=><option key={analysis.fileIndex} value={analysis.fileIndex}>{files[analysis.fileIndex]?.name??t('imageImport.patternSourceFallback',{index:analysis.fileIndex+1})}</option>)}</Select></div>}
        {legacyTemplates.length>0&&<div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-500/20 dark:bg-amber-500/5"><div className="text-xs font-bold text-amber-800 dark:text-amber-200">{t('imageImport.legacyUpgrade')}</div><p className="mt-1 text-[11px] leading-5 text-amber-700/80 dark:text-amber-200/70">{t('imageImport.legacyUpgradeHint')}</p><div className="mt-2 flex flex-col gap-2 sm:flex-row"><Select value={legacyTemplateId} onChange={(event)=>setLegacyTemplateId(event.target.value)}><option value="">{t('imageImport.legacySelect')}</option>{legacyTemplates.map((template)=><option key={template.id} value={template.id}>{template.name}</option>)}</Select><Button variant="secondary" disabled={!legacyTemplateId} onClick={()=>void upgradeLegacyTemplate()}>{t('imageImport.legacyUpgradeAction')}</Button></div></div>}
        <OcrTeachingPanel lines={activeLines} mappings={lineMappings} onMap={(line,field)=>setLineMappings((current)=>({...current,[line.id]:field}))}/>
        <div className="flex flex-col gap-2 sm:flex-row"><Input value={patternName} onChange={(event)=>setPatternName(event.target.value)} placeholder={t('imageImport.patternName')}/><Button variant="secondary" onClick={()=>void savePattern()} disabled={!patternName.trim()||Object.values(lineMappings).filter(Boolean).length<2}><BrainCircuit size={17}/>{t('imageImport.savePattern')}</Button></div>
      </div>
    </details>}

    {error&&<div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}

    <div className="flex justify-end gap-2 border-t border-stone-200 pt-4 dark:border-stone-800"><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button onClick={()=>void saveSelected()} disabled={!selectedCount||busy||saving}>{saving?<><LoaderCircle className="animate-spin" size={17}/>{t('modal.saving')}</>:t('imageImport.saveSelected',{count:selectedCount})}</Button></div>
  </div>
}
