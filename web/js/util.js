// Small helpers shared by every screen.

export const LOCALE = 'en-GB';

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

const fmtDay = new Intl.DateTimeFormat(LOCALE, { day: 'numeric' });
const fmtMonth = new Intl.DateTimeFormat(LOCALE, { month: 'short' });
const fmtWeekday = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' });
const fmtTime = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const fmtNumber = new Intl.NumberFormat(LOCALE);

export const day = s => fmtDay.format(parseDate(s));
export const month = s => fmtMonth.format(parseDate(s));
export const weekday = s => fmtWeekday.format(parseDate(s));
export const time = iso => fmtTime.format(new Date(iso));
export const number = n => fmtNumber.format(n);

// "16 Nov"
export const dayMonth = s => `${day(s)} ${month(s)}`;

// "23–29 Nov" or "30 Nov – 6 Dec"
export function range(start, end) {
  return month(start) === month(end)
    ? `${day(start)}–${day(end)} ${month(end)}`
    : `${dayMonth(start)} – ${dayMonth(end)}`;
}

// 8432 -> "8.4K", 12000 -> "12K", 950 -> "950"
export function compact(n) {
  if (n < 1000) return String(Math.round(n));
  const k = n / 1000;
  const s = k >= 10 ? k.toFixed(0) : k.toFixed(1);
  return (s.endsWith('.0') ? s.slice(0, -2) : s) + 'K';
}

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
};
