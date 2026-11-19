import { STORES } from './sync.js';

const DB_NAME = 'collections';
const DB_VERSION = 1;

// Identifiants fixes : PC et iPhone créent les mêmes catégories par défaut, l'import les fusionne au lieu de les doubler.
// updatedAt 0 : toute modification faite sur un appareil l'emporte.
const DEFAULT_CATEGORIES = [
  { id: 'livres', name: 'Livres', shelves: ['Romans', 'BD', 'Mangas'], order: 1, updatedAt: 0 },
  { id: 'films', name: 'Films', order: 2, updatedAt: 0 },
  { id: 'series', name: 'Séries', order: 3, updatedAt: 0 },
  { id: 'jeux', name: 'Jeux vidéo', order: 4, updatedAt: 0 },
  { id: 'musique', name: 'Musique', order: 5, updatedAt: 0 },
];

let dbPromise;
function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const s of STORES) {
        if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function getAll(store) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Écrit tous les magasins en une seule transaction : un import s'applique en entier ou pas du tout.
export async function putMany(byStore) {
  const db = await open();
  const stores = Object.keys(byStore);
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) for (const r of byStore[s]) tx.objectStore(s).put(r);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function seedDefaults() {
  if ((await getAll('categories')).length === 0) await putMany({ categories: DEFAULT_CATEGORIES });
}
