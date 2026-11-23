// Keeps the app's own files on the device so 20/7 opens without a connection.
// Data goes straight to Supabase and is never stored here. BUILD is stamped on
// every deploy, so a new version replaces all the files at once.
const BUILD = '__BUILD__';
const CACHE = `twentyseven-${BUILD}`;
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'privacy/',
  'css/app.css',
  'js/api.js',
  'js/bundles.js',
  'js/config.js',
  'js/main.js',
  'js/store.js',
  'js/tally.js',
  'js/util.js',
  'js/week.js',
  'js/ui/auth.js',
  'js/ui/dialog.js',
  'js/ui/editor.js',
  'js/ui/history.js',
  'js/ui/sets.js',
  'js/ui/settings.js',
  'js/ui/setup.js',
  'js/ui/toast.js',
  'vendor/supabase-2.119.0.js',
  'fonts/atkinson-hyperlegible-next-latin-400-normal.woff2',
  'fonts/atkinson-hyperlegible-next-latin-700-normal.woff2',
  'fonts/big-shoulders-display-latin-700-normal.woff2',
  'fonts/big-shoulders-display-latin-800-normal.woff2',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('twentyseven-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // Supabase and everything else: network only
  if (req.mode === 'navigate') {
    // Pages: the newest from the network, the saved copy when offline.
    event.respondWith(fetch(req).catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match('./')));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
