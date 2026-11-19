import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildItem, filterItems, listGenres, parseList, safeLink } from '../items.js';

const fields = (over = {}) => ({
  categoryId: 'livres', shelf: 'Romans', title: 'Dune', creators: 'Frank Herbert', year: '1965',
  genres: 'SF', format: 'physique', link: '', ...over,
});

test('parseList nettoie, dédoublonne et garde la première orthographe', () => {
  assert.deepEqual(parseList(' SF,  space   opera , sf,,'), ['SF', 'space opera']);
  assert.deepEqual(parseList(''), []);
});

test('safeLink ne garde que le https', () => {
  assert.equal(safeLink('https://www.icloud.com/iclouddrive/abc#Dune'), 'https://www.icloud.com/iclouddrive/abc#Dune');
  assert.equal(safeLink('javascript:alert(1)'), null);
  assert.equal(safeLink('http://exemple.fr'), null);
  assert.equal(safeLink('pas un lien'), null);
});

test('buildItem crée puis modifie une fiche', () => {
  const a = buildItem(fields(), undefined, { now: 100 });
  assert.equal(a.title, 'Dune');
  assert.equal(a.year, 1965);
  assert.deepEqual(a.creators, ['Frank Herbert']);
  assert.equal(a.createdAt, 100);
  const b = buildItem(fields({ title: ' Dune (poche) ', year: '' }), { ...a, cover: 'x.jpg' }, { now: 200 });
  assert.equal(b.id, a.id);
  assert.equal(b.title, 'Dune (poche)');
  assert.equal(b.year, undefined);
  assert.equal(b.createdAt, 100);
  assert.equal(b.updatedAt, 200);
  assert.equal(b.cover, 'x.jpg');
});

test('buildItem : lien seulement pour le numérique, et validé', () => {
  assert.equal(buildItem(fields({ link: 'https://www.icloud.com/x' })).link, undefined);
  assert.equal(buildItem(fields({ format: 'numerique', link: 'https://www.icloud.com/x' })).link, 'https://www.icloud.com/x');
  assert.throws(() => buildItem(fields({ format: 'numerique', link: 'file:///C:/livre.epub' })), /https/);
});

test('buildItem reprend l\'orthographe des genres déjà utilisés', () => {
  assert.deepEqual(buildItem(fields({ genres: 'sf, Horreur' }), undefined, { knownGenres: ['SF'] }).genres, ['SF', 'Horreur']);
});

test('buildItem refuse un titre vide ou une année invalide', () => {
  assert.throws(() => buildItem(fields({ title: '  ' })), /titre/);
  assert.throws(() => buildItem(fields({ year: '19a5' })), /année/);
  assert.throws(() => buildItem(fields({ year: '1965.5' })), /année/);
});

test('filtres par catégorie, étagère et genre ; tri par titre ; fiches supprimées masquées', () => {
  const items = [
    { id: '1', categoryId: 'livres', shelf: 'BD', title: 'Tintin 10', genres: ['Aventure'] },
    { id: '2', categoryId: 'livres', shelf: 'BD', title: 'Tintin 2', genres: ['aventure'] },
    { id: '3', categoryId: 'films', title: 'Alien', genres: ['SF'] },
    { id: '4', categoryId: 'livres', shelf: 'Romans', title: 'Dune', genres: ['SF'], deleted: true },
  ];
  assert.deepEqual(filterItems(items).map((i) => i.id), ['3', '2', '1']);
  assert.deepEqual(filterItems(items, { categoryId: 'livres', shelf: 'BD', genre: 'AVENTURE' }).map((i) => i.id), ['2', '1']);
  assert.deepEqual(filterItems(items, { genre: 'SF' }).map((i) => i.id), ['3']);
  assert.deepEqual(listGenres(items.filter((i) => !i.deleted)), ['Aventure', 'SF']);
});
