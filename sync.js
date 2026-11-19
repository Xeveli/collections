// Logique pure de l'export/import JSON (aucun accès au navigateur : testée avec node --test).

export const FORMAT = 'collections-export';
export const FORMAT_VERSION = 1;
export const STORES = ['categories', 'items'];

export function buildExport(data, now = new Date()) {
  return { format: FORMAT, version: FORMAT_VERSION, exportedAt: now.toISOString(), ...data };
}

function isRecord(r) {
  return r !== null && typeof r === 'object' && typeof r.id === 'string' && r.id !== '' && Number.isFinite(r.updatedAt);
}

// Le fichier vient de l'extérieur : on le valide entièrement avant d'écrire quoi que ce soit.
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Ce fichier n'est pas un JSON valide.");
  }
  if (data?.format !== FORMAT) throw new Error("Ce fichier n'est pas un export de Collections.");
  if (!(data.version <= FORMAT_VERSION)) {
    throw new Error("Cet export vient d'une version plus récente de l'appli : mets-la à jour avant d'importer.");
  }
  const out = {};
  for (const store of STORES) {
    if (!Array.isArray(data[store]) || !data[store].every(isRecord)) {
      throw new Error(`La section « ${store} » du fichier est invalide.`);
    }
    out[store] = data[store];
  }
  return out;
}

// Fusion fiche par fiche : la date updatedAt la plus récente gagne, à égalité la version locale reste.
// Une suppression est une fiche marquée deleted: true, pour qu'un import ne la ressuscite pas.
export function planMerge(local, incoming) {
  const byId = new Map(local.map((r) => [r.id, r]));
  const added = [];
  const updated = [];
  let unchanged = 0;
  for (const r of incoming) {
    const cur = byId.get(r.id);
    if (!cur) added.push(r);
    else if (r.updatedAt > cur.updatedAt) updated.push(r);
    else unchanged += 1;
  }
  return { added, updated, unchanged };
}
