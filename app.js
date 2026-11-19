// shortcut: catégories en dur, elles passeront dans IndexedDB à l'étape 2.
const CATEGORIES = ['Tout', 'Livres', 'Films', 'Séries', 'Jeux vidéo', 'Musique'];

const nav = document.getElementById('cats');
let current = 'Tout';

function renderCats() {
  nav.replaceChildren(...CATEGORIES.map((name) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.setAttribute('aria-pressed', String(name === current));
    b.addEventListener('click', () => { current = name; renderCats(); });
    return b;
  }));
}
renderCats();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.error('Service worker :', err));
}
