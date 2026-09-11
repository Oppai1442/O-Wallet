export type UiLanguage = 'vi' | 'en' | 'ja' | 'zh-CN' | 'zh-TW' | 'th' | 'id' | 'es' | 'fr' | 'de' | 'pt-BR' | 'ru'

export interface UiLanguageInfo {
  code: UiLanguage
  locale: string
  label: string
}

export const UI_LANGUAGES: UiLanguageInfo[] = [
  { code: 'vi', locale: 'vi-VN', label: 'Tiếng Việt' },
  { code: 'en', locale: 'en-US', label: 'English' },
  { code: 'ja', locale: 'ja-JP', label: '日本語' },
  { code: 'zh-CN', locale: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', locale: 'zh-TW', label: '繁體中文' },
  { code: 'th', locale: 'th-TH', label: 'ไทย' },
  { code: 'id', locale: 'id-ID', label: 'Bahasa Indonesia' },
  { code: 'es', locale: 'es-ES', label: 'Español' },
  { code: 'fr', locale: 'fr-FR', label: 'Français' },
  { code: 'de', locale: 'de-DE', label: 'Deutsch' },
  { code: 'pt-BR', locale: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'ru', locale: 'ru-RU', label: 'Русский' },
]

export const UI_LANGUAGE_CODES = new Set<UiLanguage>(UI_LANGUAGES.map((item) => item.code))

export function isUiLanguage(value: string | null | undefined): value is UiLanguage {
  return Boolean(value && UI_LANGUAGE_CODES.has(value as UiLanguage))
}

export function languageLocale(language: UiLanguage) {
  return UI_LANGUAGES.find((item) => item.code === language)?.locale ?? 'en-US'
}

export function languageFromBrowser(value: string): UiLanguage {
  const normalized = value.trim().toLowerCase()
  if (normalized.startsWith('vi')) return 'vi'
  if (normalized.startsWith('ja')) return 'ja'
  if (normalized.startsWith('zh-tw') || normalized.startsWith('zh-hant') || normalized.startsWith('zh-hk') || normalized.startsWith('zh-mo')) return 'zh-TW'
  if (normalized.startsWith('zh')) return 'zh-CN'
  if (normalized.startsWith('th')) return 'th'
  if (normalized.startsWith('id')) return 'id'
  if (normalized.startsWith('es')) return 'es'
  if (normalized.startsWith('fr')) return 'fr'
  if (normalized.startsWith('de')) return 'de'
  if (normalized.startsWith('pt')) return 'pt-BR'
  if (normalized.startsWith('ru')) return 'ru'
  return 'en'
}
