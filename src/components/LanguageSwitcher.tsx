import { Languages } from 'lucide-react'
import { useI18n, type Language } from '../i18n'
import { Select } from './ui'

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage, t } = useI18n()
  return (
    <div className={`flex items-center gap-2 ${compact ? '' : 'min-w-[170px]'}`}>
      {!compact && <Languages size={16} className="text-stone-400" />}
      <Select
        aria-label={t('common.language')}
        className={compact ? 'w-[118px] py-2 text-xs' : 'w-full'}
        value={language}
        onChange={(event) => setLanguage(event.target.value as Language)}
      >
        <option value="vi">{t('language.vi')}</option>
        <option value="en">{t('language.en')}</option>
      </Select>
    </div>
  )
}
