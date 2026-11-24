// Small helpers shared by every screen.
import { locale, language } from './i18n.js';

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// 'YYYY-MM-DD' for a Date, in the device's own time zone.
export function isoDate(d = new Date()) {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// A local-midnight Date for 'YYYY-MM-DD'.
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export function timeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

// Dates and numbers in the current language, e.g. "16 Nov", "16. Nov.", "11月16日".
const formats = new Map();
function format(kind, make) {
  const key = `${locale()}|${kind}`;
  let f = formats.get(key);
  if (!f) formats.set(key, (f = make(locale())));
  return f;
}
const dateFormat = (kind, options) => format(kind, loc => new Intl.DateTimeFormat(loc, options));

export const weekday = s => dateFormat('wd', { weekday: 'short' }).format(parseDate(s));
export const dayMonth = s => dateFormat('dm', { day: 'numeric', month: 'short' }).format(parseDate(s));
export const weekdayDayMonth = s => dateFormat('wdm', { weekday: 'short', day: 'numeric', month: 'short' }).format(parseDate(s));
// Labels under charts must stay short: "23 Nov" where the language writes it
// that way, numbers otherwise ("23/11", "11/23").
const NAMED_AXIS = new Set(['en', 'de', 'es', 'fr', 'it', 'ru']);
export const axisDate = s => (NAMED_AXIS.has(language()) ? dayMonth(s)
  : dateFormat('dmn', { day: 'numeric', month: 'numeric' }).format(parseDate(s)));
export const time = iso => dateFormat('t', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const number = n => format('n', loc => new Intl.NumberFormat(loc)).format(n);

// "23–29 Nov", "30 Nov – 6 Dec", "11月23日至29日": each language's own way.
export function range(start, end) {
  const f = dateFormat('dm', { day: 'numeric', month: 'short' });
  try { return f.formatRange(parseDate(start), parseDate(end)); } catch { return `${f.format(parseDate(start))} – ${f.format(parseDate(end))}`; }
}

// 8432 -> "8.4K" in English, "8,4 Tsd." in German, "8443" where shorter forms
// only start at ten thousand.
export const compact = n => format('c', loc => new Intl.NumberFormat(loc, { notation: 'compact', maximumFractionDigits: 1 })).format(n);

// A <select> with the app's own arrow.
export const selectBox = select => el('span', { class: 'select-wrap' }, select, el('span', { class: 'select-chev', html: ICON.chevron }));

// Builds DOM without HTML strings, so names people type never become markup.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // only ever used with our own SVG markup
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// Replaces a node's children, skipping the null and false left by conditional parts.
export function fill(node, ...children) {
  node.replaceChildren(...children.flat().filter(c => c != null && c !== false));
  return node;
}

export const ICON = {
  minus: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10"/></svg>',
  plus: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10M10 5v10"/></svg>',
  up: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15.5V4.5M5.5 9L10 4.5 14.5 9"/></svg>',
  down: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M5.5 11l4.5 4.5 4.5-4.5"/></svg>',
  remove: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>',
  edit: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 16l.9-3.6L13 4.3l2.7 2.7-8.1 8.1L4 16zM11.4 5.9l2.7 2.7"/></svg>',
  left: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5L7 10l5.5 5.5"/></svg>',
  right: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5L13 10l-5.5 5.5"/></svg>',
  lock: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 9h9v7.5h-9zM7.5 9V6.5a2.5 2.5 0 0 1 5 0V9"/></svg>',
  unlock: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 9h9v7.5h-9zM7.5 9V6.5a2.5 2.5 0 0 1 4.9-.7"/></svg>',
  tick: '<svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.7l3 3 6.6-7.2"/></svg>',
  sets: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 4v12M8 4v12M11.5 4v12M15 4v12M3 13.5l14-7"/></svg>',
  history: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 16.5h13M5.5 13.5V9M9 13.5V5.5M12.5 13.5v-6M16 13.5V3.5"/></svg>',
  settings: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 6h8M14.5 6h2M3.5 14h2M8.5 14h8M11.5 4v4M8.5 12v4"/></svg>',
  undo: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5L4 8l3.5 3.5M4 8h7.5a4.5 4.5 0 0 1 0 9H9"/></svg>',
  close: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8"/></svg>',
  share: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 12.5V3M6.8 6.2L10 3l3.2 3.2M7 9H5v8h10V9h-2"/></svg>',
  install: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9.5M6.5 9L10 12.5 13.5 9M4.5 16.5h11"/></svg>',
  message: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 5h13v8.5H9l-3.5 3v-3h-2z"/></svg>',
  globe: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13zM3.5 10h13M10 3.5c-1.8 1.9-2.7 4-2.7 6.5s.9 4.6 2.7 6.5M10 3.5c1.8 1.9 2.7 4 2.7 6.5s-.9 4.6-2.7 6.5"/></svg>',
  chevron: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 8l4 4 4-4"/></svg>',
};

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
