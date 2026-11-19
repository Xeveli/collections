import { getAll, putMany, seedDefaults } from './db.js';
import { buildExport, parseImport, planMerge, STORES } from './sync.js';
import { FORMATS, STATUSES, buildItem, filterItems, listGenres, newId, parseList, safeCover, safeLink, statusLabel } from './items.js';
import { fromGoodreads, parseCsv } from './goodreads.js';
import {
  addShelf, byOrder, categoryClash, checkCategoryName, cleanName, deleteCategory, moveCategory, removeShelf,
  renameCategory, renameShelf, shelfClash,
} from './categories.js';
import { SOURCES, SOURCE_BY_CATEGORY, SourceError, normalizeIsbn } from './sources.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

// Tout le texte saisi ou importé passe par textContent / append : jamais par innerHTML.
const VIEW_KEY = 'collections:view';
let savedView = null;
try { savedView = localStorage.getItem(VIEW_KEY); } catch { /* préférence non critique */ }
// Vue Rayons en cours de mise au point : visible en local (PC ou iPhone sur le réseau local), masquée sur le site publié.
const SHOW_3D = !location.hostname.endsWith('github.io');
const state = { categoryId: 'tout', shelf: '', genre: '', status: '', view: SHOW_3D && savedView === 'rayons' ? 'rayons' : 'liste', categories: [], items: [] };

async function load() {
  state.categories = byOrder(await getAll('categories'));
  state.items = await getAll('items');
  if (state.categoryId !== 'tout' && !catById(state.categoryId)) state.categoryId = 'tout';
}
const catById = (id) => state.categories.find((c) => c.id === id);

function render() {
  renderCats();
  renderFilters();
  renderList();
}

/* ---------- Catégories ---------- */

function renderCats() {
  const pills = [{ id: 'tout', name: 'Tout' }, ...state.categories].map((c) => {
    const b = el('button', { type: 'button', textContent: c.name });
    b.setAttribute('aria-pressed', String(c.id === state.categoryId));
    b.addEventListener('click', () => {
      Object.assign(state, { categoryId: c.id, shelf: '', genre: '' });
      render();
    });
    return b;
  });
  const manage = el('button', { type: 'button', textContent: 'Gérer', className: 'manage-cats' });
  manage.setAttribute('aria-label', 'Gérer les catégories et étagères');
  manage.addEventListener('click', () => { renderManage(); $('cats-dialog').showModal(); });
  $('cats').replaceChildren(...pills, manage);
}

// Applique une opération de categories.js, puis rafraîchit l'écran et la fenêtre de gestion.
// Les erreurs de saisie (nom vide, doublon) s'affichent sans rien écrire.
async function apply(op, undoLabel) {
  try {
    const changes = op(Date.now());
    if (!changes) return;
    const before = snapshot(changes);
    await putMany(changes);
    await load();
    render();
    renderManage();
    if (undoLabel) offerUndo(undoLabel, before);
  } catch (err) {
    alert(err.message);
    renderManage();
  }
}

/* ---------- Annulation ---------- */

const UNDO_MS = 15000;
let undoTimer;

// Versions actuelles des fiches qu'une opération va réécrire.
function snapshot(changes) {
  const find = (list, ids) => list.filter((r) => ids.includes(r.id));
  return {
    categories: find(state.categories, (changes.categories ?? []).map((r) => r.id)),
    items: find(state.items, (changes.items ?? []).map((r) => r.id)),
  };
}

// Bandeau « … · Annuler » : l'annulation réécrit les versions d'avant avec un updatedAt neuf,
// pour que la synchro retienne la restauration. Un nouveau bandeau remplace le précédent.
function offerUndo(label, before) {
  clearTimeout(undoTimer);
  $('toast-text').textContent = label;
  $('toast').hidden = false;
  $('toast-undo').onclick = async () => {
    hideToast();
    const now = Date.now();
    const restore = (list) => list.map((r) => ({ ...r, updatedAt: now }));
    try {
      await putMany({ categories: restore(before.categories), items: restore(before.items) });
      await load();
      render();
      if ($('cats-dialog').open) renderManage();
    } catch (err) {
      showFatal(err);
    }
  };
  undoTimer = setTimeout(hideToast, UNDO_MS);
}
function hideToast() {
  clearTimeout(undoTimer);
  $('toast').hidden = true;
}

const count = (categoryId, shelf) => state.items
  .filter((i) => !i.deleted && i.categoryId === categoryId && (shelf === undefined || i.shelf === shelf)).length;
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

// Remplace prompt(), qui lève une erreur dans certains navigateurs intégrés (dont celui de l'appli Claude).
// Une seule question en attente à la fois : l'événement « close » peut arriver en retard, et des réponses
// en attente s'appliqueraient alors toutes avec la dernière saisie. On répond donc dès « submit ».
let settle = null;
function ask(label, value = '') {
  settle?.(null);
  $('ask-label').textContent = label;
  $('ask-input').value = value;
  $('ask-dialog').showModal();
  $('ask-input').select();
  return new Promise((resolve) => {
    settle = (answer) => { settle = null; resolve(answer); };
  });
}
$('ask-form').addEventListener('submit', () => settle?.($('ask-input').value)); // method="dialog" ferme la fenêtre
$('ask-cancel').addEventListener('click', () => { settle?.(null); $('ask-dialog').close(); });
// Échap : « cancel » part tout de suite, alors qu'un « close » en retard annulerait la question suivante.
$('ask-dialog').addEventListener('cancel', () => settle?.(null));

// Avertissement non bloquant (categoryClash / shelfClash) : renvoie false si l'utilisateur renonce.
const acceptClash = (message, question) => !message || confirm(`${message}\n\n${question}`);
const sameName = (a, b) => cleanName(a).toLocaleLowerCase('fr') === cleanName(b).toLocaleLowerCase('fr');

async function addCategory() {
  const raw = await ask('Nom de la nouvelle catégorie');
  if (raw === null) return;
  if (!acceptClash(categoryClash(raw, state.categories), 'Créer quand même la catégorie ?')) return;
  apply((now) => {
    const name = checkCategoryName(raw, state.categories);
    const order = Math.max(0, ...state.categories.map((c) => c.order)) + 1;
    return { categories: [{ id: newId(), name, order, updatedAt: now }], items: [] };
  });
}

async function editShelf(cat, shelf) {
  const raw = await ask(`Renommer l'étagère « ${shelf} » (laisse vide pour la supprimer)`, shelf);
  if (raw === null) return;
  if (raw.trim()) {
    if (!sameName(raw, shelf) && !acceptClash(shelfClash(raw, state.categories, cat.id), 'Renommer quand même l\'étagère ?')) return;
    apply((now) => renameShelf(cat, state.items, shelf, raw, now));
    return;
  }
  const n = count(cat.id, shelf);
  const detail = n ? `\n\n${plural(n, 'objet')} y ${n > 1 ? 'sont rangés' : 'est rangé'} : ${n > 1 ? 'ils restent' : 'il reste'} dans ${cat.name}, sans étagère.` : '';
  if (confirm(`Supprimer l'étagère « ${shelf} » ?${detail}`)) {
    apply((now) => removeShelf(cat, state.items, shelf, now), `Étagère « ${shelf} » supprimée`);
  }
}

function renderManage() {
  const list = state.categories;
  $('cats-list').replaceChildren(...list.map((cat, idx) => {
    const name = el('input', { value: cat.name, autocomplete: 'off', ariaLabel: `Nom de la catégorie ${cat.name}` });
    name.addEventListener('change', () => {
      if (!sameName(name.value, cat.name)
        && !acceptClash(categoryClash(name.value, state.categories, cat.id), 'Renommer quand même la catégorie ?')) {
        renderManage(); // remet l'ancien nom
        return;
      }
      apply((now) => renameCategory(state.categories, cat.id, name.value, now));
    });

    const btn = (text, label, onClick, disabled = false) => {
      const b = el('button', { type: 'button', textContent: text, ariaLabel: label, disabled, className: 'icon' });
      b.addEventListener('click', onClick);
      return b;
    };
    const up = btn('↑', `Monter ${cat.name}`, () => apply((now) => moveCategory(state.categories, cat.id, -1, now)), idx === 0);
    const down = btn('↓', `Descendre ${cat.name}`, () => apply((now) => moveCategory(state.categories, cat.id, 1, now)), idx === list.length - 1);
    const del = btn('Supprimer', `Supprimer ${cat.name}`, () => {
      const n = count(cat.id);
      const detail = n ? `\n\n${n > 1 ? `Ses ${n} objets seront supprimés` : 'Son objet sera supprimé'} aussi.` : '';
      if (confirm(`Supprimer la catégorie « ${cat.name} » ?${detail}`)) {
        apply((now) => deleteCategory(cat, state.items, now), `Catégorie « ${cat.name} » supprimée`);
      }
    });
    del.className = 'danger';

    const shelves = (cat.shelves ?? []).map((s) => {
      const b = el('button', { type: 'button', textContent: `${s} (${count(cat.id, s)})`, ariaLabel: `Étagère ${s} : renommer ou supprimer` });
      b.addEventListener('click', () => editShelf(cat, s));
      return b;
    });
    const addS = el('button', { type: 'button', textContent: '+ Étagère', className: 'add-shelf' });
    addS.addEventListener('click', async () => {
      const raw = await ask(`Nom de la nouvelle étagère dans ${cat.name}`);
      if (raw === null) return;
      if (!acceptClash(shelfClash(raw, state.categories, cat.id), 'Créer quand même l\'étagère ?')) return;
      apply((now) => addShelf(cat, raw, now));
    });

    return el('li', { className: 'cat-row' },
      el('div', { className: 'cat-line' }, name, up, down),
      el('div', { className: 'cat-meta' },
        el('span', { className: 'muted small', textContent: plural(count(cat.id), 'objet') }), del),
      el('div', { className: 'shelf-chips' }, ...shelves, addS));
  }));
}

$('add-category').addEventListener('click', addCategory);

/* ---------- Filtres et liste ---------- */

function fillSelect(select, allLabel, values, selected) {
  select.replaceChildren(el('option', { value: '', textContent: allLabel }),
    ...values.map((v) => el('option', { value: v, textContent: v, selected: v === selected })));
}

function renderFilters() {
  $('filter-status').replaceChildren(el('option', { value: '', textContent: 'Tous les statuts' }),
    ...STATUSES.map((v) => el('option', { value: v, textContent: statusLabel(v, state.categoryId), selected: v === state.status })));

  const shelves = catById(state.categoryId)?.shelves ?? [];
  if (!shelves.includes(state.shelf)) state.shelf = '';
  fillSelect($('filter-shelf'), 'Toutes les étagères', shelves, state.shelf);
  $('filter-shelf').hidden = shelves.length === 0;

  const genres = listGenres(filterItems(state.items, { categoryId: state.categoryId, shelf: state.shelf }));
  if (!genres.includes(state.genre)) state.genre = '';
  fillSelect($('filter-genre'), 'Tous les genres', genres, state.genre);
  $('filter-genre').hidden = genres.length === 0;
}

const SPINES = 4;
function spineClass(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `cover spine-${(h % SPINES) + 1}`;
}

// Couverture en ligne (https seulement) ; hors ligne ou introuvable, vignette colorée à l'initiale.
function coverEl(item) {
  const placeholder = el('span', { className: spineClass(item.id), textContent: item.title.charAt(0).toUpperCase(), ariaHidden: 'true' });
  const url = safeCover(item.cover);
  if (!url) return placeholder;
  const img = el('img', { className: 'cover', src: url, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(placeholder), { once: true });
  return img;
}

function itemRow(item) {
  const cat = catById(item.categoryId);
  const meta = [item.creators?.join(', '), item.year, state.categoryId === 'tout' ? cat?.name : null, item.shelf]
    .filter(Boolean).join(' · ');
  const open = el('button', { type: 'button', className: 'item' },
    coverEl(item),
    el('span', { className: 'info' },
      el('span', { className: 'title', textContent: item.title }),
      meta ? el('span', { className: 'meta', textContent: meta }) : '',
      item.genres?.length ? el('span', { className: 'tags' }, ...item.genres.map((g) => el('span', { textContent: g }))) : ''),
    el('span', { className: 'badges' },
      item.status ? el('span', { className: `badge status-${item.status}`, textContent: statusLabel(item.status, item.categoryId) ?? '' }) : '',
      // « À acquérir » : on ne possède encore aucun support.
      item.status === 'a-acquerir' ? '' : el('span', { className: `badge ${item.format}`, textContent: FORMATS[item.format] ?? FORMATS.physique })));
  open.addEventListener('click', () => openForm(item));
  const link = item.format === 'numerique' && safeLink(item.link);
  return el('li', {}, open, link ? el('a', { href: link, target: '_blank', rel: 'noopener', className: 'open-file', textContent: 'Ouvrir le fichier' }) : '');
}

function renderList() {
  const alive = state.items.filter((i) => !i.deleted);
  const list = filterItems(state.items, state);
  $('items').replaceChildren(...list.map(itemRow));
  $('empty').hidden = alive.length > 0;
  $('toolbar').hidden = alive.length === 0;
  $('no-match').hidden = alive.length === 0 || list.length > 0;
  $('no-match').textContent = state.shelf || state.genre || state.status
    ? 'Aucun objet ne correspond à ces filtres.'
    : 'Rien dans cette catégorie pour l\'instant.';
  $('count').textContent = `${list.length} objet${list.length > 1 ? 's' : ''}`;
  const rayons = state.view === 'rayons';
  $('view-toggle').textContent = rayons ? 'Liste' : 'Rayons';
  $('view-toggle').hidden = !SHOW_3D;
  $('items').hidden = rayons;
  if (rayons) $('no-match').hidden = true;
  $('shelves3d').hidden = !rayons || alive.length === 0;
  if (rayons && alive.length) showShelves(list);
}

/* ---------- Vue Rayons (3D) ---------- */

let shelves = null; // promesse de la scène, créée au premier affichage

// Un rayon par étagère de la catégorie (ou celle filtrée) ; dans « Tout », un rayon par catégorie.
function shelfGroups() {
  const cat = catById(state.categoryId);
  if (!cat) return state.categories.map((c) => c.name);
  if (state.shelf) return [state.shelf];
  return cat.shelves?.length ? cat.shelves : [cat.name];
}

async function showShelves() {
  const box = $('shelves3d');
  shelves ??= import('./shelves3d.js').then((m) => {
    if (!m.hasWebGL()) throw new Error("Cet appareil n'affiche pas la 3D.");
    return m.createShelves(box);
  });
  try {
    (await shelves).show(shelfGroups());
  } catch (err) {
    console.error(err);
    shelves = null;
    box.replaceChildren(el('p', { className: 'muted shelves-error', textContent: err.message.startsWith('Cet appareil')
      ? `${err.message} La liste reste disponible.`
      : 'Impossible de charger les rayons 3D (connexion requise la première fois).' }));
  }
}

$('view-toggle').addEventListener('click', () => {
  state.view = state.view === 'rayons' ? 'liste' : 'rayons';
  try { localStorage.setItem(VIEW_KEY, state.view); } catch { /* préférence non critique */ }
  renderList();
});

$('filter-shelf').addEventListener('change', (e) => { state.shelf = e.target.value; renderFilters(); renderList(); });
$('filter-genre').addEventListener('change', (e) => { state.genre = e.target.value; renderList(); });
$('filter-status').addEventListener('change', (e) => { state.status = e.target.value; renderList(); });

/* ---------- Formulaire d'ajout / modification ---------- */

const form = $('item-form');
const dialog = $('item-dialog');
const f = form.elements; // form.title désignerait l'attribut title du formulaire, pas le champ
let editing = null;

function syncFormVisibility() {
  const shelves = catById(f.categoryId.value)?.shelves ?? [];
  const current = f.shelf.value;
  f.shelf.replaceChildren(el('option', { value: '', textContent: 'Aucune' }),
    ...shelves.map((s) => el('option', { value: s, textContent: s, selected: s === current })));
  $('f-shelf-wrap').hidden = shelves.length === 0;
  $('f-link-wrap').hidden = f.format.value !== 'numerique';
  // Libellés du statut selon la catégorie (Lu, Vu, Joué…), valeur choisie conservée.
  const status = f.status.value;
  f.status.replaceChildren(el('option', { value: '', textContent: 'Sans statut' }),
    ...STATUSES.map((v) => el('option', { value: v, textContent: statusLabel(v, f.categoryId.value) })));
  f.status.value = status;
  $('f-finished-wrap').hidden = f.status.value !== 'termine';
}

// Données venues d'une recherche en ligne, gardées jusqu'à l'enregistrement.
let extras = {};
let sourceGenres = [];

function renderGenreSuggest() {
  const fold = (g) => g.toLocaleLowerCase('fr');
  const chosen = parseList(f.genres.value).map(fold);
  const known = listGenres(state.items.filter((i) => !i.deleted));
  const fresh = sourceGenres.filter((g) => !known.some((k) => fold(k) === fold(g)));
  $('genre-suggest').replaceChildren(...[...fresh, ...known].map((g) => {
    const b = el('button', { type: 'button', textContent: g, className: fresh.includes(g) ? 'from-source' : '' });
    b.setAttribute('aria-pressed', String(chosen.includes(g.toLocaleLowerCase('fr'))));
    b.addEventListener('click', () => {
      const list = parseList(f.genres.value);
      const i = list.findIndex((x) => x.toLocaleLowerCase('fr') === g.toLocaleLowerCase('fr'));
      if (i >= 0) list.splice(i, 1); else list.push(g);
      f.genres.value = list.join(', ');
      renderGenreSuggest();
    });
    return b;
  }));
}

/* Recherche en ligne */

const KEY_PREFIX = 'collections:key-';
function getKey(name) {
  try { return localStorage.getItem(KEY_PREFIX + name) ?? ''; } catch { return ''; }
}

const sourceFor = (categoryId) => SOURCES[SOURCE_BY_CATEGORY[categoryId]];
let searchSeq = 0;

function renderExtras() {
  const cover = safeCover(extras.cover);
  $('f-cover').hidden = !cover;
  $('remove-cover').hidden = !cover;
  if (cover) $('f-cover').src = cover; else $('f-cover').removeAttribute('src');
  $('cover-pick-text').textContent = cover ? "Changer l'image…" : 'Ajouter une image de couverture…';
  const tracks = extras.tracks ?? [];
  $('f-tracks').hidden = tracks.length === 0;
  $('f-tracks').querySelector('summary').textContent = `Tracklist (${plural(tracks.length, 'titre')})`;
  $('f-tracks').querySelector('ol').replaceChildren(
    ...tracks.map((t) => el('li', { textContent: t.length ? `${t.title} — ${t.length}` : t.title })));
}

function resetSearch() {
  searchSeq += 1;
  $('search-results').replaceChildren();
  $('search-status').textContent = '';
  const src = sourceFor(f.categoryId.value);
  $('search-wrap').hidden = !src;
  // Le scan ne sert que là où un code-barres identifie l'objet : livres (ISBN) et disques.
  $('scan-btn').hidden = src !== SOURCES.openlibrary && src !== SOURCES.musicbrainz;
}

function sourceCredit(src) {
  return el('li', { className: 'muted small source-credit' }, 'Source : ',
    el('a', { href: src.url, target: '_blank', rel: 'noopener', textContent: src.label }));
}

async function runSearch() {
  const src = sourceFor(f.categoryId.value);
  const q = f.title.value.trim();
  if (!src) return;
  if (!q) { $('search-status').textContent = "Tape d'abord un titre."; return; }
  const key = src.keyName ? getKey(src.keyName) : '';
  if (src.keyName && !key) {
    $('search-status').textContent = `Ajoute ta clé ${src.label} dans Réglages pour chercher ici.`;
    return;
  }
  await searchWith(src, key, () => src.search(q, key), { emptyMsg: 'Aucun résultat. Essaie un autre titre.' });
}

// Lance une recherche et affiche ses résultats. autoPick : un seul objet trouvé (même œuvre) → choisi d'office.
async function searchWith(src, key, fetchResults, { emptyMsg, autoPick = false, pending = 'Recherche…' }) {
  const seq = ++searchSeq;
  $('search-status').textContent = pending;
  $('search-results').replaceChildren();
  try {
    const results = await fetchResults();
    if (seq !== searchSeq) return; // une recherche plus récente a été lancée
    if (autoPick && results.length > 0 && results.every((r) => r.ref === results[0].ref)) {
      await pickResult(src, results[0], key);
      return;
    }
    $('search-status').textContent = results.length ? 'Touche le bon résultat :' : emptyMsg;
    $('search-results').replaceChildren(...results.map((r) => {
      const meta = [r.creators.join(', '), r.year, r.kind].filter(Boolean).join(' · ');
      const b = el('button', { type: 'button', className: 'result' },
        coverEl({ id: r.ref, title: r.title, cover: r.cover }),
        el('span', { className: 'info' },
          el('span', { className: 'title', textContent: r.title }),
          meta ? el('span', { className: 'meta', textContent: meta }) : ''));
      b.addEventListener('click', () => pickResult(src, r, key));
      return el('li', {}, b);
    }), sourceCredit(src));
  } catch (err) {
    if (seq === searchSeq) $('search-status').textContent = err instanceof SourceError ? err.message : `Erreur : ${err.message}`;
  }
}

// Remplit le formulaire : à l'ajout, le titre prend celui de la source ; sinon seuls les champs vides
// sont complétés. Les genres de la source sont proposés, pas imposés.
async function pickResult(src, r, key) {
  const seq = ++searchSeq;
  $('search-status').textContent = 'Récupération des détails…';
  let details = {};
  try {
    if (src.details) details = await src.details(r, key);
  } catch (err) {
    if (seq !== searchSeq) return;
    $('search-status').textContent = `Détails indisponibles (${err.message}) : infos de base remplies.`;
  }
  if (seq !== searchSeq) return;
  const creators = details.creators?.length ? details.creators : r.creators;
  if (!editing || !f.title.value.trim()) f.title.value = r.title;
  if (!f.creators.value.trim() && creators.length) f.creators.value = creators.join(', ');
  if (!f.year.value.trim() && r.year) f.year.value = r.year;
  if (!extras.cover && r.cover) extras.cover = r.cover;
  if (!extras.tracks?.length && details.tracks?.length) extras.tracks = details.tracks;
  extras.source = { id: r.source, ref: r.ref };
  sourceGenres = parseList([...(details.genres ?? []), ...r.genres].join(','));
  $('search-results').replaceChildren(sourceCredit(src));
  if (!/indisponibles/.test($('search-status').textContent)) {
    $('search-status').textContent = sourceGenres.length
      ? `Infos remplies depuis ${src.label}. Touche les genres proposés (en pointillés) pour les ajouter.`
      : `Infos remplies depuis ${src.label}.`;
  }
  renderExtras();
  renderGenreSuggest();
}

$('search-btn').addEventListener('click', runSearch);

/* Scan de code-barres */

// Safari iOS n'a pas BarcodeDetector : ponyfill (zxing-wasm, ≈ 1 Mo) chargé au premier scan, version épinglée.
const BARCODE_LIB = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.2.3/pure/+esm';
const SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
let stopScan = null;

// Ouvre la caméra arrière et renvoie le premier code lu, ou null si l'utilisateur annule.
async function scanBarcode() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Caméra indisponible ici : le scan demande une adresse https (ou localhost sur PC).');
  }
  const d = $('scan-dialog');
  const video = $('scan-video');
  $('scan-status').textContent = 'Préparation du lecteur…';
  d.showModal();
  let stream;
  let timer;
  let done;
  const result = new Promise((resolve) => { done = resolve; });
  stopScan = (code) => {
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    stopScan = null;
    if (d.open) d.close();
    done(code);
  };
  try {
    const { BarcodeDetector } = await import(BARCODE_LIB);
    const detector = new BarcodeDetector({ formats: SCAN_FORMATS });
    if (!stopScan) return result; // annulé pendant le chargement : ne pas allumer la caméra
    stream =await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (!stopScan) { stream.getTracks().forEach((t) => t.stop()); return result; } // annulé pendant le chargement
    video.srcObject = stream;
    await video.play();
    $('scan-status').textContent = 'Place le code-barres dans le cadre, bien éclairé.';
    const tick = async () => {
      if (!stopScan) return;
      try {
        const [hit] = await detector.detect(video);
        if (hit?.rawValue) { stopScan(hit.rawValue); return; }
      } catch { /* image pas encore prête : on réessaie */ }
      timer = setTimeout(tick, 200);
    };
    tick();
  } catch (err) {
    if (!stopScan) return result; // déjà arrêté par « Annuler » : l'erreur vient de l'interruption, on l'ignore
    stopScan(null);
    throw err.name === 'NotAllowedError'
      ? new Error("Accès à la caméra refusé. Autorise-le dans les réglages du navigateur pour scanner.")
      : err.name === 'NotFoundError' ? new Error('Aucune caméra trouvée sur cet appareil.') : err;
  }
  return result;
}
$('scan-cancel').addEventListener('click', () => stopScan?.(null));
$('scan-dialog').addEventListener('cancel', (e) => { e.preventDefault(); stopScan?.(null); });

// ISBN → livre (Open Library, édition exacte) ; autre code → disque (MusicBrainz).
// La catégorie du formulaire suit le type de code lu, si cette catégorie existe encore.
async function lookupCode(code) {
  const isbn = normalizeIsbn(code);
  const target = isbn ? 'livres' : 'musique';
  if (f.categoryId.value !== target && catById(target)) {
    f.categoryId.value = target;
    syncFormVisibility();
  }
  resetSearch();
  const src = isbn ? SOURCES.openlibrary : SOURCES.musicbrainz;
  await searchWith(src, '', () => (isbn ? src.search(isbn) : src.byBarcode(code)), {
    autoPick: true,
    pending: `Code ${code} : recherche…`,
    emptyMsg: `Aucun résultat pour le code ${code}. Tape le titre puis « Rechercher en ligne ».`,
  });
}

$('scan-btn').addEventListener('click', async () => {
  try {
    const code = await scanBarcode();
    if (code) await lookupCode(code);
  } catch (err) {
    $('search-status').textContent = err instanceof SourceError ? err.message : `Scan impossible : ${err.message}`;
  }
});
$('remove-cover').addEventListener('click', () => { extras.cover = undefined; renderExtras(); });

// Image choisie sur l'appareil (photo, capture, fichier) : réduite à 400 px de côté et stockée dans la
// fiche en JPEG (≈ 30 Ko), donc incluse dans l'export JSON. Fond blanc pour les PNG transparents.
async function imageToDataUrl(file, max = 400) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = el('canvas', { width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

$('cover-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // permet de rechoisir le même fichier
  if (!file) return;
  try {
    extras.cover = await imageToDataUrl(file);
    $('item-error').textContent = '';
    renderExtras();
  } catch {
    $('item-error').textContent = 'Impossible de lire cette image. Essaie une photo ou un fichier JPEG ou PNG.';
  }
});
f.categoryId.addEventListener('change', resetSearch);

function openForm(item = null) {
  editing = item;
  form.reset();
  extras = { cover: item?.cover, tracks: item?.tracks, source: item?.source };
  sourceGenres = [];
  renderExtras();
  $('item-error').textContent = '';
  $('item-title').textContent = item ? 'Modifier' : 'Ajouter';
  $('delete-item').hidden = !item;
  f.categoryId.replaceChildren(...state.categories.map((c) => el('option', { value: c.id, textContent: c.name })));
  f.categoryId.value = item?.categoryId ?? (state.categoryId !== 'tout' ? state.categoryId : state.categories[0]?.id);
  syncFormVisibility();
  f.shelf.value = item?.shelf ?? state.shelf;
  f.title.value = item?.title ?? '';
  f.creators.value = item?.creators?.join(', ') ?? '';
  f.year.value = item?.year ?? '';
  f.genres.value = item?.genres?.join(', ') ?? '';
  f.format.value = item?.format ?? 'physique';
  f.link.value = item?.link ?? '';
  syncFormVisibility();
  f.status.value = item?.status ?? '';
  f.finishedAt.value = item?.finishedAt ?? '';
  syncFormVisibility();
  resetSearch();
  renderGenreSuggest();
  dialog.showModal();
}

async function saveItem(record) {
  await putMany({ items: [record] });
  const i = state.items.findIndex((x) => x.id === record.id);
  if (i >= 0) state.items[i] = record; else state.items.push(record);
  dialog.close();
  render();
}

f.categoryId.addEventListener('change', syncFormVisibility);
form.addEventListener('change', (e) => { if (e.target.name === 'format' || e.target.name === 'status') syncFormVisibility(); });
f.genres.addEventListener('input', renderGenreSuggest);
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const fields = Object.fromEntries(new FormData(form));
    const knownGenres = listGenres(state.items.filter((i) => !i.deleted && i.id !== editing?.id));
    const record = buildItem({ link: '', shelf: '', ...fields }, editing ?? undefined, { knownGenres });
    await saveItem({ ...record, cover: extras.cover, tracks: extras.tracks, source: extras.source });
  } catch (err) {
    $('item-error').textContent = err.message;
  }
});
// Pas de confirmation pour un objet : le bandeau d'annulation protège mieux qu'un « OK » touché par réflexe.
$('delete-item').addEventListener('click', async () => {
  if (!editing) return;
  const before = editing;
  try {
    await saveItem({ ...before, deleted: true, updatedAt: Date.now() });
    offerUndo(`« ${before.title} » supprimé`, { categories: [], items: [before] });
  } catch (err) {
    $('item-error').textContent = err.message;
  }
});
$('add').addEventListener('click', () => openForm());

/* ---------- Sauvegarde ---------- */

const backup = $('backup');
const status = $('backup-status');
const LAST_EXPORT_KEY = 'collections:last-export';

// Préférence d'affichage propre à l'appareil : sa perte n'a pas de conséquence.
function showLastExport() {
  let iso = null;
  try { iso = localStorage.getItem(LAST_EXPORT_KEY); } catch { /* stockage indisponible */ }
  $('last-export').textContent = iso
    ? `Dernier export depuis cet appareil : ${new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}.`
    : 'Aucun export depuis cet appareil.';
}

async function exportData() {
  const data = {};
  for (const s of STORES) data[s] = await getAll(s);
  const payload = buildExport(data);
  const name = `collections-${payload.exportedAt.slice(0, 10)}.json`;
  const file = new File([JSON.stringify(payload, null, 2)], name, { type: 'application/json' });

  // Sur iPhone, la feuille de partage propose « Enregistrer dans Fichiers » → iCloud Drive. Sur PC, simple téléchargement.
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (err) {
      if (err.name === 'AbortError') return;
      throw err;
    }
  } else {
    const a = el('a', { href: URL.createObjectURL(file), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  try { localStorage.setItem(LAST_EXPORT_KEY, payload.exportedAt); } catch { /* préférence non critique */ }
  showLastExport();
  const alive = (s) => data[s].filter((r) => !r.deleted).length;
  status.textContent = `Export prêt : ${alive('items')} objet(s), ${alive('categories')} catégorie(s).`;
}

async function importFile(file) {
  const incoming = parseImport(await file.text());
  const writes = {};
  let added = 0, updated = 0, unchanged = 0;
  for (const s of STORES) {
    const plan = planMerge(await getAll(s), incoming[s]);
    writes[s] = [...plan.added, ...plan.updated];
    added += plan.added.length;
    updated += plan.updated.length;
    unchanged += plan.unchanged;
  }
  if (added + updated === 0) {
    status.textContent = `Rien à importer : les ${unchanged} fiche(s) du fichier sont déjà à jour ici.`;
    return;
  }
  const ok = confirm(`Importer « ${file.name} » ?\n\n${added} nouvelle(s) fiche(s)\n${updated} fiche(s) remplacée(s) par une version plus récente\n${unchanged} fiche(s) déjà à jour`);
  if (!ok) { status.textContent = 'Import annulé.'; return; }
  await putMany(writes);
  status.textContent = `Import terminé : ${added} ajoutée(s), ${updated} mise(s) à jour.`;
  await load();
  render();
}

async function importGoodreads(file) {
  const { items, skipped } = fromGoodreads(parseCsv(await file.text()), await getAll('items'));
  if (!items.length) {
    status.textContent = `Rien à importer : les ${skipped} livre(s) du fichier sont déjà dans ta collection.`;
    return;
  }
  const ok = confirm(`Importer ${items.length} livre(s) depuis Goodreads dans Livres ?${skipped ? `

${skipped} livre(s) déjà présent(s) seront ignorés.` : ''}`);
  if (!ok) { status.textContent = 'Import annulé.'; return; }
  await putMany({ items });
  status.textContent = `Import Goodreads terminé : ${items.length} livre(s) ajouté(s)${skipped ? `, ${skipped} déjà présent(s)` : ''}.`;
  await load();
  render();
}

function report(action) {
  return (...args) => action(...args).catch((err) => {
    console.error(err);
    status.textContent = `Erreur : ${err.message}`;
  });
}

$('open-backup').addEventListener('click', () => {
  status.textContent = '';
  showLastExport();
  for (const name of ['tmdb', 'rawg']) $(`key-${name}`).value = getKey(name);
  backup.showModal();
});
// Clés propres à l'appareil, hors export : localStorage suffit.
for (const name of ['tmdb', 'rawg']) {
  $(`key-${name}`).addEventListener('change', (e) => {
    try { localStorage.setItem(KEY_PREFIX + name, e.target.value.trim()); } catch { alert("Impossible d'enregistrer la clé sur cet appareil."); }
  });
}
$('export').addEventListener('click', report(exportData));
$('import').addEventListener('change', report(async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // permet de réimporter le même fichier
  if (file) await importFile(file);
}));

$('import-goodreads').addEventListener('change', report(async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) await importGoodreads(file);
}));

/* ---------- Démarrage ---------- */

function showFatal(err) {
  console.error(err);
  alert(`Erreur : ${err.message}`);
}

try {
  await seedDefaults();
  await load();
  render();
} catch (err) {
  showFatal(err);
}
navigator.storage?.persist?.();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.error('Service worker :', err));
}
