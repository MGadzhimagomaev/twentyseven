// One short note at the bottom of the screen, with an optional button such as Undo.
// A new note replaces the one showing.
import { el } from '../util.js';

let region = null, timer = 0;

function ensureRegion() {
  if (region) return region;
  region = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
  document.body.append(region);
  return region;
}

export function toast(text, { action, onAction, ms = 5000 } = {}) {
  const host = ensureRegion();
  clearTimeout(timer);
  const close = () => { clearTimeout(timer); host.replaceChildren(); };
  const note = el('div', { class: 'toast' },
    el('span', { class: 'toast-text', text }),
    action ? el('button', { type: 'button', class: 'toast-btn', text: action, onclick: () => { close(); onAction?.(); } }) : null);
  host.replaceChildren(note);
  timer = setTimeout(close, ms);
  return close;
}

export function clearToast() {
  if (region) { clearTimeout(timer); region.replaceChildren(); }
}
