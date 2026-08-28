// Calcoli condivisi tra Dashboard, Assortimenti e altre viste — tenerli qui
// evita di duplicare la stessa logica di aggregazione in più tab.

export const SOGLIA_MARGINE_BASSO = 15; // %

export function topGruppiPerFatturato(vendite, n = 5) {
  const byGruppo = new Map();
  vendite.forEach(v => {
    const g = byGruppo.get(v.gruppo_id) || { gruppo_id: v.gruppo_id, valore_euro: 0, margine_valore: 0 };
    g.valore_euro += Number(v.valore_euro || 0);
    g.margine_valore += Number(v.margine_valore || 0);
    byGruppo.set(v.gruppo_id, g);
  });
  return [...byGruppo.values()].sort((a, b) => b.valore_euro - a.valore_euro).slice(0, n);
}

// Gruppi con margine % (margine/fatturato) sotto soglia — solo quelli con
// fatturato reale, altrimenti un gruppo senza vendite risulterebbe "a rischio".
export function gruppiMargineBasso(vendite, soglia = SOGLIA_MARGINE_BASSO) {
  const byGruppo = new Map();
  vendite.forEach(v => {
    const g = byGruppo.get(v.gruppo_id) || { gruppo_id: v.gruppo_id, valore_euro: 0, margine_valore: 0 };
    g.valore_euro += Number(v.valore_euro || 0);
    g.margine_valore += Number(v.margine_valore || 0);
    byGruppo.set(v.gruppo_id, g);
  });
  return [...byGruppo.values()]
    .filter(g => g.valore_euro > 0)
    .map(g => ({ ...g, marginePct: (g.margine_valore / g.valore_euro) * 100 }))
    .filter(g => g.marginePct < soglia)
    .sort((a, b) => a.marginePct - b.marginePct);
}

// Punti vendita non serviti e senza nessun agente assegnato: nessuno se ne
// sta occupando, sono l'opportunità più "libera" su cui intervenire.
export function pdvNonServitiSenzaAgente(puntiVendita) {
  return puntiVendita.filter(p => p.stato !== "servito" && p.agente_id == null);
}

// Articoli "attivo" nell'assortimento di un gruppo ma senza nessuna vendita
// registrata su nessun punto vendita di quel gruppo: possibile disallineamento
// (venduto non tracciato qui, o assortimento non più aggiornato).
export function assortimentiSenzaVendite(assortimenti, vendite) {
  const venditeKeys = new Set(vendite.filter(v => v.gruppo_id != null && v.articolo_id != null).map(v => `${v.gruppo_id}::${v.articolo_id}`));
  return assortimenti.filter(a => a.stato === "attivo" && !venditeKeys.has(`${a.gruppo_id}::${a.articolo_id}`));
}

// L'opposto: vendite reali su una combinazione gruppo+articolo che non risulta
// nell'assortimento del gruppo — venduto "informale", non documentato.
export function venditeSenzaAssortimento(vendite, assortimenti) {
  const assortKeys = new Set(assortimenti.map(a => `${a.gruppo_id}::${a.articolo_id}`));
  const seen = new Map();
  vendite.forEach(v => {
    if (v.gruppo_id == null || v.articolo_id == null) return;
    const key = `${v.gruppo_id}::${v.articolo_id}`;
    if (assortKeys.has(key)) return;
    if (!seen.has(key)) seen.set(key, { gruppo_id: v.gruppo_id, articolo_id: v.articolo_id, valore_euro: 0 });
    seen.get(key).valore_euro += Number(v.valore_euro || 0);
  });
  return [...seen.values()].sort((a, b) => b.valore_euro - a.valore_euro);
}

// Per un gruppo: per ogni articolo attivo nell'assortimento del gruppo, quali
// punti vendita del gruppo lo acquistano davvero (vendite registrate) e quali
// no — la copertura reale dell'assortimento sui singoli negozi.
export function coperturaAssortimentoPerPdv(gruppoId, assortimenti, vendite, puntiVendita) {
  const pdvGruppo = puntiVendita.filter(p => String(p.gruppo_id) === String(gruppoId));
  const acquirentiByArticolo = new Map();
  vendite.forEach(v => {
    if (String(v.gruppo_id) !== String(gruppoId) || v.punto_vendita_id == null || v.articolo_id == null) return;
    if (!(Number(v.valore_euro) > 0 || Number(v.quantita) > 0)) return;
    if (!acquirentiByArticolo.has(v.articolo_id)) acquirentiByArticolo.set(v.articolo_id, new Set());
    acquirentiByArticolo.get(v.articolo_id).add(v.punto_vendita_id);
  });
  return assortimenti
    .filter(a => String(a.gruppo_id) === String(gruppoId) && a.stato === "attivo")
    .map(a => {
      const acquirenti = acquirentiByArticolo.get(a.articolo_id) || new Set();
      return {
        articolo_id: a.articolo_id,
        pdvAcquirenti: pdvGruppo.filter(p => acquirenti.has(p.id)),
        pdvNonAcquirenti: pdvGruppo.filter(p => !acquirenti.has(p.id)),
      };
    });
}
