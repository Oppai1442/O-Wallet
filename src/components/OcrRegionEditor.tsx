import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Crop, Move, Trash2 } from 'lucide-react'
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

type ResizeEdge = 'nw' | 'ne' | 'sw' | 'se'
type Interaction =
  | { kind: 'draw'; start: { x: number; y: number }; field: OcrField }
  | { kind: 'move'; start: { x: number; y: number }; regionId: string; original: OcrRegion }
  | { kind: 'resize'; start: { x: number; y: number }; regionId: string; edge: ResizeEdge; original: OcrRegion }

const MIN_SIZE = 0.015

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
  const interactionRef = useRef<Interaction | undefined>(undefined)
  const [field, setField] = useState<OcrField>('amount')
  const [selectedId, setSelectedId] = useState<string>()
  const [draft, setDraft] = useState<OcrRegion>()
  const [editDraft, setEditDraft] = useState<OcrRegion>()

  const fields = useMemo<Array<{ value: OcrField; label: string }>>(() => [
    { value: 'amount', label: t('ocr.fieldAmount') },
    { value: 'occurredAt', label: t('ocr.fieldTime') },
    { value: 'merchant', label: t('ocr.fieldMerchant') },
    { value: 'balanceAfter', label: t('ocr.fieldBalance') },
    { value: 'description', label: t('ocr.fieldDescription') },
    { value: 'generic', label: t('ocr.fieldGeneric') },
    { value: 'ignore', label: t('ocr.fieldIgnore') },
  ], [t])

  const selected = editDraft?.id === selectedId ? editDraft : regions.find((region) => region.id === selectedId)

  function normalizedPoint(event: ReactPointerEvent) {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
  }

  function capture(pointerId: number) {
    const surface = surfaceRef.current
    if (surface && !surface.hasPointerCapture(pointerId)) surface.setPointerCapture(pointerId)
  }

  function beginDraw(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const point = normalizedPoint(event)
    capture(event.pointerId)
    interactionRef.current = { kind: 'draw', start: point, field }
    setSelectedId(undefined)
    setDraft({ id: 'draft', field, x: point.x, y: point.y, width: 0, height: 0, stripLabel: field !== 'generic' && field !== 'ignore' })
  }

  function beginMove(event: ReactPointerEvent, region: OcrRegion) {
    event.preventDefault()
    event.stopPropagation()
    const point = normalizedPoint(event)
    capture(event.pointerId)
    interactionRef.current = { kind: 'move', start: point, regionId: region.id, original: { ...region } }
    setEditDraft({ ...region })
    setSelectedId(region.id)
  }

  function beginResize(event: ReactPointerEvent, region: OcrRegion, edge: ResizeEdge) {
    event.preventDefault()
    event.stopPropagation()
    const point = normalizedPoint(event)
    capture(event.pointerId)
    interactionRef.current = { kind: 'resize', start: point, regionId: region.id, edge, original: { ...region } }
    setEditDraft({ ...region })
    setSelectedId(region.id)
  }

  function updateRegion(id: string, patch: Partial<OcrRegion>) {
    onChange(regions.map((region) => region.id === id ? { ...region, ...patch } : region))
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const interaction = interactionRef.current
    if (!interaction) return
    event.preventDefault()
    const point = normalizedPoint(event)

    if (interaction.kind === 'draw') {
      const { start } = interaction
      setDraft({
        id: 'draft',
        field: interaction.field,
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        width: Math.abs(point.x - start.x),
        height: Math.abs(point.y - start.y),
        stripLabel: interaction.field !== 'generic' && interaction.field !== 'ignore',
      })
      return
    }

    if (interaction.kind === 'move') {
      const dx = point.x - interaction.start.x
      const dy = point.y - interaction.start.y
      const original = interaction.original
      setEditDraft({
        ...original,
        x: Math.min(1 - original.width, Math.max(0, original.x + dx)),
        y: Math.min(1 - original.height, Math.max(0, original.y + dy)),
      })
      return
    }

    const { original, edge } = interaction
    let x0 = original.x
    let y0 = original.y
    let x1 = original.x + original.width
    let y1 = original.y + original.height
    if (edge.includes('w')) x0 = Math.min(x1 - MIN_SIZE, Math.max(0, point.x))
    if (edge.includes('e')) x1 = Math.max(x0 + MIN_SIZE, Math.min(1, point.x))
    if (edge.includes('n')) y0 = Math.min(y1 - MIN_SIZE, Math.max(0, point.y))
    if (edge.includes('s')) y1 = Math.max(y0 + MIN_SIZE, Math.min(1, point.y))
    setEditDraft({ ...original, x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
  }

  function finish(event: ReactPointerEvent<HTMLDivElement>) {
    const interaction = interactionRef.current
    if (!interaction) return
    event.preventDefault()
    const surface = surfaceRef.current
    if (surface?.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId)

    if (interaction.kind === 'draw' && draft && draft.width > 0.025 && draft.height > 0.02) {
      const completed = { ...draft, id: crypto.randomUUID() }
      onChange([...regions, completed])
      setSelectedId(completed.id)
    } else if (interaction.kind !== 'draw' && editDraft) {
      onChange(regions.map((region) => region.id === editDraft.id ? editDraft : region))
    }
    interactionRef.current = undefined
    setDraft(undefined)
    setEditDraft(undefined)
  }

  function removeRegion(id: string) {
    onChange(regions.filter((item) => item.id !== id))
    if (selectedId === id) setSelectedId(undefined)
  }

  const renderedRegions = editDraft ? regions.map((region) => region.id === editDraft.id ? editDraft : region) : regions
  const all = draft ? [...renderedRegions, draft] : renderedRegions
  const fieldLabel = (regionField: OcrField) => fields.find((item) => item.value === regionField)?.label ?? regionField

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100"><Crop size={17} /> {t('ocr.regions')}</div>
        <Select className="ml-auto min-w-44" value={field} onChange={(e) => setField(e.target.value as OcrField)}>
          {fields.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </Select>
      </div>
      <p className="text-xs leading-5 text-slate-500">{t('ocr.regionHintEditable')}</p>

      <div
        ref={surfaceRef}
        className="relative mx-auto w-full max-w-2xl touch-none select-none overflow-hidden rounded-2xl border border-slate-200 bg-slate-950/5 dark:border-slate-700"
        style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
        onPointerDown={beginDraw}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={(event) => {
          const surface = surfaceRef.current
          if (surface?.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId)
          interactionRef.current = undefined
          setDraft(undefined)
          setEditDraft(undefined)
        }}
        onDragStart={(event) => event.preventDefault()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <img
          src={imageUrl}
          alt={t('ocr.regionImageAlt')}
          draggable={false}
          className="pointer-events-none block h-auto w-full select-none"
          style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
          onLoad={(event) => onDimensions?.({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        />
        {all.map((region, index) => {
          const isDraft = region.id === 'draft'
          const isSelected = region.id === selectedId
          return (
            <div
              key={region.id}
              className={`absolute border-2 ${FIELD_TONES[region.field]} ${isDraft ? 'pointer-events-none' : 'cursor-move'} ${isSelected ? 'ring-2 ring-white/90 ring-offset-1 ring-offset-indigo-500/40' : ''}`}
              style={{
                left: `${region.x * 100}%`,
                top: `${region.y * 100}%`,
                width: `${region.width * 100}%`,
                height: `${region.height * 100}%`,
              }}
              onPointerDown={isDraft ? undefined : (event) => beginMove(event, region)}
            >
              <span className="pointer-events-none absolute left-0 top-0 max-w-full -translate-y-full truncate rounded-t-md bg-slate-950/85 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {index + 1}. {fieldLabel(region.field)}
              </span>
              {isSelected && !isDraft && (['nw', 'ne', 'sw', 'se'] as ResizeEdge[]).map((edge) => (
                <button
                  type="button"
                  key={edge}
                  aria-label={t('ocr.resizeRegion')}
                  className={`absolute h-3.5 w-3.5 rounded-full border-2 border-white bg-indigo-600 shadow ${edge === 'nw' ? '-left-2 -top-2 cursor-nwse-resize' : edge === 'ne' ? '-right-2 -top-2 cursor-nesw-resize' : edge === 'sw' ? '-bottom-2 -left-2 cursor-nesw-resize' : '-bottom-2 -right-2 cursor-nwse-resize'}`}
                  onPointerDown={(event) => beginResize(event, region, edge)}
                />
              ))}
            </div>
          )
        })}
      </div>

      {selected && (
        <div className="grid gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 dark:border-indigo-500/30 dark:bg-indigo-500/10 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="grid min-w-0 gap-2 sm:grid-cols-[170px_minmax(0,1fr)] sm:items-center">
            <Select value={selected.field} onChange={(e) => updateRegion(selected.id, { field: e.target.value as OcrField, stripLabel: e.target.value !== 'generic' && e.target.value !== 'ignore' ? selected.stripLabel ?? true : false })}>
              {fields.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </Select>
            <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={selected.stripLabel ?? (selected.field !== 'generic' && selected.field !== 'ignore')} disabled={selected.field === 'generic' || selected.field === 'ignore'} onChange={(e) => updateRegion(selected.id, { stripLabel: e.target.checked })} />
              <span className="truncate">{t('ocr.stripInlineLabel')}</span>
            </label>
          </div>
          <div className="flex gap-2">
            <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Move size={14} /> {t('ocr.dragToMove')}</span>
            <Button variant="ghost" className="h-8 px-2 text-xs text-rose-600" onClick={() => removeRegion(selected.id)}><Trash2 size={13} /> {t('common.delete')}</Button>
          </div>
        </div>
      )}

      {regions.length > 0 && (
        <div className="space-y-2">
          {regions.map((region, index) => (
            <div key={region.id} className={`grid gap-2 rounded-xl border px-2.5 py-2 text-xs font-semibold sm:grid-cols-[auto_minmax(150px,220px)_1fr_auto] sm:items-center ${selectedId === region.id ? 'border-indigo-400 bg-indigo-50/60 dark:bg-indigo-500/10' : 'border-slate-200 dark:border-slate-700'}`}>
              <button type="button" className="text-left" onClick={() => setSelectedId(region.id)}>#{index + 1}</button>
              <Select value={region.field} onChange={(e) => updateRegion(region.id, { field: e.target.value as OcrField })} onClick={(e) => e.stopPropagation()}>
                {fields.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </Select>
              <button type="button" className="min-w-0 truncate text-left font-normal text-slate-500" onClick={() => setSelectedId(region.id)}>{region.sourceLineId ? t('ocr.fromDetectedLine') : t('ocr.manualRegion')}</button>
              <button type="button" aria-label={t('ocr.removeRegion')} className="justify-self-end text-rose-500" onClick={() => removeRegion(region.id)}><Trash2 size={14} /></button>
            </div>
          ))}
          <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => { onChange([]); setSelectedId(undefined) }}>{t('ocr.clearRegions')}</Button>
        </div>
      )}
    </div>
  )
}
