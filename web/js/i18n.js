// The words on screen, in the person's language. English is the base; every other
// language is a dictionary with the same keys, loaded when it's chosen. A key a
// language lacks falls back to English, so nothing ever shows up blank.
import en from './locales/en.js';

// Code, then the language's own name, as shown in Settings.
export const LANGUAGES = [
  ['en', 'English'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'], ['it', 'Italiano'],
  ['pt', 'Português'], ['ru', 'Русский'], ['zh', '中文'], ['ja', '日本語'],
];
const KEY = 'twentyseven.lang';
const known = code => LANGUAGES.some(([c]) => c === code);

let lang = 'en';
let dict = en;
let rules = new Intl.PluralRules('en-GB');
const listeners = new Set();

export const language = () => lang;

// Dates and numbers follow the language. English uses British dates and a
// 24-hour clock; Chinese is Simplified, Portuguese Brazilian.
export const locale = () => ({ en: 'en-GB', zh: 'zh-CN', pt: 'pt-BR' })[lang] || lang;

// t('sets.goal', { n: 22 }). A value can depend on a number: { one, few, many, other }.
export function t(key, vars = {}) {
  let s = dict[key] ?? en[key];
  if (s == null) return key;
  if (typeof s === 'object') s = s[rules.select(Number(vars.n ?? 0))] ?? s.other;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// Like t(), but {names} become the given DOM nodes, e.g. an icon inside a sentence.
export function tParts(key, parts = {}) {
  const marks = Object.fromEntries(Object.keys(parts).map(k => [k, `\u0000${k}\u0000`]));
  return t(key, marks).split('\u0000').map((piece, i) => (i % 2 ? parts[piece] : piece)).filter(p => p !== '');
}

// The language picked in Settings, else the first of the phone's languages we
// have, else English.
export function preferredLanguage() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && known(saved)) return saved;
  } catch { /* storage blocked */ }
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language || 'en']) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (known(base)) return base;
  }
  return 'en';
}

export const chosenLanguage = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

// `save: false` follows the phone without remembering a choice.
export async function setLanguage(code, { save = true } = {}) {
  if (!known(code)) code = 'en';
  dict = code === 'en' ? en : (await import(`./locales/${code}.js`)).default;
  lang = code;
  rules = new Intl.PluralRules(locale());
  document.documentElement.lang = locale();
  if (save) { try { localStorage.setItem(KEY, code); } catch { /* storage blocked */ } }
  for (const fn of listeners) fn(code);
}

export const onLanguage = fn => { listeners.add(fn); return () => listeners.delete(fn); };
