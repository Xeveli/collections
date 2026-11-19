# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projet

Tracker personnel de collections (livres, films, séries, jeux vidéo, musique) qui remplace Goodreads. Il tourne en local, doit être joli et s'utilise sur iPhone comme sur PC. Un seul utilisateur. Langue de l'interface : français.

## Décisions de stack (validées)

- Web app statique en HTML, CSS et JavaScript, sans serveur ni backend. Modules ES natifs, **sans bundler ni étape de build** : le dépôt se sert tel quel.
- PWA installable sur l'écran d'accueil de l'iPhone : `manifest.webmanifest` et service worker pour le hors-ligne.
- Données dans le navigateur (IndexedDB). Export et import d'un fichier JSON que l'utilisateur range sur iCloud Drive : c'est la sauvegarde et la synchro PC/iPhone, déclenchées à la main.
- Hébergement sur GitHub Pages, dépôt **public**.
- Three.js (rayons en 3D) : prévu plus tard, **hors version 1**. Ne pas l'introduire avant.

## Périmètre de la version 1

- Catégories par défaut : livres (étagères romans, BD, mangas), films, séries, jeux vidéo, musique. Un bouton permet d'ajouter une catégorie.
- Ajout par titre ou par ISBN/code-barres (scan caméra). Infos, couverture et genre sont récupérés automatiquement :
  - Livres : Open Library. Google Books est écarté : sans clé, son quota quotidien est à 0 (vérifié le 19/11/2026).
  - Films et séries : TMDB.
  - Jeux vidéo : RAWG.
  - Musique : MusicBrainz (tracklist, artistes) et Cover Art Archive pour la pochette.
- Indicateur physique/numérique, choisi à l'ajout.
- Livre numérique : un simple lien vers le fichier EPUB/PDF sur iCloud. L'appli ne stocke aucun fichier.
- Genres modifiables à la main, filtres par catégorie et par genre, vue liste.
- Gestion des catégories (renommer, réordonner, supprimer) et des étagères (ajouter, renommer, retirer). Un même nom à deux niveaux (catégorie « Vinyle » et étagère « Vinyle » de Musique) est permis, mais l'appli prévient d'abord (`categoryClash` / `shelfClash`). Cet avertissement compare sans accents ni pluriel (`loose`) ; le refus des doublons reste strict.

## Plus tard (demandé, hors version 1)

- **Déplacement groupé** : déplacer d'un coup les objets d'une étagère, ou une sélection, vers une autre catégorie ou étagère. C'est utile quand une étagère devient une catégorie à part (« Vinyle » de Musique → catégorie « Vinyle »). Aujourd'hui, il faut modifier chaque fiche une par une.
- **Clés TMDB et RAWG** : reportées par l'utilisateur le 19/11/2026. Il les créera lui-même (comptes gratuits, usage personnel) et les saisira dans Réglages sur chaque appareil. Ensuite :
  - tester pour de vrai les recherches de films, séries et jeux : les formes de réponse viennent de la documentation ;
  - ajouter le logo officiel TMDB dans « Sources et crédits », comme l'exigent leurs conditions, dès que la clé est saisie (décision du 19/11/2026 : l'appli est publiée sans, car elle n'appelle pas TMDB sans clé) ;
  - RAWG gratuit : 20 000 requêtes par mois, lien actif vers RAWG obligatoire (déjà en place).
- Rayons en 3D avec Three.js.

## Contraintes à respecter

- **Dépôt public : aucune clé d'API ni donnée perso dans le code.** TMDB et RAWG demandent une clé : l'utilisateur la saisit dans Réglages, elle reste dans le `localStorage` de l'appareil (préfixe `collections:key-`) et n'est jamais exportée. Open Library, MusicBrainz et Cover Art Archive fonctionnent sans clé.
- La collection n'existe que dans le navigateur et dans les exports JSON. Ne jamais committer d'export, ni l'export CSV de Goodreads (`*.csv` est dans le `.gitignore`).
- MusicBrainz limite à environ 1 requête par seconde : espacer les appels.
- Scan de code-barres : Safari iOS ne fournit pas l'API `BarcodeDetector`. On charge au premier scan le ponyfill `barcode-detector@3.2.3/pure` (MIT, basé sur zxing-wasm, environ 1 Mo) depuis jsDelivr, avec une version épinglée (`BARCODE_LIB` dans `app.js`). Il n'est pas mis en cache par le service worker, mais le scan a de toute façon besoin du réseau. La caméra exige HTTPS, ou `localhost` sur PC : en http sur le réseau local, l'iPhone affiche « Caméra indisponible ».
- **Scan verrouillé** (décision de l'utilisateur, 19/11/2026 : pas d'accès caméra pour l'instant). Le bouton reste visible mais `disabled`, avec la mention « fonction à coder plus tard » (`index.html`). Le code est en place : retirer `disabled` pour le réactiver, seulement à la demande de l'utilisateur. La recherche par ISBN tapé dans le titre reste active.
- Le scan ne sert qu'aux livres et à la musique. Un ISBN (`normalizeIsbn`, qui accepte aussi l'ISBN-10 tapé dans le titre) cherche l'édition exacte sur Open Library ; tout autre code cherche le disque sur MusicBrainz (`byBarcode`). Le formulaire passe dans la bonne catégorie, et un résultat unique est choisi d'office. TMDB et RAWG ne cherchent pas par EAN : films, séries et jeux s'ajoutent par titre.
- Lien iCloud : une page web ne peut pas ouvrir un chemin local d'iCloud Drive. On stocke donc un **lien de partage iCloud** (`https://www.icloud.com/iclouddrive/…`).
- L'IndexedDB d'une PWA installée sur iPhone est séparée de celle de Safari. Les données peuvent aussi être perdues (désinstallation, effacement des données du site) : l'export JSON est la seule sauvegarde.
- Import JSON : il fusionne par `id` d'objet, et la date `updatedAt` la plus récente l'emporte. Il ne doit jamais écraser toute la base sans confirmation.

## Architecture des données

- `db.js` : seul accès à IndexedDB (base `collections`, magasins `categories` et `items`, clé `id`). `putMany` écrit plusieurs magasins en une transaction.
- `sync.js` : logique pure de l'export/import (validation du fichier, fusion).
- `items.js` : logique pure des fiches. `buildItem` valide le formulaire et construit la fiche, `filterItems` et `listGenres` servent aux filtres, `safeLink` valide les liens.
- `categories.js` : logique pure de gestion des catégories et étagères. Chaque opération renvoie `{ categories, items }`, les fiches à réécrire. Un renommage d'étagère se propage aux objets ; supprimer une catégorie marque aussi ses objets comme supprimés. Dans `app.js`, `apply(op)` écrit le résultat et rafraîchit l'écran.
- Ces modules purs n'utilisent aucune API du navigateur (sauf `crypto`), ce qui permet de les tester sous Node. Toute nouvelle logique de données qui peut s'en passer va dans un module pur du même genre, avec son test.
- `app.js` : l'interface. Les textes saisis ou importés passent toujours par `textContent`, jamais par `innerHTML`. Un lien n'est affiché qu'après `safeLink`, qui n'accepte que le https.
- `goodreads.js` : import de l'export CSV de Goodreads (Réglages). `parseCsv` lit le CSV, `fromGoodreads` crée les fiches du rayon Livres : id `goodreads-<Book Id>`, statut tiré de « Exclusive Shelf » (read → terminé, currently-reading → en cours, to-read → à découvrir), date de fin tirée de « Date Read », numérique si « Kindle » ou « ebook », auteur principal seulement, couverture Open Library par ISBN. Un livre déjà présent (même id, ou même titre sans la série et même auteur, supprimé compris) est ignoré : l'import n'écrase jamais une fiche.
- `sources.js` : recherche en ligne. Les fonctions `parse*` sont pures et testées ; `SOURCES[id].search(q, clé)` renvoie des résultats normalisés (`source`, `ref`, `title`, `creators`, `year`, `cover`, `genres`), et `details` complète (réalisateur, développeur, genres, tracklist). `SOURCE_BY_CATEGORY` associe une source à chaque catégorie par défaut ; une catégorie créée n'en a pas. Choisir un résultat remplit le titre (à l'ajout seulement) et les champs vides ; les genres de la source sont seulement proposés.
- MusicBrainz : environ 1 requête par seconde, sinon réponse 503. `mbJSON` espace les appels et réessaie une fois. La recherche puis les détails coûtent 3 requêtes.
- Obligations des sources : mention TMDB (texte dans Réglages ; le logo TMDB est exigé, mais pas encore ajouté) et lien actif vers RAWG partout où ses données s'affichent (pied de page et sous les résultats). Les formes de réponse TMDB et RAWG dans les tests viennent de la documentation, pas d'appels réels.
- Fiche d'objet : `id`, `categoryId`, `shelf?`, `title`, `creators[]`, `year?`, `genres[]`, `status?` (`a-acquerir` | `a-decouvrir` | `en-cours` | `termine`, libellés selon la catégorie par `statusLabel` : À lire / Lu, À voir / Vu…), `finishedAt?` (`AAAA-MM-JJ`, statut terminé seulement), `format` (`physique` | `numerique`), `link?` (lien de partage iCloud, numérique seulement), `cover?` (URL https, ou image choisie sur l'appareil : data URL JPEG de 400 px max, environ 30 Ko, incluse dans l'export ; toujours afficher via `safeCover`), `tracks?[]` (`title`, `length`), `source?` (`id`, `ref`), `createdAt`, `updatedAt`, `deleted?`. Catégorie : `id`, `name`, `order`, `shelves?[]`, `updatedAt`, `deleted?`.
- Chaque fiche a un `id` texte et un `updatedAt` en millisecondes. **Toute modification met `updatedAt` à `Date.now()`**, sinon la fusion l'ignore.
- **Supprimer = marquer la fiche `deleted: true`** (avec un nouveau `updatedAt`), ne jamais l'effacer de la base. Sinon, l'import depuis l'autre appareil la ferait réapparaître. L'affichage filtre les fiches supprimées.
- **Annulation** : toute suppression propose le bandeau « Annuler » pendant 15 s (`offerUndo` dans `app.js`). Un objet se supprime sans confirmation ; une catégorie ou une étagère garde sa confirmation et a aussi le bandeau. Pour une opération de `categories.js`, on passe un libellé à `apply(op, undoLabel)`, qui prend un `snapshot` des fiches avant écriture. Ailleurs, on appelle `offerUndo(libellé, { categories, items })` avec les versions d'avant. Annuler réécrit ces versions avec un `updatedAt` neuf, pour que la synchro retienne la restauration. Seule la dernière opération est annulable : un nouveau bandeau remplace le précédent.
- Les catégories par défaut ont des `id` fixes (`livres`, `films`…) et `updatedAt: 0`, pour que PC et iPhone ne les dupliquent pas. Une catégorie ou une fiche créée prend un `newId()` (`items.js`), et non `crypto.randomUUID()`, qui n'existe pas en http sur le réseau local.
- Ajouter un magasin : l'ajouter à `STORES` dans `sync.js` et incrémenter `DB_VERSION` dans `db.js`.
- Export : la feuille de partage sur écran tactile (« Enregistrer dans Fichiers »), sinon un téléchargement. Le nom suit le motif `collections-AAAA-MM-JJ.json`, que le `.gitignore` exclut.

## Service worker

`sw.js` sert d'abord les fichiers du cache (liste `SHELL`). **Toute modification d'un fichier de l'appli impose d'incrémenter `VERSION` dans `sw.js`**, sinon les appareils déjà installés gardent l'ancienne version. Un nouveau fichier de l'appli s'ajoute aussi à `SHELL`. Les requêtes vers d'autres domaines (API) ne passent pas par le cache.

## Commandes

- Servir en local : `python -m http.server 8000`, puis ouvrir http://localhost:8000. Le service worker et la caméra exigent `localhost` ou HTTPS. Pour tester sur iPhone, passer par GitHub Pages.
- Mise en ligne : https://xeveli.github.io/collections/ (GitHub Pages, branche `main`, dossier racine). Chaque push sur `main` republie le site en une à deux minutes ; pousser seulement à la demande de l'utilisateur.
- Tests de la logique pure (fusion d'import, parsing des réponses d'API) : `node --test`. Pour un seul fichier : `node --test tests/<fichier>.test.js`. Pas de `package.json` : Node détecte seul les modules ES.
