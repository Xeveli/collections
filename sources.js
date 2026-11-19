// Recherche dans les bases en ligne. Les fonctions parse* sont pures (testées avec node --test) ;
// search / details font les appels réseau. Chaque résultat normalisé :
// { source, ref, title, creators[], year?, cover?, genres[], tracks?[] }

const enc = encodeURIComponent;
const yearOf = (date) => (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : undefined);
// Sans doublon (casse ignorée), première orthographe gardée.
const uniq = (list) => {
  const seen = new Map();
  for (const s of list) if (s && !seen.has(s.toLocaleLowerCase('fr'))) seen.set(s.toLocaleLowerCase('fr'), s);
  return [...seen.values()];
};

/* ---------- Réseau ---------- */

export class SourceError extends Error {}

async function getJSON(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new SourceError('Pas de connexion à internet, ou service injoignable.');
  }
  if (res.status === 401 || res.status === 403) throw new SourceError("Clé d'API refusée : vérifie-la dans les Réglages.");
  if (res.status === 429 || res.status === 503) throw new SourceError('Le service est saturé, réessaie dans quelques secondes.');
  if (!res.ok) throw new SourceError(`Le service a répondu par une erreur (${res.status}).`);
  return res.json();
}

// MusicBrainz refuse plus d'une requête par seconde (réponse 503) : file d'attente espacée, un nouvel essai.
let mbQueue = Promise.resolve();
function mbJSON(url) {
  const run = async () => {
    try {
      return await getJSON(url);
    } catch (err) {
      if (!(err instanceof SourceError) || !/saturé/.test(err.message)) throw err;
      await new Promise((r) => setTimeout(r, 1500));
      return getJSON(url);
    }
  };
  const result = mbQueue.then(run);
  mbQueue = result.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 1100)));
  return result;
}

/* ---------- Codes-barres ---------- */

// ISBN saisi ou scanné → ISBN-13 sans tirets, ou null. Accepte l'ISBN-10 (converti) ; vérifie la clé de contrôle.
export function normalizeIsbn(text) {
  const s = String(text ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (/^97[89]\d{10}$/.test(s)) {
    const sum = [...s].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
    return sum % 10 === 0 ? s : null;
  }
  if (/^\d{9}[\dX]$/.test(s)) {
    const sum = [...s].reduce((acc, d, i) => acc + (d === 'X' ? 10 : Number(d)) * (10 - i), 0);
    if (sum % 11 !== 0) return null;
    const body = `978${s.slice(0, 9)}`;
    const check = (10 - ([...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0) % 10)) % 10;
    return body + check;
  }
  return null;
}

// Code-barres de disque (EAN-13, UPC-A, EAN-8) : chiffres seulement, zéros de tête ignorés pour comparer.
const sameBarcode = (a, b) => String(a ?? '').replace(/^0+/, '') === String(b ?? '').replace(/^0+/, '');

/* ---------- Open Library (livres, sans clé) ---------- */

// Les « sujets » d'Open Library sont en vrac : on garde les courts et lisibles, à proposer à l'utilisateur.
export function pickSubjects(subjects = []) {
  return uniq(subjects.filter((s) => s.length <= 30 && !/,|\(|--|:|\d/.test(s))).slice(0, 8);
}

// Avec lang=fr, Open Library joint l'édition la plus pertinente : on prend son titre et sa
// couverture seulement si elle est en français (sinon titre et couverture de l'œuvre).
// Recherche par ISBN (exactEdition) : l'édition jointe est celle du livre scanné, on la prend telle quelle.
export function parseOpenLibrary(json, { exactEdition = false } = {}) {
  return (json.docs ?? []).map((d) => {
    const ed = d.editions?.docs?.[0];
    const fr = ed && (exactEdition || ed.language?.includes('fre')) ? ed : null;
    const coverId = fr?.cover_i ?? d.cover_i;
    return {
      source: 'openlibrary',
      ref: d.key,
      title: fr?.title ?? d.title,
      creators: d.author_name ?? [],
      year: d.first_publish_year,
      cover: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : undefined,
      genres: pickSubjects(d.subject),
    };
  });
}

/* ---------- TMDB (films, séries ; clé requise) ---------- */

const TMDB = 'https://api.themoviedb.org/3';
const poster = (path) => (path ? `https://image.tmdb.org/t/p/w342${path}` : undefined);

// Clé v3 (32 caractères) en paramètre, ou jeton v4 (long) en en-tête.
function tmdbFetch(path, params, key) {
  const qs = new URLSearchParams({ language: 'fr-FR', ...params });
  if (key.length <= 40) qs.set('api_key', key);
  const init = key.length > 40 ? { headers: { Authorization: `Bearer ${key}` } } : undefined;
  return getJSON(`${TMDB}${path}?${qs}`, init);
}

export function parseTmdbSearch(json, kind) {
  return (json.results ?? []).map((r) => ({
    source: kind === 'tv' ? 'tmdb-tv' : 'tmdb-movie',
    ref: String(r.id),
    title: kind === 'tv' ? r.name : r.title,
    creators: [],
    year: yearOf(kind === 'tv' ? r.first_air_date : r.release_date),
    cover: poster(r.poster_path),
    genres: [],
  }));
}

export function parseTmdbDetails(json, kind) {
  const creators = kind === 'tv'
    ? (json.created_by ?? []).map((c) => c.name)
    : (json.credits?.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name);
  return { creators: uniq(creators), genres: (json.genres ?? []).map((g) => g.name) };
}

/* ---------- RAWG (jeux vidéo ; clé requise) ---------- */

const RAWG = 'https://api.rawg.io/api';

export function parseRawgSearch(json) {
  return (json.results ?? []).map((g) => ({
    source: 'rawg',
    ref: String(g.id),
    title: g.name,
    creators: [],
    year: yearOf(g.released),
    cover: g.background_image ?? undefined,
    genres: (g.genres ?? []).map((x) => x.name),
  }));
}

export function parseRawgDetails(json) {
  return { creators: (json.developers ?? []).map((d) => d.name), genres: (json.genres ?? []).map((x) => x.name) };
}

/* ---------- MusicBrainz + Cover Art Archive (musique, sans clé) ---------- */

const MB = 'https://musicbrainz.org/ws/2';

export function parseMbSearch(json) {
  return (json['release-groups'] ?? []).map((g) => ({
    source: 'musicbrainz',
    ref: g.id,
    title: g.title,
    creators: (g['artist-credit'] ?? []).map((a) => a.name),
    year: yearOf(g['first-release-date']),
    // Pochette absente → l'image échoue et l'appli affiche la vignette par défaut.
    cover: `https://coverartarchive.org/release-group/${g.id}/front-250`,
    genres: [],
    kind: g['primary-type'],
  }));
}

const duration = (ms) => (Number.isFinite(ms) ? `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}` : undefined);

// Recherche par code-barres : des éditions (releases). On garde celles dont le code correspond exactement
// (la recherche MusicBrainz est approximative) ; l'édition précise sert ensuite pour la tracklist.
export function parseMbBarcode(json, code) {
  const releases = json.releases ?? [];
  const exact = releases.filter((r) => sameBarcode(r.barcode, code));
  return (exact.length ? exact : releases).map((r) => ({
    source: 'musicbrainz',
    ref: r['release-group']?.id,
    release: r.id,
    title: r.title,
    creators: (r['artist-credit'] ?? []).map((a) => a.name),
    year: yearOf(r.date),
    cover: `https://coverartarchive.org/release-group/${r['release-group']?.id}/front-250`,
    genres: [],
    kind: r['release-group']?.['primary-type'],
  })).filter((r) => r.ref);
}

// releaseJson : une édition (avec media) ou une liste d'éditions (la première sert).
export function parseMbDetails(groupJson, releaseJson) {
  const genres = [...(groupJson.genres ?? [])].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).map((g) => g.name);
  const media = (releaseJson.media ? releaseJson : releaseJson.releases?.[0])?.media ?? [];
  const tracks = media.flatMap((m) => (m.tracks ?? []).map((t) => ({ title: t.title, length: duration(t.length) })));
  return { genres: genres.slice(0, 8), tracks };
}

/* ---------- Catalogue ---------- */

export const SOURCES = {
  openlibrary: {
    label: 'Open Library',
    url: 'https://openlibrary.org',
    // Un ISBN tapé dans le titre (ou scanné) cherche l'édition exacte.
    search: async (q) => {
      const isbn = normalizeIsbn(q);
      const json = await getJSON(`https://openlibrary.org/search.json?q=${enc(isbn ? `isbn:${isbn}` : q)}&lang=fr&limit=10&fields=${
        'key,title,author_name,first_publish_year,subject,cover_i,editions,editions.title,editions.language,editions.cover_i'}`);
      return parseOpenLibrary(json, { exactEdition: Boolean(isbn) });
    },
  },
  'tmdb-movie': {
    label: 'TMDB',
    url: 'https://www.themoviedb.org',
    keyName: 'tmdb',
    search: async (q, key) => parseTmdbSearch(await tmdbFetch('/search/movie', { query: q, include_adult: 'false' }, key), 'movie'),
    details: async (r, key) => parseTmdbDetails(await tmdbFetch(`/movie/${r.ref}`, { append_to_response: 'credits' }, key), 'movie'),
  },
  'tmdb-tv': {
    label: 'TMDB',
    url: 'https://www.themoviedb.org',
    keyName: 'tmdb',
    search: async (q, key) => parseTmdbSearch(await tmdbFetch('/search/tv', { query: q, include_adult: 'false' }, key), 'tv'),
    details: async (r, key) => parseTmdbDetails(await tmdbFetch(`/tv/${r.ref}`, {}, key), 'tv'),
  },
  rawg: {
    label: 'RAWG',
    url: 'https://rawg.io',
    keyName: 'rawg',
    search: async (q, key) => parseRawgSearch(await getJSON(`${RAWG}/games?key=${enc(key)}&search=${enc(q)}&page_size=10`)),
    details: async (r, key) => parseRawgDetails(await getJSON(`${RAWG}/games/${enc(r.ref)}?key=${enc(key)}`)),
  },
  musicbrainz: {
    label: 'MusicBrainz',
    url: 'https://musicbrainz.org',
    search: async (q) => parseMbSearch(await mbJSON(`${MB}/release-group/?query=${enc(q)}&fmt=json&limit=10`)),
    byBarcode: async (code) => parseMbBarcode(await mbJSON(`${MB}/release/?query=barcode:${enc(code)}&fmt=json&limit=10`), code),
    details: async (r) => parseMbDetails(
      await mbJSON(`${MB}/release-group/${enc(r.ref)}?inc=genres&fmt=json`),
      await mbJSON(r.release
        ? `${MB}/release/${enc(r.release)}?inc=recordings&fmt=json`
        : `${MB}/release?release-group=${enc(r.ref)}&inc=recordings&fmt=json&limit=1`)),
  },
};

// Source par catégorie par défaut ; une catégorie créée par l'utilisateur n'en a pas.
export const SOURCE_BY_CATEGORY = {
  livres: 'openlibrary', films: 'tmdb-movie', series: 'tmdb-tv', jeux: 'rawg', musique: 'musicbrainz',
};
