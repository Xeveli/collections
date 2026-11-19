import { getAll, putMany, seedDefaults } from './db.js';
import { buildExport, parseImport, planMerge, STORES } from './sync.js';
import { FORMATS, buildItem, filterItems, listGenres, newId, parseList, safeLink } from './items.js';
import {
  addShelf, byOrder, checkCategoryName, deleteCategory, moveCategory, removeShelf, renameCategory, renameShelf,
} from './categories.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

// Tout le texte saisi ou importé passe par textContent / append : jamais par innerHTML.
const state = { categoryId: 'tout', shelf: '', genre: '', categories: [], items: [] };

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

function addCategory() {
  const raw = prompt('Nom de la nouvelle catégorie :');
  if (raw === null) return;
  apply((now) => {
    const name = checkCategoryName(raw, state.categories);
    const order = Math.max(0, ...state.categories.map((c) => c.order)) + 1;
    return { categories: [{ id: newId(), name, order, updatedAt: now }], items: [] };
  });
}

function editShelf(cat, shelf) {
  const raw = prompt(`Renommer l'étagère « ${shelf} » (laisse vide pour la supprimer) :`, shelf);
  if (raw === null) return;
  if (raw.trim()) {
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
    name.addEventListener('change', () => apply((now) => renameCategory(state.categories, cat.id, name.value, now)));

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
    addS.addEventListener('click', () => {
      const raw = prompt(`Nom de la nouvelle étagère dans ${cat.name} :`);
      if (raw !== null) apply((now) => addShelf(cat, raw, now));
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

function itemRow(item) {
  const cat = catById(item.categoryId);
  const meta = [item.creators?.join(', '), item.year, state.categoryId === 'tout' ? cat?.name : null, item.shelf]
    .filter(Boolean).join(' · ');
  const open = el('button', { type: 'button', className: 'item' },
    el('span', { className: spineClass(item.id), textContent: item.title.charAt(0).toUpperCase(), ariaHidden: 'true' }),
    el('span', { className: 'info' },
      el('span', { className: 'title', textContent: item.title }),
      meta ? el('span', { className: 'meta', textContent: meta }) : '',
      item.genres?.length ? el('span', { className: 'tags' }, ...item.genres.map((g) => el('span', { textContent: g }))) : ''),
    el('span', { className: `badge ${item.format}`, textContent: FORMATS[item.format] ?? FORMATS.physique }));
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
  $('no-match').textContent = state.shelf || state.genre
    ? 'Aucun objet ne correspond à ces filtres.'
    : 'Rien dans cette catégorie pour l\'instant.';
  $('count').textContent = `${list.length} objet${list.length > 1 ? 's' : ''}`;
}

$('filter-shelf').addEventListener('change', (e) => { state.shelf = e.target.value; renderFilters(); renderList(); });
$('filter-genre').addEventListener('change', (e) => { state.genre = e.target.value; renderList(); });

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
}

function renderGenreSuggest() {
  const chosen = parseList(f.genres.value).map((g) => g.toLocaleLowerCase('fr'));
  const genres = listGenres(state.items.filter((i) => !i.deleted));
  $('genre-suggest').replaceChildren(...genres.map((g) => {
    const b = el('button', { type: 'button', textContent: g });
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

function openForm(item = null) {
  editing = item;
  form.reset();
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
form.addEventListener('change', (e) => { if (e.target.name === 'format') syncFormVisibility(); });
f.genres.addEventListener('input', renderGenreSuggest);
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const fields = Object.fromEntries(new FormData(form));
    const knownGenres = listGenres(state.items.filter((i) => !i.deleted && i.id !== editing?.id));
    await saveItem(buildItem({ link: '', shelf: '', ...fields }, editing ?? undefined, { knownGenres }));
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

function report(action) {
  return (...args) => action(...args).catch((err) => {
    console.error(err);
    status.textContent = `Erreur : ${err.message}`;
  });
}

$('open-backup').addEventListener('click', () => {
  status.textContent = '';
  showLastExport();
  backup.showModal();
});
$('export').addEventListener('click', report(exportData));
$('import').addEventListener('change', report(async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // permet de réimporter le même fichier
  if (file) await importFile(file);
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
