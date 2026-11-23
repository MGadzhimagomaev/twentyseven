// "Use it like an app": how to put 20/7 on the home screen. iPhone and iPad get
// the steps, since Safari has no install button; browsers that can install apps
// get a button. Hidden once installed, or once closed.
import { el, ICON } from '../util.js';

const KEY = 'twentyseven.installHint';
let deferred = null;                       // the browser's install prompt, when it offers one
const listeners = new Set();
const changed = () => { for (const fn of listeners) fn(); };

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; changed(); });
window.addEventListener('appinstalled', () => { deferred = null; remember(); changed(); });

const installed = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const isApple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const closed = () => { try { return localStorage.getItem(KEY) === 'closed'; } catch { return false; } };
function remember() { try { localStorage.setItem(KEY, 'closed'); } catch { /* ignore */ } }

export const onInstallChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

export function installCard(redraw) {
  if (installed() || closed()) return null;
  const close = el('button', { type: 'button', class: 'ibtn', 'aria-label': 'Close', html: ICON.close, onclick: () => { remember(); redraw(); } });
  if (isApple()) {
    return el('section', { class: 'install', 'aria-label': 'Add to Home Screen' },
      el('div', { class: 'install-body' },
        el('p', { class: 'label', text: 'Use it like an app' }),
        el('p', { class: 'install-line' },
          'Tap ', el('span', { class: 'inline-icon', html: ICON.share }), ' Share (in Safari it may be under ···), then “Add to Home Screen”.')),
      close);
  }
  if (deferred) {
    return el('section', { class: 'install', 'aria-label': 'Install 20/7' },
      el('div', { class: 'install-body' },
        el('p', { class: 'label', text: 'Use it like an app' }),
        el('p', { class: 'install-line', text: 'Install 20/7 to open it from your home screen or dock, like any other app.' }),
        el('button', {
          type: 'button', class: 'btn primary', html: ICON.install,
          onclick: async () => {
            const prompt = deferred;
            deferred = null;
            prompt.prompt();
            const { outcome } = await prompt.userChoice;
            if (outcome === 'accepted') remember();
            redraw();
          },
        }, 'Install')),
      close);
  }
  return null;
}
