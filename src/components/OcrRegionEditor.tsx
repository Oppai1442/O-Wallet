import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Crop, Trash2 } from 'lucide-react'
import type { OcrField, OcrRegion } from '../types'
import { useI18n } from '../i18n'
import { Button, Select } from './ui'

const FIELD_TONES: Record<OcrField, string> = {
  generic: 'border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  amount: 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  occurredAt: 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  merchant: 'border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  balanceAfter: 'border-cyan-500 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
  description: 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  ignore: 'border-slate-500 bg-slate-500/15 text-slate-700 dark:text-slate-300',
}

export function OcrRegionEditor({
  imageUrl,
  regions,
  onChange,
  onDimensions,
}: {
  imageUrl: string
  regions: OcrRegion[]
  onChange: (regions: OcrRegion[]) => void
  onDimensions?: (size: { width: number; height: number }) => void
}) {
  const { t } = useI18n()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [field, setField] = useState<OcrField>('amount')
  const [draft, setDraft] = useState<OcrRegion>()
  const startRef = useRef<{ x: number; y: number } | undefined>(undefined)

  const fields = useMemo<Array<{ value: OcrField; label: string }>>(() => [
    { value: 'amount', label: t('ocr.fieldAmount') },
    { value: 'occurredAt', label: t('ocr.fieldTime') },
    { value: 'merchant', label: t('ocr.fieldMerchant') },
    { value: 'balanceAfter', label: t('ocr.fieldBalance') },
    { value: 'description', label: t('ocr.fieldDescription') },
    { value: 'generic', label: t('ocr.fieldGeneric') },
    { value: 'ignore', label: t('ocr.fieldIgnore') },
  ], [t])

  function normalizedPoint(event: ReactPointerEvent) {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
  }

  function begin(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = normalizedPoint(event)
    startRef.current = point
    setDraft({ id: 'draft', field, x: point.x, y: point.y, width: 0, height: 0 })
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (!startRef.current) return
    const point = normalizedPoint(event)
    const start = startRef.current
    setDraft({
      id: 'draft',
      field,
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    })
  }

  function finish(event: ReactPointerEvent<HTMLDivElement>) {
    const start = startRef.current
    if (!start) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const point = normalizedPoint(event)
    const completed: OcrRegion = {
      id: crypto.randomUUID(),
      field,
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    }
    startRef.current = undefined
    if (completed.width > 0.025 && completed.height > 0.02) onChange([...regions, completed])
    setDraft(undefined)
  }

  const all = draft ? [...regions, draft] : regions

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100"><Crop size={17} /> {t('ocr.regions')}</div>
        <Select className="ml-auto min-w-44" value={field} onChange={(e) => setField(e.target.value as OcrField)}>
          {fields.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </Select>
      </div>
      <p className="text-xs leading-5 text-slate-500">{t('ocr.regionHint')}</p>

      <div
        ref={surfaceRef}
        className="relative mx-auto w-full max-w-2xl touch-none select-none overflow-hidden rounded-2xl border border-slate-200 bg-slate-950/5 dark:border-slate-700"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={() => { startRef.current = undefined; setDraft(undefined) }}
      >
        <img
          src={imageUrl}
          alt={t('ocr.regionImageAlt')}
          draggable={false}
          className="block h-auto w-full pointer-events-none"
          onLoad={(event) => onDimensions?.({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        />
        {all.map((region, index) => (
          <div
            key={region.id}
            className={`pointer-events-none absolute border-2 ${FIELD_TONES[region.field]}`}
            style={{
              left: `${region.x * 100}%`,
              top: `${region.y * 100}%`,
              width: `${region.width * 100}%`,
              height: `${region.height * 100}%`,
            }}
          >
            <span className="absolute left-0 top-0 max-w-full -translate-y-full truncate rounded-t-md bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {index + 1}. {fields.find((item) => item.value === region.field)?.label}
            </span>
          </div>
        ))}
      </div>

      {regions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {regions.map((region, index) => (
            <div key={region.id} className={`inline-flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-semibold ${FIELD_TONES[region.field]}`}>
              <span>{index + 1}. {fields.find((item) => item.value === region.field)?.label}</span>
              <button type="button" aria-label={t('ocr.removeRegion')} onClick={() => onChange(regions.filter((item) => item.id !== region.id))}><Trash2 size={13} /></button>
            </div>
          ))}
          <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => onChange([])}>{t('ocr.clearRegions')}</Button>
        </div>
      )}
    </div>
  )
}
