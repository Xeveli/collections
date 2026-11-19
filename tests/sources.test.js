import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeIsbn, parseMbBarcode, parseMbDetails, parseMbSearch, parseOpenLibrary, parseRawgDetails, parseRawgSearch, parseTmdbDetails, parseTmdbSearch,
  pickSubjects,
} from '../sources.js';

// Extrait d'une vraie réponse Open Library (19/11/2026).
const OL = {
  docs: [{
    key: '/works/OL893414W', title: 'Dune', author_name: ['Frank Herbert'], first_publish_year: 1965, cover_i: 11481354,
    subject: ['Dune (Imaginary place)', 'Fiction', 'Fiction, science fiction, general', 'Science fiction', 'Science-fiction',
      'nyt:mass-market-monthly=2021-11-07', 'award:hugo_award=1966', 'science fiction', 'Ecology'],
  }, { key: '/works/OL2W', title: 'Sans auteur' }],
};

test('Open Library : champs, couverture, sujets triés', () => {
  const [dune, bare] = parseOpenLibrary(OL);
  assert.deepEqual(dune, {
    source: 'openlibrary', ref: '/works/OL893414W', title: 'Dune', creators: ['Frank Herbert'], year: 1965,
    cover: 'https://covers.openlibrary.org/b/id/11481354-M.jpg', genres: ['Fiction', 'Science fiction', 'Science-fiction', 'Ecology'],
  });
  assert.deepEqual([bare.creators, bare.cover, bare.genres], [[], undefined, []]);
  assert.equal(pickSubjects(undefined).length, 0);
});

// D'après une vraie réponse avec lang=fr (19/11/2026).
test('Open Library : titre et couverture de l\'édition française seulement', () => {
  const [fr, de] = parseOpenLibrary({ docs: [
    { key: '/works/F', title: 'Foundation', cover_i: 1, editions: { docs: [{ title: 'Fondation', cover_i: 14348589, language: ['fre'] }] } },
    { key: '/works/T', title: 'The Foundation Trilogy', cover_i: 2, editions: { docs: [{ title: 'Die Foundation-Trilogie', cover_i: 3, language: ['ger'] }] } },
  ] });
  assert.deepEqual([fr.title, fr.cover], ['Fondation', 'https://covers.openlibrary.org/b/id/14348589-M.jpg']);
  assert.deepEqual([de.title, de.cover], ['The Foundation Trilogy', 'https://covers.openlibrary.org/b/id/2-M.jpg']);
});

// Forme d'après une vraie réponse MusicBrainz (recherche) ; détails d'après la documentation.
test('MusicBrainz : recherche, genres triés, tracklist', () => {
  const [rg] = parseMbSearch({ 'release-groups': [{
    id: '5000a285-b67e-4cfc-b54b-2b98f1810d2e', title: 'Random Access Memories', 'first-release-date': '2013-05-17',
    'primary-type': 'Album', 'artist-credit': [{ name: 'Daft Punk', artist: { name: 'Daft Punk' } }],
  }] });
  assert.equal(rg.title, 'Random Access Memories');
  assert.deepEqual(rg.creators, ['Daft Punk']);
  assert.equal(rg.year, 2013);
  assert.equal(rg.cover, 'https://coverartarchive.org/release-group/5000a285-b67e-4cfc-b54b-2b98f1810d2e/front-250');
  const d = parseMbDetails(
    { genres: [{ name: 'disco', count: 3 }, { name: 'electronic', count: 9 }] },
    { releases: [{ media: [{ tracks: [{ title: 'Give Life Back to Music', length: 274000 }, { title: 'Sans durée' }] }] }] },
  );
  assert.deepEqual(d.genres, ['electronic', 'disco']);
  assert.deepEqual(d.tracks, [{ title: 'Give Life Back to Music', length: '4:34' }, { title: 'Sans durée', length: undefined }]);
  assert.deepEqual(parseMbDetails({}, {}), { genres: [], tracks: [] });
});

test('ISBN : ISBN-13 et ISBN-10 valides, clés de contrôle vérifiées', () => {
  assert.equal(normalizeIsbn('978-2-266-32048-1'), '9782266320481');
  assert.equal(normalizeIsbn('2266320483'), '9782266320481'); // ISBN-10 du même livre
  assert.equal(normalizeIsbn('0-8044-2957-X'), '9780804429573');
  assert.equal(normalizeIsbn('9782266320482'), null); // mauvaise clé
  assert.equal(normalizeIsbn('0888837168625'), null); // code-barres de disque
  assert.equal(normalizeIsbn('Dune'), null);
});

// D'après une vraie réponse Open Library à q=isbn:9782266320481 (sans langue sur l'édition).
test('Open Library par ISBN : édition exacte, même sans langue indiquée', () => {
  const [r] = parseOpenLibrary({ docs: [{ key: '/works/OL893414W', title: 'Dune', author_name: ['Frank Herbert'], first_publish_year: 1965, cover_i: 11481354,
    editions: { docs: [{ title: 'Dune - tome 1', cover_i: 13823878 }] } }] }, { exactEdition: true });
  assert.deepEqual([r.title, r.cover], ['Dune - tome 1', 'https://covers.openlibrary.org/b/id/13823878-M.jpg']);
});

// D'après une vraie réponse MusicBrainz à barcode:0888837168625 (19/11/2026).
test('MusicBrainz par code-barres : correspondance exacte, zéros de tête ignorés', () => {
  const rel = (id, barcode) => ({ id, barcode, title: 'Random Access Memories', date: '2013-05-20',
    'artist-credit': [{ name: 'Daft Punk' }], 'release-group': { id: 'aa997ea0', 'primary-type': 'Album' } });
  const res = parseMbBarcode({ releases: [rel('a', '888837168625'), rel('b', '196588010323'), rel('c', '0888837168625')] }, '0888837168625');
  assert.deepEqual(res.map((r) => r.release), ['a', 'c']);
  assert.deepEqual([res[0].ref, res[0].year, res[0].creators, res[0].kind], ['aa997ea0', 2013, ['Daft Punk'], 'Album']);
  assert.equal(parseMbBarcode({ releases: [rel('b', '196588010323')] }, '0888837168625').length, 1); // aucune exacte : on garde tout
  assert.deepEqual(parseMbDetails({}, { media: [{ tracks: [{ title: 'Contact', length: 381000 }] }] }).tracks, [{ title: 'Contact', length: '6:21' }]);
});

// TMDB et RAWG : formes d'après la documentation, à confirmer avec une vraie clé.
test('TMDB : films et séries', () => {
  const [film] = parseTmdbSearch({ results: [{ id: 348, title: 'Alien', release_date: '1979-05-25', poster_path: '/a.jpg' }] }, 'movie');
  assert.deepEqual(film, { source: 'tmdb-movie', ref: '348', title: 'Alien', creators: [], year: 1979, cover: 'https://image.tmdb.org/t/p/w342/a.jpg', genres: [] });
  const [serie] = parseTmdbSearch({ results: [{ id: 1, name: 'Dark', first_air_date: '' }] }, 'tv');
  assert.deepEqual([serie.source, serie.title, serie.year, serie.cover], ['tmdb-tv', 'Dark', undefined, undefined]);
  assert.deepEqual(parseTmdbDetails({ genres: [{ name: 'Horreur' }], credits: { crew: [{ job: 'Director', name: 'Ridley Scott' }, { job: 'Writer', name: 'X' }] } }, 'movie'),
    { creators: ['Ridley Scott'], genres: ['Horreur'] });
  assert.deepEqual(parseTmdbDetails({ created_by: [{ name: 'Baran bo Odar' }] }, 'tv').creators, ['Baran bo Odar']);
});

test('RAWG : jeux', () => {
  const [g] = parseRawgSearch({ results: [{ id: 22511, name: 'Zelda: BOTW', released: '2017-03-03', background_image: 'https://media.rawg.io/x.jpg', genres: [{ name: 'Action' }] }] });
  assert.deepEqual(g, { source: 'rawg', ref: '22511', title: 'Zelda: BOTW', creators: [], year: 2017, cover: 'https://media.rawg.io/x.jpg', genres: ['Action'] });
  assert.deepEqual(parseRawgDetails({ developers: [{ name: 'Nintendo' }] }), { creators: ['Nintendo'], genres: [] });
});
