// Import de l'export CSV de Goodreads (My Books → Import and export → Export Library).
// Logique pure, testée avec node --test.

import { loose } from './categories.js';
import { normalizeIsbn } from './sources.js';

// CSV standard : champs entre guillemets, "" pour un guillemet, retours à la ligne permis entre guillemets.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head = [], ...body] = rows.filter((r) => r.some((v) => v !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const STATUS = { read: 'termine', 'currently-reading': 'en-cours', 'to-read': 'a-decouvrir' };
// « 2023/11/25 » → « 2023-11-25 »
const isoDate = (d) => (/^\d{4}\/\d{2}\/\d{2}$/.test(d) ? d.replaceAll('/', '-') : undefined);
// Titre sans la série « (L'Héritage, #1) », pour reconnaître un livre déjà saisi à la main.
const titleKey = (t) => loose(String(t).replace(/\s*\([^)]*#[^)]*\)\s*$/, ''));
const bookKey = (title, creators) => `${titleKey(title)}|${loose(creators?.[0] ?? '')}`;

// Lignes Goodreads → nouvelles fiches du rayon Livres. Les livres déjà présents (même identifiant Goodreads,
// ou même titre et même auteur, y compris supprimés) sont ignorés : l'import n'écrase jamais une fiche.
export function fromGoodreads(rows, existing = [], now = Date.now()) {
  if (!rows.length || !('Book Id' in rows[0]) || !('Exclusive Shelf' in rows[0])) {
    throw new Error("Ce fichier n'est pas un export Goodreads (colonnes « Book Id » et « Exclusive Shelf » attendues).");
  }
  const ids = new Set(existing.map((i) => i.id));
  const keys = new Set(existing.filter((i) => i.categoryId === 'livres').map((i) => bookKey(i.title, i.creators)));
  const items = [];
  let skipped = 0;
  for (const r of rows) {
    const title = r.Title.trim();
    if (!title) continue;
    // Auteur principal seulement : « Additional Authors » mêle traducteurs, préfaciers et illustrateurs.
    const creators = r.Author.trim() ? [r.Author.trim()] : [];
    const id = `goodreads-${r['Book Id']}`;
    const key = bookKey(title, creators);
    if (ids.has(id) || keys.has(key)) { skipped += 1; continue; }
    ids.add(id);
    keys.add(key);
    const status = STATUS[r['Exclusive Shelf']];
    const year = Number(r['Original Publication Year'] || r['Year Published']) || undefined;
    // Goodreads écrit les ISBN ="2266320483" pour qu'Excel garde les zéros.
    const isbn = normalizeIsbn(r.ISBN13.replace(/[="]/g, '')) ?? normalizeIsbn(r.ISBN.replace(/[="]/g, ''));
    const added = isoDate(r['Date Added']);
    items.push({
      id,
      categoryId: 'livres',
      title,
      creators,
      year,
      genres: [],
      format: /kindle|ebook/i.test(r.Binding) ? 'numerique' : 'physique',
      status,
      finishedAt: status === 'termine' ? isoDate(r['Date Read']) : undefined,
      // shortcut: couverture par ISBN, limitée par Open Library à ~100 images / 5 min ; au-delà, vignette par défaut
      // jusqu'au prochain affichage. Passer par l'identifiant de couverture (cover_i) si ça gêne.
      cover: isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` : undefined,
      source: { id: 'goodreads', ref: r['Book Id'] },
      createdAt: added ? Date.parse(`${added}T12:00:00Z`) : now,
      updatedAt: now,
    });
  }
  return { items, skipped };
}
