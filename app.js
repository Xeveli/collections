import { getAll, putMany, seedDefaults } from './db.js';
import { buildExport, parseImport, planMerge, STORES } from './sync.js';

const nav = document.getElementById('cats');
const backup = document.getElementById('backup');
const status = document.getElementById('backup-status');
const lastExport = document.getElementById('last-export');
const LAST_EXPORT_KEY = 'collections:last-export';

let current = 'tout';

async function renderCats() {
  const cats = (await getAll('categories')).filter((c) => !c.deleted).sort((a, b) => a.order - b.order);
  nav.replaceChildren(...[{ id: 'tout', name: 'Tout' }, ...cats].map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = c.name;
    b.setAttribute('aria-pressed', String(c.id === current));
    b.addEventListener('click', () => { current = c.id; renderCats(); });
    return b;
  }));
}

// Préférence d'affichage propre à l'appareil : sa perte n'a pas de conséquence.
function readLastExport() {
  try { return localStorage.getItem(LAST_EXPORT_KEY); } catch { return null; }
}
function showLastExport() {
  const iso = readLastExport();
  lastExport.textContent = iso
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
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  try { localStorage.setItem(LAST_EXPORT_KEY, payload.exportedAt); } catch { /* préférence non critique */ }
  showLastExport();
  status.textContent = `Export prêt : ${data.items.length} objet(s), ${data.categories.length} catégorie(s).`;
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
  await renderCats();
}

function report(action) {
  return (...args) => action(...args).catch((err) => {
    console.error(err);
    status.textContent = `Erreur : ${err.message}`;
  });
}

document.getElementById('open-backup').addEventListener('click', () => {
  status.textContent = '';
  showLastExport();
  backup.showModal();
});
document.getElementById('export').addEventListener('click', report(exportData));
document.getElementById('import').addEventListener('change', report(async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // permet de réimporter le même fichier
  if (file) await importFile(file);
}));

await seedDefaults();
await renderCats();
navigator.storage?.persist?.();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.error('Service worker :', err));
}
