import { create } from 'zustand'
import en from './en'
import zhCN from './zh-CN'

export type Locale = 'en' | 'zh-CN'

interface I18nStore {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const savedLocale = (localStorage.getItem('redix:locale') || 'en') as Locale

const dicts: Record<Locale, Record<string, string>> = {
  en,
  'zh-CN': zhCN,
}

function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const dict = dicts[locale]
  let text = dict[key] ?? en[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return text
}

function createTranslator(locale: Locale): I18nStore['t'] {
  return (key, params) => translate(locale, key, params)
}

export const useI18n = create<I18nStore>((set) => ({
  locale: savedLocale,

  setLocale: (locale) => {
    localStorage.setItem('redix:locale', locale)
    set({ locale, t: createTranslator(locale) })
  },

  t: createTranslator(savedLocale),
}))
