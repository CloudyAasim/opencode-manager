import { STORAGE_KEYS } from '@/lib/storage-keys'
import i18n from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import { en } from './locales/en'
import { zhCN } from './locales/zh-CN'

export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_STORAGE_KEY = STORAGE_KEYS.locale

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
}

function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

export function detectLocale(): SupportedLocale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored && isSupportedLocale(stored)) return stored
  } catch {
    // localStorage unavailable (SSR / restricted browser)
  }

  if (typeof navigator !== 'undefined') {
    const candidates = navigator.languages?.length ? navigator.languages : [navigator.language]
    for (const candidate of candidates) {
      const normalized = (candidate || '').toLowerCase()
      if (normalized.startsWith('zh')) return 'zh-CN'
      if (normalized.startsWith('en')) return 'en'
    }
  }

  return 'en'
}

export function currentLocale(): SupportedLocale {
  return isSupportedLocale(i18n.language) ? i18n.language : 'en'
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
    },
    lng: detectLocale(),
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LOCALES],
    load: 'currentOnly',
    initAsync: false,
    interpolation: { escapeValue: false },
  })

  if (typeof document !== 'undefined') {
    document.documentElement.lang = currentLocale()
  }
}

export function setLocale(locale: SupportedLocale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // ignore storage failures
  }
  void i18n.changeLanguage(locale)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}

export function useI18n() {
  const { t } = useTranslation()
  return { t, locale: currentLocale(), setLocale }
}

export { i18n }
