// Starts the app: sign-in, first-launch setup, then Sets, History and Settings.
import { el, ICON, isoDate } from './util.js';
import { createApi } from './api.js';
import { t, setLanguage, preferredLanguage, onLanguage } from './i18n.js';
import { createStore } from './store.js';
import { toast } from './ui/toast.js';
import { isSheetOpen } from './ui/dialog.js';
import { authView } from './ui/auth.js';
import { setupView } from './ui/setup.js';
import { setsView } from './ui/sets.js';
import { historyView } from './ui/history.js';
import { settingsView } from './ui/settings.js';

// An expired sign-in link comes back with the error in the address. Read it before
// the sign-in library starts, and tidy the address.
function takeLinkError() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.has('access_token') || !(hash.has('error') || hash.has('error_code'))) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return hash.get('error_code') === 'otp_expired' ? 'expired' : 'failed';
}
const linkError = takeLinkError();

// The words on screen: the language picked in Settings, else the phone's.
try { await setLanguage(preferredLanguage(), { save: false }); } catch { /* stays in English */ }

const root = document.getElementById('app');
let store;
try {
  store = createStore(createApi());
} catch (e) {
  root.replaceChildren(el('main', { class: 'page' }, el('p', { class: 'hint', text: t('app.couldnt_start', { message: e.message }) })));
  throw e;
}

const TABS = [
  { route: 'sets', icon: ICON.sets },
  { route: 'history', icon: ICON.history },
  { route: 'settings', icon: ICON.settings },
];
const isTab = name => TABS.some(tab => tab.route === name);
function route() {
  const [name, sub] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: isTab(name) ? name : 'sets', sub: sub || '' };
}
function go(path) {
  if (location.hash !== `#${path}`) location.hash = path;
  else render();
}

function undo() {
  const item = store.undo();
  if (!item) { toast(t('undo.nothing')); return; }
  toast(t('undo.done', { what: item.label }));
  current?.view.afterUndo?.(item);
}

const ctx = { store, toast, undo, go };
let current = null;        // { key, view, sub }
let fromSignIn = false;    // the sign-in or setup screen was shown: open Sets next

function shell(view, active) {
  const nav = el('nav', { class: 'tabs', 'aria-label': t('tabs.label') },
    ...TABS.map(tab => el('a', {
      class: 'tab', href: `#${tab.route}`, 'aria-current': tab.route === active ? 'page' : null, html: tab.icon,
    }, el('span', { text: t(`tabs.${tab.route}`) }))));
  return el('div', { class: 'frame' }, view.el, nav);
}

function splash(text, retry) {
  return {
    el: el('main', { class: 'page splash' },
      el('p', { class: 'brand', text: '20/7' }),
      text ? el('p', { class: 'hint', text }) : null,
      retry ? el('button', { type: 'button', class: 'btn', text: t('common.try_again'), onclick: retry }) : null),
  };
}

function make(key, s) {
  switch (key) {
    case 'starting': return splash('');
    case 'loading':
      return s.loadError
        ? splash(t(s.loadError.kind === 'network' ? 'app.offline_first' : 'app.load_failed'), () => store.refresh())
        : splash(t('app.loading'));
    case 'auth': return authView(ctx);
    case 'setup': return setupView(ctx);
    case 'sets': return setsView(ctx);
    case 'history': return historyView(ctx);
    case 'settings': return settingsView(ctx);
    default: return splash('');
  }
}

function render() {
  const s = store.state;
  const r = route();
  let key;
  if (s.phase === 'starting') key = 'starting';
  else if (s.phase === 'signed-out') key = 'auth';
  else if (!s.settings) key = s.loadError ? 'loading-error' : 'loading';
  else if (!s.settings.onboarded_at) key = 'setup';
  else key = r.name;

  // Right after signing in or finishing setup, start on Sets (where the tour is),
  // whatever page the address was left on.
  if (key === 'auth' || key === 'setup') fromSignIn = true;
  else if (fromSignIn && isTab(key)) {
    fromSignIn = false;
    if (key !== 'sets') {
      history.replaceState(null, '', `${location.pathname}${location.search}#sets`);
      key = 'sets';
    }
  }

  if (current?.key !== key) {
    current?.view.destroy?.();
    const view = make(key === 'loading-error' ? 'loading' : key, s);
    const inApp = isTab(key);
    const frame = inApp ? shell(view, key) : view.el;
    root.replaceChildren(frame);
    current = { key, view, sub: r.sub };
    if (key === 'history') view.setTab(r.sub);
    window.scrollTo(0, 0);
  } else if (key === 'history' && current.sub !== r.sub) {
    current.sub = r.sub;
    current.view.setTab(r.sub);
    window.scrollTo(0, 0);
  }
  current.view.update?.(s);
}

store.subscribe(render);
// A new language redraws the whole screen, keeping the scroll position.
onLanguage(() => {
  const y = window.scrollY;
  current?.view.destroy?.();
  current = null;
  render();
  window.scrollTo(0, y);
});
store.onNotice(text => toast(text));
window.addEventListener('hashchange', render);

// Ctrl+Z / ⌘Z takes back the last action, except while typing.
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
  const target = e.target;
  if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  if (isSheetOpen() || document.querySelector('.tour-card') || store.state.phase !== 'ready' || !store.state.settings?.onboarded_at) return;
  e.preventDefault();
  undo();
});

// Save what's waiting and catch up when the connection or the app comes back.
window.addEventListener('online', () => store.wake());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') store.wake(); });

// A new day (or week) while the app stays open.
let today = isoDate();
setInterval(() => {
  if (isoDate() !== today) { today = isoDate(); render(); }
}, 30000);

render();
store.init({ linkError });

// Works offline once installed. Skipped on this machine's test server.
if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* the app still works online */ });
}
