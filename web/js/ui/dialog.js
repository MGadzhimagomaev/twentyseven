// Modal sheets on the native <dialog> element: Escape and the backdrop close them,
// and focus returns to where it was.
import { el } from '../util.js';

export function openSheet(content, { label, onClose, wide = false } = {}) {
  const back = document.activeElement;
  const dialog = el('dialog', { class: wide ? 'sheet wide' : 'sheet', 'aria-label': label });
  dialog.append(content);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    onClose?.();
    if (back && back.isConnected) back.focus({ preventScroll: true });
  };
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, close };
}

export const isSheetOpen = () => !!document.querySelector('dialog.sheet[open]');

// Asks a yes/no question. Resolves true only when the confirm button is pressed.
export function confirmSheet({ title, text, confirm, cancel = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    let answer = false;
    const ok = el('button', { type: 'button', class: danger ? 'btn danger' : 'btn primary', text: confirm, onclick: () => { answer = true; sheet.close(); } });
    const body = el('div', { class: 'confirm' },
      el('h2', { class: 'sheet-title', text: title }),
      el('p', { class: 'sheet-text', text }),
      el('div', { class: 'sheet-actions' },
        el('button', { type: 'button', class: 'btn', text: cancel, onclick: () => sheet.close() }),
        ok));
    const sheet = openSheet(body, { label: title, onClose: () => resolve(answer) });
    ok.focus();
  });
}
