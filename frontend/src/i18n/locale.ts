import { zhCN } from "./zhCN";

export type Locale = "zh-CN" | "en";
export type Message = keyof typeof zhCN;
export type Translate = (message: Message, ...values: unknown[]) => string;

const storageKey = "waretwin.locale";

export function resolveLocale(preference: string | null, browserLanguages: readonly string[]): Locale {
  if (preference === "zh-CN" || preference === "en") return preference;
  for (const language of browserLanguages) {
    const base = language.toLowerCase().split("-")[0];
    if (base === "zh") return "zh-CN";
    if (base === "en") return "en";
  }
  return "en";
}

export function translate(locale: Locale, message: Message, ...values: unknown[]): string {
  const text = locale === "zh-CN" ? zhCN[message] : message;
  return text.replace(/\{(\d+)\}/g, (placeholder, index: string) =>
    Number(index) < values.length ? String(values[Number(index)]) : placeholder,
  );
}

export function displayLabel(locale: Locale, key: string, fallback = key): string {
  if (locale === "zh-CN" && Object.prototype.hasOwnProperty.call(zhCN, key)) return zhCN[key as Message];
  return fallback;
}

export function readLocale(): Locale {
  let saved = null;
  try { saved = window.localStorage.getItem(storageKey); } catch { /* Storage can be unavailable. */ }
  return resolveLocale(saved, navigator.languages.length ? navigator.languages : [navigator.language]);
}

export function applyLocale(locale: Locale) {
  document.documentElement.lang = locale;
  document.title = translate(locale, "WareTwin — AI Autonomous Warehouse Digital Twin");
}

export function writeLocale(locale: Locale) {
  applyLocale(locale);
  try { window.localStorage.setItem(storageKey, locale); } catch { /* Keep the active selection in memory. */ }
}
