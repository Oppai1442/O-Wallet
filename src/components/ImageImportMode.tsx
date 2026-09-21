import { useEffect, useMemo, useState } from 'react'
import { BrainCircuit, ImagePlus, Images, LoaderCircle, ScanText } from 'lucide-react'
import type { OcrDetectedLine, OcrField, OcrResult, OcrTemplate, OcrTransactionBlock, OcrVisualFingerprint, ParsedTransactionCandidate, Transaction, TransactionType } from '../types'
import { useWallet } from '../WalletContext'
import { localizeError, useI18n } from '../i18n'
import { accountCurrencies } from '../lib/accounts'
import { findDuplicateTransaction } from '../lib/duplicates'
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

export function ImageImportMode({ onClose }: { onClose: () => void }) {
  const { accounts, categories, repository, saveEntity, saveEntities, settings, transactions } = useWallet()
  const { t } = useI18n()
  const [files, setFiles] = useState<File[]>([])
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

  useEffect(() => setSessionTemplates(settings?.ocrTemplates ?? []), [settings?.ocrTemplates])

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
      setFiles(selected)
      setAnalyses([])
      setDrafts([])
      setActiveId(undefined)
      setReviewedIds(new Set())
      setProgress(0)
      setStatus('')
    } catch (validationError) {
      setFiles([])
      setError(localizeError(validationError, t, 'error.imageInvalid'))
    }
  }

  function resolveDraft(
    fileIndex: number,
    block: OcrTransactionBlock,
    sourceWidth: number,
    sourceHeight: number,
    priorTransactions: Transaction[],
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
    const conflict = parsed.amount
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
    const best = ranked[0]?.score >= 0.34 ? ranked[0].template : undefined
    return {
      template: best,
      score: ranked[0]?.score ?? 0,
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
      for (const block of matched.blocks) {
        const nextDraft = resolveDraft(analysis.fileIndex, block, analysis.width, analysis.height, candidates)
        const old = drafts.find((draft) => draft.id === nextDraft.id)
        const chosen = preserveReviewed && old && preserveIds.has(old.id) ? old : nextDraft
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
    setBusy(true)
    setError(undefined)
    setProgress(0)
    setStatus('')
    setReviewedIds(new Set())
    try {
      const nextAnalyses: SourceAnalysis[] = []
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        const ocr = await recognizeImageTiled(file, (value, text) => {
          setProgress((index + value * 0.98) / files.length)
          setStatus(`${index + 1}/${files.length} · ${text}`)
        })
        nextAnalyses.push({
          fileIndex: index,
          result: ocr.result,
          width: ocr.width,
          height: ocr.height,
          visual: ocr.visual,
        })
      }
      const nextDrafts = buildDraftsFromAnalyses(nextAnalyses, sessionTemplates, false)
      if (!nextDrafts.length) setError(t('imageImport.noDrafts'))
      setProgress(1)
    } catch (analysisError) {
      setError(localizeError(analysisError, t, 'modal.errorOcr'))
    } finally {
      setBusy(false)
    }
  }

  function updateDraft(next: BatchOcrDraft) {
    const compatibleCategories = selectableCategories(categories, next.type)
    const account = accounts.find((item) => item.id === next.accountId)
    const allowedCurrencies = account ? accountCurrencies(account) : []
    const normalizedDraft = {
      ...next,
      categoryId: compatibleCategories.some((category) => category.id === next.categoryId) ? next.categoryId : compatibleCategories[0]?.id ?? next.categoryId,
      currency: allowedCurrencies.includes(next.currency) ? next.currency : allowedCurrencies[0] ?? next.currency,
    }
    setDrafts((current) => current.map((draft) => draft.id === normalizedDraft.id ? normalizedDraft : draft))
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
    if (Object.values(mappings).filter(Boolean).length < 2) return
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
          batch: batchId ? { id: batchId, mode: 'ocr-batch', index, count: selected.length } : undefined,
          imageIds: imageIds.has(draft.fileIndex) ? [imageIds.get(draft.fileIndex)!] : [],
          createdAt: now,
          updatedAt: now,
          deleted: false,
        }
      })
      await saveEntities(records)
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
      </div>
      {previewUrls.length>0&&<div className="mt-3 flex gap-2 overflow-x-auto pb-1">{previewUrls.map((url,index)=><img key={url} src={url} alt="" className="h-24 w-20 shrink-0 rounded-xl border border-stone-200 object-cover dark:border-stone-700"/>)}</div>}
      {busy&&<><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"><div className="h-full bg-blue-500 transition-all" style={{width:`${Math.round(progress*100)}%`}}/></div><div className="mt-1 text-xs text-stone-500">{status}</div></>}
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
