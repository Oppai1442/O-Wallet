import { BrainCircuit } from 'lucide-react'
import type { OcrDetectedLine, OcrField } from '../types'
import { useI18n } from '../i18n'
import { Select } from './ui'

export function OcrTeachingPanel({
  lines,
  mappings,
  onMap,
}: {
  lines: OcrDetectedLine[]
  mappings: Record<string, OcrField | ''>
  onMap: (line: OcrDetectedLine, field: OcrField | '') => void
}) {
  const { t } = useI18n()
  const options: Array<{ value: OcrField | ''; label: string }> = [
    { value: '', label: t('ocr.teachUnassigned') },
    { value: 'amount', label: t('ocr.fieldAmount') },
    { value: 'occurredAt', label: t('ocr.fieldTime') },
    { value: 'merchant', label: t('ocr.fieldMerchant') },
    { value: 'balanceAfter', label: t('ocr.fieldBalance') },
    { value: 'description', label: t('ocr.fieldDescription') },
    { value: 'generic', label: t('ocr.fieldGeneric') },
    { value: 'ignore', label: t('ocr.fieldIgnore') },
  ]

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-2">
        <BrainCircuit className="mt-0.5 shrink-0 text-indigo-500" size={18} />
        <div className="min-w-0">
          <div className="font-bold text-slate-800 dark:text-slate-100">{t('ocr.teachTitle')}</div>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">{t('ocr.teachHint')}</p>
        </div>
      </div>
      <div className="max-h-80 space-y-2 overflow-auto pr-1">
        {lines.map((line) => (
          <div key={line.id} className="grid min-w-0 gap-2 rounded-xl border border-slate-200 p-2.5 dark:border-slate-700 sm:grid-cols-[minmax(0,1fr)_190px] sm:items-center">
            <div className="min-w-0">
              <div className="break-words text-sm font-semibold text-slate-800 dark:text-slate-100">{line.text}</div>
              <div className="mt-1 text-[11px] text-slate-400">{t('ocr.confidence', { value: Math.round(line.confidence) })}</div>
            </div>
            <Select value={mappings[line.id] ?? ''} onChange={(e) => onMap(line, e.target.value as OcrField | '')}>
              {options.map((option) => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}
            </Select>
          </div>
        ))}
      </div>
    </div>
  )
}
