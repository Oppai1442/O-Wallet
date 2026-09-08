import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { CopyPlus, ImagePlus, LoaderCircle, ScanText, Sparkles, X } from 'lucide-react'
import { useWallet } from '../WalletContext'
import { accountDisplayName, categoryDisplayName, localizeError, useI18n } from '../i18n'
import { parseTransactionFromOcr, parseTransactionFromRegions, recognizeImage } from '../lib/ocr'
import { fromLocalInputDateTime, toLocalInputDateTime } from '../lib/format'
import type { OcrRegion, OcrTemplate, Transaction, TransactionType } from '../types'
import { Button, Input, Label, Select, Textarea } from './ui'

const OcrRegionEditor = lazy(() => import('./OcrRegionEditor').then((module) => ({ default: module.OcrRegionEditor })))

function uniqueTags(raw: string) {
  return [...new Set(raw.split(/[,;#\n]/).map((item) => item.trim()).filter(Boolean))].slice(0, 20)
}

export function TransactionModal({
  onClose,
  transaction,
  duplicateFrom,
}: {
  onClose: () => void
  transaction?: Transaction
  duplicateFrom?: Transaction
}) {
  const { accounts, categories, repository, saveEntity, settings } = useWallet()
  const { t } = useI18n()
  const seed = transaction ?? duplicateFrom
  const editing = Boolean(transaction)
  const [type, setType] = useState<TransactionType>(seed?.type ?? 'expense')
  const [amount, setAmount] = useState(seed?.amount ? String(seed.amount) : '')
  const [currency, setCurrency] = useState(seed?.currency ?? settings?.defaultCurrency ?? 'VND')
  const [occurredAt, setOccurredAt] = useState(seed ? toLocalInputDateTime(seed.occurredAt) : toLocalInputDateTime())
  const [categoryId, setCategoryId] = useState(seed?.categoryId ?? settings?.transactionDefaults?.categoryId ?? '')
  const [accountId, setAccountId] = useState(seed?.accountId ?? settings?.transactionDefaults?.accountId ?? '')
  const [destinationAccountId, setDestinationAccountId] = useState(seed?.destinationAccountId ?? '')
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
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrStatus, setOcrStatus] = useState('')
  const [ocrRaw, setOcrRaw] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  const eligibleCategories = useMemo(
    () => categories.filter((category) => category.kind === type || category.kind === 'both' || type === 'transfer'),
    [categories, type],
  )
  const templates = settings?.ocrTemplates ?? []

  useEffect(() => {
    if (!accounts.some((account) => account.id === accountId)) setAccountId(accounts[0]?.id ?? '')
    if (!accounts.some((account) => account.id === destinationAccountId)) setDestinationAccountId(accounts.find((account) => account.id !== accountId)?.id ?? '')
  }, [accounts, accountId, destinationAccountId])

  useEffect(() => {
    if (!categoryId || !eligibleCategories.some((category) => category.id === categoryId)) setCategoryId(eligibleCategories[0]?.id ?? '')
  }, [eligibleCategories, categoryId])

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file))
    setPreviewUrls(urls)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [files])

  function applyTemplate(id: string) {
    setTemplateId(id)
    const template = templates.find((item) => item.id === id)
    if (template) {
      setRegions(template.regions.map((region) => ({ ...region, id: crypto.randomUUID() })))
      setShowRegions(true)
    }
  }

  async function saveTemplate() {
    if (!settings || !regions.length || !templateName.trim()) return
    const now = new Date().toISOString()
    const template: OcrTemplate = {
      id: crypto.randomUUID(),
      name: templateName.trim(),
      aspectRatio: imageSize ? imageSize.width / imageSize.height : undefined,
      regions: regions.map((region) => ({ ...region, id: crypto.randomUUID() })),
      createdAt: now,
      updatedAt: now,
    }
    await saveEntity({
      ...settings,
      ocrTemplates: [...templates, template],
      updatedAt: now,
    })
    setTemplateId(template.id)
    setTemplateName('')
  }

  async function ensureImageSize(file: File) {
    if (imageSize) return imageSize
    if ('createImageBitmap' in window) {
      const bitmap = await createImageBitmap(file)
      const value = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      setImageSize(value)
      return value
    }
    const url = URL.createObjectURL(file)
    try {
      const value = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new window.Image()
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
        image.onerror = () => reject(new Error('modal.errorOcr'))
        image.src = url
      })
      setImageSize(value)
      return value
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  async function runOcr() {
    if (!files[0]) return
    setOcrBusy(true)
    setError(undefined)
    setOcrProgress(0)
    try {
      const [result, size] = await Promise.all([
        recognizeImage(files[0], (progress, status) => {
          setOcrProgress(progress)
          setOcrStatus(status)
        }),
        ensureImageSize(files[0]),
      ])
      const parsed = regions.length
        ? parseTransactionFromRegions(result, regions, size.width, size.height)
        : parseTransactionFromOcr(result)
      setOcrRaw(parsed.rawText)
      if (parsed.amount) setAmount(String(parsed.amount))
      if (parsed.occurredAt) setOccurredAt(toLocalInputDateTime(parsed.occurredAt))
      if (parsed.merchant) setMerchant(parsed.merchant)
      if (parsed.balanceAfter) setBalanceAfter(String(parsed.balanceAfter))
      if (parsed.description) setDescription(parsed.description)
      setType(parsed.type)
    } catch (e) {
      setError(localizeError(e, t, 'modal.errorOcr'))
    } finally {
      setOcrBusy(false)
    }
  }

  async function save() {
    const numericAmount = Number(amount)
    if (!repository || !numericAmount || numericAmount <= 0 || !accountId || !categoryId) {
      setError(t('modal.errorMissingFields'))
      return
    }
    if (type === 'transfer' && (!destinationAccountId || destinationAccountId === accountId)) {
      setError(t('modal.errorTransferAccounts'))
      return
    }

    setSaving(true)
    setError(undefined)
    try {
      const imageIds = editing ? [...(transaction?.imageIds ?? [])] : []
      if (!editing && duplicateFrom) imageIds.push(...duplicateFrom.imageIds)
      for (const file of files) imageIds.push((await repository.saveImage(file)).id)
      const now = new Date().toISOString()
      const next: Transaction = {
        id: transaction?.id ?? crypto.randomUUID(),
        type,
        amount: numericAmount,
        currency,
        occurredAt: fromLocalInputDateTime(occurredAt),
        categoryId,
        accountId,
        destinationAccountId: type === 'transfer' ? destinationAccountId : undefined,
        merchant: merchant.trim() || undefined,
        balanceAfter: balanceAfter ? Number(balanceAfter) : undefined,
        description: description.trim() || undefined,
        note: note.trim() || undefined,
        tags: uniqueTags(tags),
        imageIds,
        createdAt: transaction?.createdAt ?? now,
        updatedAt: now,
        deleted: false,
      }
      await saveEntity(next)
      onClose()
    } catch (e) {
      setError(localizeError(e, t, 'modal.errorSave'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[100dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900 sm:max-h-[94dvh] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 sm:px-5 sm:py-4">
          <div>
            <h2 className="text-lg font-black text-slate-950 dark:text-white">{editing ? t('modal.editTitle') : duplicateFrom ? t('modal.duplicateTitle') : t('modal.title')}</h2>
            <p className="text-xs text-slate-500">{t('modal.imageRetentionHint')}</p>
          </div>
          <Button variant="ghost" onClick={onClose}><X size={18} /></Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)]">
            <div className="space-y-4 p-4 sm:p-5 lg:border-r lg:border-slate-200 lg:dark:border-slate-800">
              <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
                {(['expense', 'income', 'transfer'] as TransactionType[]).map((value) => (
                  <button key={value} onClick={() => setType(value)} className={`rounded-xl px-3 py-2 text-sm font-bold transition ${type === value ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                    {t(`transaction.${value}`)}
                  </button>
                ))}
              </div>

              <div className="grid gap-4 sm:grid-cols-[1.5fr_.7fr]">
                <div><Label>{t('modal.amount')}</Label><Input type="number" inputMode="decimal" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150000" /></div>
                <div><Label>{t('modal.currency')}</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div><Label>{t('modal.time')}</Label><Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} /></div>
                <div><Label>{t('modal.category')}</Label><Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{eligibleCategories.map((category) => <option key={category.id} value={category.id}>{categoryDisplayName(category, t)}</option>)}</Select></div>
                <div><Label>{type === 'transfer' ? t('modal.sourceAccount') : t('modal.account')}</Label><Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{accountDisplayName(account, t)}</option>)}</Select></div>
                {type === 'transfer' && <div><Label>{t('modal.destinationAccount')}</Label><Select value={destinationAccountId} onChange={(e) => setDestinationAccountId(e.target.value)}>{accounts.filter((account) => account.id !== accountId).map((account) => <option key={account.id} value={account.id}>{accountDisplayName(account, t)}</option>)}</Select></div>}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div><Label>{t('modal.merchant')}</Label><Input value={merchant} onChange={(e) => setMerchant(e.target.value)} /></div>
                <div><Label>{t('modal.balanceAfter')}</Label><Input type="number" value={balanceAfter} onChange={(e) => setBalanceAfter(e.target.value)} /></div>
              </div>
              <div><Label>{t('modal.tags')}</Label><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('modal.tagsPlaceholder')} /><p className="mt-1 text-xs text-slate-500">{t('modal.tagsHint')}</p></div>
              <div><Label>{t('modal.description')}</Label><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              <div><Label>{t('modal.note')}</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            </div>

            <div className="space-y-4 bg-slate-50/60 p-4 dark:bg-slate-950/30 sm:p-5">
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><div className="font-bold text-slate-800 dark:text-slate-100">{t('modal.screenshot')}</div><div className="text-xs text-slate-500">{t('modal.ocrHint')}</div></div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700">
                    <ImagePlus size={17} /> {t('modal.chooseImages')}
                    <input hidden type="file" accept="image/*" multiple onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setRegions([]); setImageSize(undefined) }} />
                  </label>
                </div>
                {previewUrls.length > 0 && (
                  <>
                    <div className="mt-4 flex gap-2 overflow-x-auto pb-2">{previewUrls.map((url, index) => <img key={url} src={url} alt={`preview ${index + 1}`} className="h-28 w-24 shrink-0 rounded-xl border border-slate-200 object-cover dark:border-slate-700" />)}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => setShowRegions((value) => !value)}><Sparkles size={17} /> {showRegions ? t('ocr.hideRegions') : t('ocr.configureRegions')}</Button>
                      <Button onClick={runOcr} disabled={ocrBusy}><ScanText size={17} /> {ocrBusy ? `OCR ${Math.round(ocrProgress * 100)}%` : regions.length ? t('ocr.runRegions') : t('modal.ocrFirst')}</Button>
                    </div>
                    {ocrBusy && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${ocrProgress * 100}%` }} /></div>}
                    {ocrStatus && ocrBusy && <div className="mt-1 text-xs text-slate-500">{ocrStatus}</div>}
                  </>
                )}
              </div>

              {previewUrls[0] && showRegions && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <Select value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
                      <option value="">{t('ocr.noTemplate')}</option>
                      {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                    </Select>
                    <div className="flex gap-2"><Input className="min-w-0" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder={t('ocr.templateName')} /><Button variant="secondary" onClick={() => void saveTemplate()} disabled={!regions.length || !templateName.trim()}>{t('ocr.saveTemplate')}</Button></div>
                  </div>
                  <Suspense fallback={<div className="py-8 text-center text-sm text-slate-500">{t('common.loading')}</div>}>
                    <OcrRegionEditor imageUrl={previewUrls[0]} regions={regions} onChange={setRegions} onDimensions={setImageSize} />
                  </Suspense>
                </div>
              )}

              {ocrRaw && <details className="rounded-2xl bg-white p-4 dark:bg-slate-900"><summary className="cursor-pointer text-sm font-bold text-slate-700 dark:text-slate-200">{t('modal.rawOcr')}</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-500">{ocrRaw}</pre></details>}
              {error && <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 sm:px-5">
          {duplicateFrom && <span className="mr-auto hidden items-center gap-1 text-xs text-slate-500 sm:flex"><CopyPlus size={14} /> {t('modal.duplicating')}</span>}
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={save} disabled={saving || ocrBusy}>{saving ? <><LoaderCircle className="animate-spin" size={17} /> {t('modal.saving')}</> : editing ? t('common.save') : t('modal.save')}</Button>
        </div>
      </div>
    </div>
  )
}
