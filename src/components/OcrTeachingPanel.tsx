import { BrainCircuit } from 'lucide-react'
import type { OcrDetectedLine, OcrField } from '../types'
import { useI18n } from '../i18n'
import { suggestOcrLine } from '../lib/ocrSemantic'
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
    <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-start gap-2">
        <BrainCircuit className="mt-0.5 shrink-0 text-blue-500" size={18} />
        <div className="min-w-0">
          <div className="font-bold text-stone-800 dark:text-stone-100">{t('ocr.teachTitle')}</div>
          <p className="mt-0.5 text-xs leading-5 text-stone-500">{t('ocr.teachHint')}</p>
        </div>
      </div>
      <div className="max-h-80 space-y-2 overflow-auto pr-1">
        {lines.map((line, index) => {
          const suggestion = suggestOcrLine(lines, index)
          const mapped = mappings[line.id] ?? ''
          const quickFields = (['amount','balanceAfter','occurredAt','merchant','description','ignore'] as OcrField[])
          return <div key={line.id} className="grid min-w-0 gap-2 rounded-xl border border-stone-200 p-2.5 dark:border-stone-700 sm:grid-cols-[minmax(0,1fr)_minmax(220px,300px)] sm:items-center">
            <div className="min-w-0">
              <div className="break-words text-sm font-semibold text-stone-800 dark:text-stone-100">{line.text}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-400">
                <span>{t('ocr.confidence', { value: Math.round(line.confidence) })}</span>
                {suggestion&&<button type="button" onClick={()=>onMap(line,suggestion.field)} className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">{t('ocr.semanticSuggestion',{field:options.find((option)=>option.value===suggestion.field)?.label??suggestion.field,value:Math.round(suggestion.confidence*100)})}</button>}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1">{quickFields.map((field)=><button key={field} type="button" onClick={()=>onMap(line,mapped===field?'':field)} className={`rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${mapped===field?'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300':'border-stone-200 text-stone-500 hover:border-blue-300 dark:border-stone-700'}`}>{options.find((option)=>option.value===field)?.label??field}</button>)}</div>
              <Select value={mapped} onChange={(e) => onMap(line, e.target.value as OcrField | '')}>
                {options.map((option) => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}
              </Select>
            </div>
          </div>
        })}
      </div>
    </div>
  )
}
