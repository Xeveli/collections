import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromGoodreads, parseCsv } from '../goodreads.js';

// En-tête d'un vrai export Goodreads (19/11/2026) ; lignes inventées.
const HEAD = 'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies';
const CSV = `﻿${HEAD}
1,"Eragon (L'Héritage, #1)",Christopher Paolini,"Paolini, Christopher",Bertrand Ferrier,"=""2747014213""","=""9782747014212""",0,Bayard,Paperback,,2004,2002,2023/11/25,2023/10/23,,,read,"Avis ""cité""
sur deux lignes",,,1,0
2,Fondation,Isaac Asimov,"Asimov, Isaac",,"=""""","=""""",0,,Kindle Edition,,2009,1951,,2026/08/29,to-read,to-read (#1),to-read,,,,0,0
3,Dune,Frank Herbert,"Herbert, Frank",,,,0,,Hardcover,,,,,,currently-reading,,currently-reading,,,,0,0
`;

test('CSV : guillemets doublés, retour à la ligne dans un champ, BOM', () => {
  const rows = parseCsv(CSV);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].Title, "Eragon (L'Héritage, #1)");
  assert.equal(rows[0]['My Review'], 'Avis "cité"\nsur deux lignes');
  assert.equal(rows[0].ISBN13, '="9782747014212"');
});

test('Goodreads : statut, date de fin, support, couverture, auteurs', () => {
  const { items, skipped } = fromGoodreads(parseCsv(CSV), [], 1000);
  assert.equal(skipped, 0);
  const [eragon, fondation, dune] = items;
  assert.deepEqual(
    [eragon.id, eragon.status, eragon.finishedAt, eragon.format, eragon.year, eragon.creators],
    ['goodreads-1', 'termine', '2023-11-25', 'physique', 2002, ['Christopher Paolini']],
  );
  assert.equal(eragon.cover, 'https://covers.openlibrary.org/b/isbn/9782747014212-M.jpg?default=false');
  assert.equal(eragon.createdAt, Date.parse('2023-10-23T12:00:00Z'));
  assert.deepEqual([fondation.status, fondation.format, fondation.cover, fondation.finishedAt], ['a-decouvrir', 'numerique', undefined, undefined]);
  assert.deepEqual([dune.status, dune.year, dune.createdAt, dune.updatedAt], ['en-cours', undefined, 1000, 1000]);
});

test('Goodreads : un livre déjà présent (même id, ou même titre et auteur) est ignoré', () => {
  const existing = [
    { id: 'x', categoryId: 'livres', title: 'eragon', creators: ['Christopher Paolini'] }, // saisi à la main
    { id: 'goodreads-2', categoryId: 'livres', title: 'Autre titre', creators: [], deleted: true }, // supprimé : ne pas ressusciter
  ];
  const { items, skipped } = fromGoodreads(parseCsv(CSV), existing);
  assert.deepEqual(items.map((i) => i.title), ['Dune']);
  assert.equal(skipped, 2);
});

test("Goodreads : un autre CSV est refusé", () => {
  assert.throws(() => fromGoodreads(parseCsv('a,b\n1,2\n')), /export Goodreads/);
});
