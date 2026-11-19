import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addShelf, checkCategoryName, deleteCategory, moveCategory, removeShelf, renameCategory, renameShelf,
} from '../categories.js';

const cats = [
  { id: 'livres', name: 'Livres', order: 1, shelves: ['Romans', 'BD'], updatedAt: 0 },
  { id: 'films', name: 'Films', order: 2, updatedAt: 0 },
  { id: 'vieux', name: 'Vieux', order: 3, deleted: true, updatedAt: 5 },
  { id: 'musique', name: 'Musique', order: 4, updatedAt: 0 },
];
const items = [
  { id: 'a', categoryId: 'livres', shelf: 'BD', title: 'Tintin', updatedAt: 1 },
  { id: 'b', categoryId: 'livres', shelf: 'Romans', title: 'Dune', updatedAt: 1 },
  { id: 'c', categoryId: 'livres', shelf: 'BD', title: 'Astérix', deleted: true, updatedAt: 1 },
  { id: 'd', categoryId: 'films', title: 'Alien', updatedAt: 1 },
];

test('noms de catégorie : vide et doublon refusés, casse ignorée, supprimées ignorées', () => {
  assert.equal(checkCategoryName('  Jeux   de société ', cats), 'Jeux de société');
  assert.throws(() => checkCategoryName(' ', cats), /vide/);
  assert.throws(() => checkCategoryName('films', cats), /existe déjà/);
  assert.equal(checkCategoryName('Vieux', cats), 'Vieux');
  assert.equal(renameCategory(cats, 'films', 'FILMS', 9).categories[0].name, 'FILMS');
  assert.deepEqual(renameCategory(cats, 'films', 'Films', 9).categories, []);
});

test('déplacer une catégorie renumérote sans trou ni doublon', () => {
  const { categories } = moveCategory(cats, 'musique', -1, 9);
  assert.deepEqual(categories.map((c) => [c.id, c.order]), [['musique', 2], ['films', 3]]);
  assert.deepEqual(moveCategory(cats, 'livres', -1, 9).categories, []);
});

test('supprimer une catégorie marque aussi ses objets', () => {
  const r = deleteCategory(cats[0], items, 9);
  assert.equal(r.categories[0].deleted, true);
  assert.deepEqual(r.items.map((i) => [i.id, i.deleted, i.updatedAt]), [['a', true, 9], ['b', true, 9]]);
});

test('étagères : ajout, renommage propagé, suppression qui libère les objets', () => {
  assert.deepEqual(addShelf(cats[0], ' Mangas ', 9).categories[0].shelves, ['Romans', 'BD', 'Mangas']);
  assert.throws(() => addShelf(cats[0], 'bd', 9), /existe déjà/);
  const ren = renameShelf(cats[0], items, 'BD', 'Bandes dessinées', 9);
  assert.deepEqual(ren.categories[0].shelves, ['Romans', 'Bandes dessinées']);
  assert.deepEqual(ren.items.map((i) => [i.id, i.shelf]), [['a', 'Bandes dessinées']]);
  assert.deepEqual(renameShelf(cats[0], items, 'BD', 'bd', 9).items.map((i) => i.shelf), ['bd']);
  const rem = removeShelf(cats[0], items, 'BD', 9);
  assert.deepEqual(rem.categories[0].shelves, ['Romans']);
  assert.deepEqual(rem.items.map((i) => [i.id, i.shelf]), [['a', undefined]]);
});
