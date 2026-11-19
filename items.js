// Logique pure des fiches (aucun accès au navigateur hors crypto : testée avec node --test).

export const FORMATS = { physique: 'Physique', numerique: 'Numérique' };

// Statut de l'objet ; « à découvrir » et « terminé » prennent le verbe de la catégorie (lu, vu, joué, écouté).
export const STATUSES = ['a-acquerir', 'a-decouvrir', 'en-cours', 'termine'];
const VERBS = {
  livres: ['À lire', 'Lu'], films: ['À voir', 'Vu'], series: ['À voir', 'Vu'], jeux: ['À jouer', 'Terminé'], musique: ['À écouter', 'Écouté'],
};
export function statusLabel(status, categoryId) {
  const [todo, done] = VERBS[categoryId] ?? ['À découvrir', 'Terminé'];
  return { 'a-acquerir': 'À acquérir', 'a-decouvrir': todo, 'en-cours': 'En cours', termine: done }[status];
}

const fold = (s) => s.toLocaleLowerCase('fr');

// crypto.randomUUID n'existe qu'en HTTPS ; getRandomValues marche aussi en http (test sur le réseau local).
export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// « SF, space opera , sf » → ['SF', 'space opera'] : sans vide, sans doublon (casse ignorée).
export function parseList(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text ?? '').split(',')) {
    const v = raw.trim().replace(/\s+/g, ' ');
    if (v && !seen.has(fold(v))) {
      seen.add(fold(v));
      out.push(v);
    }
  }
  return out;
}

// Seuls les liens https sont gardés : bloque javascript:, data:, etc., y compris dans un fichier importé.
export function safeLink(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

// Couverture : lien https, ou image choisie sur l'appareil et stockée en data URL (JPEG/PNG/WebP seulement).
export function safeCover(url) {
  if (typeof url === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url)) return url;
  return safeLink(url);
}

export function filterItems(items, { categoryId = 'tout', shelf = '', genre = '', status = '' } = {}) {
  return items
    .filter((i) => !i.deleted
      && (categoryId === 'tout' || i.categoryId === categoryId)
      && (!shelf || i.shelf === shelf)
      && (!status || i.status === status)
      && (!genre || (i.genres ?? []).some((g) => fold(g) === fold(genre))))
    .sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base', numeric: true }));
}

// Genres distincts (casse ignorée, première orthographe rencontrée), triés.
export function listGenres(items) {
  const byKey = new Map();
  for (const i of items) for (const g of i.genres ?? []) if (!byKey.has(fold(g))) byKey.set(fold(g), g);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
}

// Fiche à enregistrer depuis les champs du formulaire (chaînes). Lève une Error au message affichable.
// Les champs inconnus de la fiche existante (ex. couverture à l'étape 4) sont conservés.
// Un genre déjà utilisé reprend son orthographe existante (« sf » → « SF ») pour ne pas dédoubler les filtres.
export function buildItem(fields, existing, { now = Date.now(), knownGenres = [] } = {}) {
  const known = new Map(knownGenres.map((g) => [fold(g), g]));
  const title = fields.title.trim();
  if (!title) throw new Error('Le titre est obligatoire.');
  const format = fields.format === 'numerique' ? 'numerique' : 'physique';
  let link;
  if (format === 'numerique' && fields.link.trim()) {
    link = safeLink(fields.link.trim());
    if (!link) throw new Error('Le lien doit commencer par https:// (lien de partage iCloud).');
  }
  let year;
  if (fields.year.trim()) {
    year = Number(fields.year.trim());
    if (!Number.isInteger(year) || year < 1 || year > 9999) throw new Error("L'année doit être un nombre, par exemple 1965.");
  }
  const status = STATUSES.includes(fields.status) ? fields.status : undefined;
  let finishedAt;
  if (status === 'termine' && fields.finishedAt?.trim()) {
    finishedAt = fields.finishedAt.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(finishedAt)) throw new Error('La date de fin doit être au format AAAA-MM-JJ.');
  }
  return {
    ...existing,
    id: existing?.id ?? newId(),
    categoryId: fields.categoryId,
    shelf: fields.shelf || undefined,
    title,
    creators: parseList(fields.creators),
    year,
    genres: parseList(fields.genres).map((g) => known.get(fold(g)) ?? g),
    format,
    link,
    status,
    finishedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}
