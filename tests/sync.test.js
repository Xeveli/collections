import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExport, parseImport, planMerge } from '../sync.js';

const item = (id, updatedAt, extra = {}) => ({ id, updatedAt, ...extra });

test("un export se réimporte à l'identique", () => {
  const data = { categories: [item('livres', 0, { name: 'Livres' })], items: [item('a', 5, { title: 'Dune' })] };
  const parsed = parseImport(JSON.stringify(buildExport(data, new Date('2026-11-19T10:00:00Z'))));
  assert.deepEqual(parsed, data);
});

test('la fusion garde la fiche la plus récente', () => {
  const local = [item('a', 10, { title: 'local' }), item('b', 10), item('c', 10)];
  const incoming = [item('a', 20, { title: 'distant' }), item('b', 5), item('c', 10), item('d', 1)];
  const plan = planMerge(local, incoming);
  assert.deepEqual(plan.updated.map((r) => r.title), ['distant']);
  assert.deepEqual(plan.added.map((r) => r.id), ['d']);
  assert.equal(plan.unchanged, 2);
});

test('une suppression plus récente se propage', () => {
  const plan = planMerge([item('a', 10)], [item('a', 11, { deleted: true })]);
  assert.equal(plan.updated[0].deleted, true);
});

test('les fichiers invalides sont refusés', () => {
  const ok = buildExport({ categories: [], items: [] });
  assert.throws(() => parseImport('pas du json'), /JSON valide/);
  assert.throws(() => parseImport(JSON.stringify({ ...ok, format: 'autre' })), /export de Collections/);
  assert.throws(() => parseImport(JSON.stringify({ ...ok, version: 99 })), /plus récente/);
  assert.throws(() => parseImport(JSON.stringify({ ...ok, items: [{ id: 'x' }] })), /items/);
  assert.throws(() => parseImport(JSON.stringify({ ...ok, categories: null })), /categories/);
});
