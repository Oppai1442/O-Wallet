import { Languages } from 'lucide-react'
import { UI_LANGUAGES, useI18n, type Language } from '../i18n'
import { Select } from './ui'

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { uiLanguage, setLanguage, t } = useI18n()
  return (
    <div className={`flex items-center gap-2 ${compact ? '' : 'min-w-[170px]'}`}>
      {!compact && <Languages size={16} className="text-stone-400" />}
      <Select
        aria-label={t('common.language')}
        className={compact ? 'w-[164px] py-2 text-xs' : 'w-full'}
        value={uiLanguage}
        onChange={(event) => setLanguage(event.target.value as Language)}
      >
        {UI_LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
      </Select>
    </div>
  )
}
