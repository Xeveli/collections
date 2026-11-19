// Incrémenter VERSION à chaque modification d'un fichier de SHELL : c'est ce qui force la mise à jour chez l'utilisateur.
const VERSION = 'v16';
const CACHE = `collections-${VERSION}`;
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/';
// Cache à part, gardé d'une version de l'appli à l'autre : Three.js ne change qu'avec THREE_URL.
const THREE_CACHE = 'three-0.170.0';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'db.js',
  'sync.js',
  'items.js',
  'categories.js',
  'sources.js',
  'goodreads.js',
  'shelves3d.js',
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== THREE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Three.js (version épinglée) : gardé en cache au premier usage, pour les rayons hors connexion.
  if (req.url.startsWith(THREE_URL)) {
    event.respondWith(caches.open(THREE_CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }))));
    return;
  }
  // Les appels aux API externes passent directement par le réseau.
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).catch(() => {
      if (req.mode === 'navigate') return caches.match('./');
      throw new Error('Hors ligne');
    })),
  );
});
