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
  - Livres : Open Library, avec Google Books en secours.
  - Films et séries : TMDB.
  - Jeux vidéo : RAWG.
  - Musique : MusicBrainz (tracklist, artistes) et Cover Art Archive pour la pochette.
- Indicateur physique/numérique, choisi à l'ajout.
- Livre numérique : un simple lien vers le fichier EPUB/PDF sur iCloud. L'appli ne stocke aucun fichier.
- Genres modifiables à la main, filtres par catégorie et par genre, vue liste.

## Contraintes à respecter

- **Dépôt public : aucune clé d'API ni donnée perso dans le code.** TMDB et RAWG demandent une clé : l'utilisateur la saisit dans les réglages de l'appli et elle reste dans IndexedDB. Open Library, Google Books (faible volume) et MusicBrainz fonctionnent sans clé.
- La collection n'existe que dans le navigateur et dans les exports JSON. Ne jamais committer d'export.
- MusicBrainz limite à environ 1 requête par seconde : espacer les appels.
- Scan de code-barres : Safari iOS ne fournit pas l'API `BarcodeDetector`, il faut une bibliothèque (ex. ZXing) chargée depuis un CDN avec une version épinglée. La caméra exige HTTPS, ou `localhost` sur PC.
- Le scan ne remplit automatiquement que les livres (ISBN) et la musique (recherche MusicBrainz par code-barres). TMDB et RAWG ne cherchent pas par EAN : films, séries et jeux s'ajoutent par titre.
- Lien iCloud : une page web ne peut pas ouvrir un chemin local d'iCloud Drive. On stocke donc un **lien de partage iCloud** (`https://www.icloud.com/iclouddrive/…`).
- L'IndexedDB d'une PWA installée sur iPhone est séparée de celle de Safari. Les données peuvent aussi être perdues (désinstallation, effacement des données du site) : l'export JSON est la seule sauvegarde.
- Import JSON : il fusionne par `id` d'objet, et la date `updatedAt` la plus récente l'emporte. Il ne doit jamais écraser toute la base sans confirmation.

## Service worker

`sw.js` sert d'abord les fichiers du cache (liste `SHELL`). **Toute modification d'un fichier de l'appli impose d'incrémenter `VERSION` dans `sw.js`**, sinon les appareils déjà installés gardent l'ancienne version. Un nouveau fichier de l'appli s'ajoute aussi à `SHELL`. Les requêtes vers d'autres domaines (API) ne passent pas par le cache.

## Commandes

- Servir en local : `python -m http.server 8000`, puis ouvrir http://localhost:8000. Le service worker et la caméra exigent `localhost` ou HTTPS. Pour tester sur iPhone, passer par GitHub Pages.
- Tests de la logique pure (fusion d'import, parsing des réponses d'API) : `node --test`. Pour un seul fichier : `node --test tests/<fichier>.test.js`.
