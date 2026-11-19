// Incrémenter VERSION à chaque modification d'un fichier de SHELL : c'est ce qui force la mise à jour chez l'utilisateur.
const VERSION = 'v6';
const CACHE = `collections-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'db.js',
  'sync.js',
  'items.js',
  'categories.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Les appels aux API externes (étape 4) passent directement par le réseau.
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).catch(() => {
      if (req.mode === 'navigate') return caches.match('./');
      throw new Error('Hors ligne');
    })),
  );
});
