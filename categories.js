// Logique pure de gestion des catégories et étagères (testée avec node --test).
// Chaque opération renvoie { categories, items } : les fiches à réécrire, prêtes pour putMany.

const fold = (s) => s.toLocaleLowerCase('fr');
export const cleanName = (raw) => String(raw ?? '').trim().replace(/\s+/g, ' ');

export const byOrder = (categories) => categories.filter((c) => !c.deleted).sort((a, b) => a.order - b.order);

export function checkCategoryName(raw, categories, exceptId) {
  const name = cleanName(raw);
  if (!name) throw new Error('Le nom ne peut pas être vide.');
  if (categories.some((c) => !c.deleted && c.id !== exceptId && fold(c.name) === fold(name))) {
    throw new Error(`La catégorie « ${name} » existe déjà.`);
  }
  return name;
}

function checkShelfName(raw, category, except) {
  const name = cleanName(raw);
  if (!name) throw new Error("Le nom de l'étagère ne peut pas être vide.");
  if ((category.shelves ?? []).some((s) => s !== except && fold(s) === fold(name))) {
    throw new Error(`L'étagère « ${name} » existe déjà dans ${category.name}.`);
  }
  return name;
}

// Avertissements non bloquants : le même nom à deux niveaux est permis (transition, choix voulu),
// mais on prévient pour éviter de ranger la même chose à deux endroits.
// Comparaison tolérante, réservée aux avertissements : sans accents ni s/x final de chaque mot
// (« Vinyles » ≈ « Vinyle », « Jeux video » ≈ « Jeu vidéo »). Quelques fausses alertes, sans conséquence.
export const loose = (s) => fold(cleanName(s)).normalize('NFD').replace(/\p{M}/gu, '')
  .split(' ').map((w) => (w.length > 2 ? w.replace(/[sx]$/, '') : w)).join(' ');

export function categoryClash(raw, categories, exceptId) {
  const key = loose(raw);
  const hits = categories
    .filter((c) => !c.deleted && c.id !== exceptId)
    .flatMap((c) => (c.shelves ?? []).filter((s) => loose(s) === key).map((s) => ({ cat: c.name, shelf: s })));
  if (hits.length === 0) return null;
  if (hits.length === 1) return `${hits[0].cat} a déjà une étagère « ${hits[0].shelf} ».`;
  return `Ces catégories ont déjà une étagère proche : ${hits.map((h) => `${h.cat} (« ${h.shelf} »)`).join(', ')}.`;
}

export function shelfClash(raw, categories, categoryId) {
  const key = loose(raw);
  const cat = categories.find((c) => !c.deleted && c.id !== categoryId && loose(c.name) === key);
  return cat ? `Une catégorie « ${cat.name} » existe déjà.` : null;
}

// Échange une catégorie avec sa voisine (delta -1 ou +1) et renumérote 1..n.
export function moveCategory(categories, id, delta, now) {
  const list = byOrder(categories);
  const i = list.findIndex((c) => c.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return { categories: [], items: [] };
  [list[i], list[j]] = [list[j], list[i]];
  const changed = list
    .map((c, k) => ({ c, order: k + 1 }))
    .filter(({ c, order }) => c.order !== order)
    .map(({ c, order }) => ({ ...c, order, updatedAt: now }));
  return { categories: changed, items: [] };
}

export function renameCategory(categories, id, raw, now) {
  const cat = categories.find((c) => c.id === id);
  const name = checkCategoryName(raw, categories, id);
  return { categories: name === cat.name ? [] : [{ ...cat, name, updatedAt: now }], items: [] };
}

const alive = (items, categoryId) => items.filter((i) => !i.deleted && i.categoryId === categoryId);

// Supprime la catégorie et ses objets (marquage, pour que la synchro les supprime aussi ailleurs).
export function deleteCategory(category, items, now) {
  return {
    categories: [{ ...category, deleted: true, updatedAt: now }],
    items: alive(items, category.id).map((i) => ({ ...i, deleted: true, updatedAt: now })),
  };
}

export function addShelf(category, raw, now) {
  const name = checkShelfName(raw, category);
  return { categories: [{ ...category, shelves: [...(category.shelves ?? []), name], updatedAt: now }], items: [] };
}

// Renomme l'étagère partout : dans la catégorie et dans les objets rangés dessus.
export function renameShelf(category, items, oldName, raw, now) {
  const name = checkShelfName(raw, category, oldName);
  if (name === oldName) return { categories: [], items: [] };
  return {
    categories: [{ ...category, shelves: category.shelves.map((s) => (s === oldName ? name : s)), updatedAt: now }],
    items: alive(items, category.id).filter((i) => i.shelf === oldName).map((i) => ({ ...i, shelf: name, updatedAt: now })),
  };
}

// Retire l'étagère ; ses objets restent dans la catégorie, sans étagère.
export function removeShelf(category, items, shelfName, now) {
  return {
    categories: [{ ...category, shelves: category.shelves.filter((s) => s !== shelfName), updatedAt: now }],
    items: alive(items, category.id).filter((i) => i.shelf === shelfName).map((i) => ({ ...i, shelf: undefined, updatedAt: now })),
  };
}
