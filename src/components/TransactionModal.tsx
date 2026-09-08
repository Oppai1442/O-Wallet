import { useEffect, useMemo, useState } from 'react'
import { ImagePlus, LoaderCircle, ScanText, X } from 'lucide-react'
import { useWallet } from '../WalletContext'
import { accountDisplayName, categoryDisplayName, localizeError, useI18n } from '../i18n'
import { parseTransactionFromOcr, recognizeImage } from '../lib/ocr'
import { fromLocalInputDateTime, toLocalInputDateTime } from '../lib/format'
import type { Transaction, TransactionType } from '../types'
import { Button, Input, Label, Select, Textarea } from './ui'

export function TransactionModal({ onClose }: { onClose: () => void }) {
  const { accounts, categories, repository, saveEntity } = useWallet()
  const { t } = useI18n()
  const [type, setType] = useState<TransactionType>('expense')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('VND')
  const [occurredAt, setOccurredAt] = useState(toLocalInputDateTime())
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [destinationAccountId, setDestinationAccountId] = useState('')
  const [merchant, setMerchant] = useState('')
  const [balanceAfter, setBalanceAfter] = useState('')
  const [description, setDescription] = useState('')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrStatus, setOcrStatus] = useState('')
  const [ocrRaw, setOcrRaw] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  const eligibleCategories = useMemo(() => categories.filter((category) => category.kind === type || category.kind === 'both' || type === 'transfer'), [categories, type])

  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id)
    if (!destinationAccountId && accounts[1]) setDestinationAccountId(accounts[1].id)
  }, [accounts, accountId, destinationAccountId])

  useEffect(() => {
    if (!categoryId || !eligibleCategories.some((category) => category.id === categoryId)) setCategoryId(eligibleCategories[0]?.id ?? '')
  }, [eligibleCategories, categoryId])

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file))
    setPreviewUrls(urls)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [files])

  async function runOcr() {
    if (!files[0]) return
    setOcrBusy(true)
    setError(undefined)
    setOcrProgress(0)
    try {
      const result = await recognizeImage(files[0], (progress, status) => {
        setOcrProgress(progress)
        setOcrStatus(status)
      })
      setOcrRaw(result.text)
      const parsed = parseTransactionFromOcr(result)
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
      const imageIds: string[] = []
      for (const file of files) imageIds.push((await repository.saveImage(file)).id)
      const now = new Date().toISOString()
      const transaction: Transaction = {
        id: crypto.randomUUID(),
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
        imageIds,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      }
      await saveEntity(transaction)
      onClose()
    } catch (e) {
      setError(localizeError(e, t, 'modal.errorSave'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[96vh] w-full max-w-3xl overflow-auto rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <div><h2 className="text-lg font-black text-slate-950 dark:text-white">{t('modal.title')}</h2><p className="text-xs text-slate-500">{t('modal.imageRetentionHint')}</p></div>
          <Button variant="ghost" onClick={onClose}><X size={18} /></Button>
        </div>

        <div className="space-y-5 p-5">
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
          <div><Label>{t('modal.description')}</Label><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div><Label>{t('modal.note')}</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>

          <div className="rounded-2xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><div className="font-bold text-slate-800 dark:text-slate-100">{t('modal.screenshot')}</div><div className="text-xs text-slate-500">{t('modal.ocrHint')}</div></div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700">
                <ImagePlus size={17} /> {t('modal.chooseImages')}
                <input hidden type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
              </label>
            </div>
            {previewUrls.length > 0 && (
              <>
                <div className="mt-4 flex gap-2 overflow-x-auto pb-2">{previewUrls.map((url, index) => <img key={url} src={url} alt={`preview ${index + 1}`} className="h-32 w-24 shrink-0 rounded-xl border border-slate-200 object-cover dark:border-slate-700" />)}</div>
                <Button variant="secondary" onClick={runOcr} disabled={ocrBusy} className="mt-2"><ScanText size={17} /> {ocrBusy ? `OCR ${Math.round(ocrProgress * 100)}%` : t('modal.ocrFirst')}</Button>
                {ocrBusy && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${ocrProgress * 100}%` }} /></div>}
                {ocrStatus && ocrBusy && <div className="mt-1 text-xs text-slate-500">{ocrStatus}</div>}
              </>
            )}
          </div>

          {ocrRaw && <details className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950"><summary className="cursor-pointer text-sm font-bold text-slate-700 dark:text-slate-200">{t('modal.rawOcr')}</summary><pre className="mt-3 whitespace-pre-wrap break-words text-xs text-slate-500">{ocrRaw}</pre></details>}
          {error && <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
            <Button onClick={save} disabled={saving || ocrBusy}>{saving ? <><LoaderCircle className="animate-spin" size={17} /> {t('modal.saving')}</> : t('modal.save')}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
