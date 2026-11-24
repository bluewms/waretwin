import { useMemo } from "react";
import { create } from "zustand";
import { applyLocale, displayLabel, readLocale, translate, writeLocale, type Locale, type Translate } from "./locale";

export type { Message, Translate } from "./locale";

const useLanguage = create<{ locale: Locale; setLocale: (locale: Locale) => void }>((set) => ({
  locale: "en",
  setLocale(locale) {
    writeLocale(locale);
    set({ locale });
  },
}));

export function initializeLanguage() {
  const locale = readLocale();
  applyLocale(locale);
  useLanguage.setState({ locale });
}

export function useI18n() {
  const locale = useLanguage((state) => state.locale);
  return useMemo(() => ({
    locale,
    tr: ((message, ...values) => translate(locale, message, ...values)) satisfies Translate,
    label: (key: string, fallback?: string) => displayLabel(locale, key, fallback),
  }), [locale]);
}

export function LanguageSwitch() {
  const { locale, tr } = useI18n();
  const setLocale = useLanguage((state) => state.setLocale);
  return (
    <select
      className="language-switch"
      aria-label={tr("Language")}
      value={locale}
      onChange={(event) => setLocale(event.target.value === "zh-CN" ? "zh-CN" : "en")}
    >
      <option lang="en" value="en">English</option>
      <option lang="zh-CN" value="zh-CN">简体中文</option>
    </select>
  );
}
