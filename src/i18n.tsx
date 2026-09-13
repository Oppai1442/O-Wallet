import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Account, Category } from './types'
import { reportDiagnostic } from './lib/security'
import { LanguageProvider as LegacyLanguageProvider, useI18n as useLegacyI18n } from './i18nLegacy'
import { UI_LANGUAGES, isUiLanguage, languageFromBrowser, languageLocale, type UiLanguage } from './locales'
import { TRANSLATION_PACKS } from './locales/packs'
import { ASIAN_POLISH } from './locales/polish-asian'
import { VI_POLISH, EN_POLISH } from './locales/polish-base'
import { FR_POLISH } from './locales/polish-fr'
import { ES_POLISH } from './locales/polish-es'
import { DE_POLISH } from './locales/polish-de'
import { PT_BR_POLISH } from './locales/polish-pt'
import { RU_POLISH } from './locales/polish-ru'
import { ID_POLISH } from './locales/polish-id'

/** Legacy two-language type retained for existing settings code. */
export type Language = 'vi' | 'en'
export type { UiLanguage } from './locales'
export { UI_LANGUAGES }

type Vars = Record<string, string | number>
type Translator = (key: string, vars?: Vars) => string
const STORAGE_KEY = 'owallet.language'

const POLISH_PACKS: Partial<Record<UiLanguage, Record<string, string>>> = {
  vi: VI_POLISH,
  en: EN_POLISH,
  ...ASIAN_POLISH,
  id: ID_POLISH,
  es: ES_POLISH,
  fr: FR_POLISH,
  de: DE_POLISH,
  'pt-BR': PT_BR_POLISH,
  ru: RU_POLISH,
}

interface I18nContextValue {
  /** Compatibility language for older vi/en-only component copy. */
  language: Language
  /** Actual selected UI language. */
  uiLanguage: UiLanguage
  locale: string
  setLanguage: (language: UiLanguage) => void
  t: Translator
}

const I18nContext = createContext<I18nContextValue | null>(null)

function initialUiLanguage(): UiLanguage {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (isUiLanguage(saved)) return saved
  return languageFromBrowser(navigator.language)
}

function Bridge({ children }: { children: ReactNode }) {
  const legacy = useLegacyI18n()
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(initialUiLanguage)
  const compatibilityLanguage: Language = uiLanguage === 'vi' ? 'vi' : 'en'

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, uiLanguage)
    document.documentElement.lang = languageLocale(uiLanguage)
    legacy.setLanguage(compatibilityLanguage)
  }, [compatibilityLanguage, legacy.setLanguage, uiLanguage])

  const value = useMemo<I18nContextValue>(() => {
    const pack = uiLanguage === 'vi' || uiLanguage === 'en' ? undefined : TRANSLATION_PACKS[uiLanguage]
    const polish = POLISH_PACKS[uiLanguage]
    const t: Translator = (key, vars) => {
      let text = polish?.[key] ?? pack?.[key] ?? legacy.t(key, vars)
      if ((polish?.[key] || pack?.[key]) && vars) {
        for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value))
      }
      return text
    }
    return {
      language: compatibilityLanguage,
      uiLanguage,
      locale: languageLocale(uiLanguage),
      setLanguage: setUiLanguage,
      t,
    }
  }, [compatibilityLanguage, legacy, uiLanguage])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  return <LegacyLanguageProvider><Bridge>{children}</Bridge></LegacyLanguageProvider>
}

export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside LanguageProvider')
  return value
}

export function categoryDisplayName(category: Category, _t: Translator) { return category.name }
export function questionLabel(questionId: string, t: Translator) { return t(`securityQuestion.${questionId}`) }
export function accountDisplayName(account: Account, _t: Translator) { return account.name }
export function localizeError(error: unknown, t: Translator, fallbackKey: string) {
  if (!(error instanceof Error)) return t(fallbackKey)
  if (error.message.startsWith('error.')) return t(error.message)
  reportDiagnostic('localized-error', error)
  return t(fallbackKey)
}
