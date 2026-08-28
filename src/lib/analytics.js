// Calcoli condivisi tra Dashboard, Assortimenti e altre viste — tenerli qui
// evita di duplicare la stessa logica di aggregazione in più tab.

export const SOGLIA_MARGINE_BASSO = 15; // %

// Anno corrente (1 gennaio - oggi), non un rolling di 12 mesi: molti import
// hanno il totale annuale accorpato su un'unica data (in mancanza del
// dettaglio mese per mese), quindi "ultimi 12 mesi" risulterebbe fuorviante.
function inizioAnnoCorrente() {
  const oggi = new Date();
  return new Date(oggi.getFullYear(), 0, 1);
}

// Per un agente: fatturato dell'anno corrente di ciascun punto vendita che
// gestisce, e il totale — per vedere subito il valore commerciale in carico
// a ciascun agente e come si distribuisce tra i suoi punti vendita.
export function fatturatoPerAgente(agenteId, vendite, puntiVendita) {
  const soglia = inizioAnnoCorrente();
  const venditeRecenti = vendite.filter(v => v.periodo && new Date(v.periodo) >= soglia);

  const pdvGestiti = puntiVendita.filter(p => String(p.agente_id) === String(agenteId));
  const righe = pdvGestiti
    .map(p => {
      const venditePdv = venditeRecenti.filter(v => String(v.punto_vendita_id) === String(p.id));
      const valore_euro = venditePdv.reduce((s, v) => s + Number(v.valore_euro || 0), 0);
      const margine_valore = venditePdv.reduce((s, v) => s + Number(v.margine_valore || 0), 0);
      return { punto_vendita_id: p.id, gruppo_id: p.gruppo_id, valore_euro, margine_valore, marginePct: valore_euro ? (margine_valore / valore_euro) * 100 : 0 };
    })
    .sort((a, b) => b.valore_euro - a.valore_euro);

  const fatturatoTotale = righe.reduce((s, r) => s + r.valore_euro, 0);
  const margineTotale = righe.reduce((s, r) => s + r.margine_valore, 0);
  return { righe, fatturatoTotale, margineTotale, margineTotalePct: fatturatoTotale ? (margineTotale / fatturatoTotale) * 100 : 0 };
}

// Classifica agenti per fatturato dell'anno corrente (somma dei punti
// vendita che gestiscono) — l'equivalente della classifica gruppi, ma per
// agente.
export function topAgentiPerFatturato(agenti, vendite, puntiVendita, n = 8) {
  return agenti
    .map(a => ({ agente_id: a.id, nome: `${a.nome} ${a.cognome}`, ...fatturatoPerAgente(a.id, vendite, puntiVendita) }))
    .filter(x => x.fatturatoTotale > 0)
    .sort((a, b) => b.fatturatoTotale - a.fatturatoTotale)
    .slice(0, n);
}

// Confronto CEDI (magazzino centrale) vs diretto per gruppo: rileva da solo
// le coppie "<NOME>" / "<NOME> CEDI" (create separando il magazzino
// centrale dal gruppo diretto) e mette a confronto fatturato dell'anno
// corrente e numero di articoli in assortimento attivo sui due canali.
export function confrontoCediDiretto(gruppi, vendite, assortimenti) {
  const soglia = inizioAnnoCorrente();
  const fatturatoGruppo = gruppoId => vendite
    .filter(v => String(v.gruppo_id) === String(gruppoId) && v.periodo && new Date(v.periodo) >= soglia)
    .reduce((s, v) => s + Number(v.valore_euro || 0), 0);
  const articoliAttivi = gruppoId => assortimenti.filter(a => String(a.gruppo_id) === String(gruppoId) && a.stato === "attivo").length;

  const byNome = new Map(gruppi.map(g => [g.nome, g]));
  const risultati = [];
  gruppi.forEach(g => {
    if (g.nome.endsWith(" CEDI")) return;
    const cedi = byNome.get(`${g.nome} CEDI`);
    if (!cedi) return;
    risultati.push({
      nome: g.nome,
      diretto: { fatturato: fatturatoGruppo(g.id), articoli: articoliAttivi(g.id) },
      cedi: { fatturato: fatturatoGruppo(cedi.id), articoli: articoliAttivi(cedi.id) },
    });
  });
  return risultati.sort((a, b) => (b.diretto.fatturato + b.cedi.fatturato) - (a.diretto.fatturato + a.cedi.fatturato));
}

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
    })
    .sort((a, b) => b.pdvAcquirenti.length - a.pdvAcquirenti.length);
}

// Articoli attivi nell'assortimento di 2 o più gruppi: per ognuno, quanto
// vende (e a che margine) ciascun gruppo che lo tiene — il confronto diretto
// "stesso articolo, chi lo valorizza meglio" tra clienti diversi.
export function articoliComuniTraGruppi(assortimenti, vendite) {
  const gruppiByArticolo = new Map();
  assortimenti.forEach(a => {
    if (a.stato !== "attivo" || a.articolo_id == null || a.gruppo_id == null) return;
    if (!gruppiByArticolo.has(a.articolo_id)) gruppiByArticolo.set(a.articolo_id, new Set());
    gruppiByArticolo.get(a.articolo_id).add(a.gruppo_id);
  });

  const venditeByKey = new Map();
  vendite.forEach(v => {
    if (v.articolo_id == null || v.gruppo_id == null) return;
    const key = `${v.articolo_id}::${v.gruppo_id}`;
    if (!venditeByKey.has(key)) venditeByKey.set(key, { gruppo_id: v.gruppo_id, valore_euro: 0, quantita: 0, margine_valore: 0 });
    const g = venditeByKey.get(key);
    g.valore_euro += Number(v.valore_euro || 0);
    g.quantita += Number(v.quantita || 0);
    g.margine_valore += Number(v.margine_valore || 0);
  });

  const result = [];
  gruppiByArticolo.forEach((gruppoIds, articoloId) => {
    if (gruppoIds.size < 2) return;
    const gruppi = [...gruppoIds].map(gruppoId => {
      const v = venditeByKey.get(`${articoloId}::${gruppoId}`) || { gruppo_id: gruppoId, valore_euro: 0, quantita: 0, margine_valore: 0 };
      return { ...v, marginePct: v.valore_euro ? (v.margine_valore / v.valore_euro) * 100 : 0 };
    }).sort((a, b) => b.valore_euro - a.valore_euro);
    const valoreTotale = gruppi.reduce((s, g) => s + g.valore_euro, 0);
    result.push({ articolo_id: articoloId, gruppi, valoreTotale });
  });

  return result.sort((a, b) => b.gruppi.length - a.gruppi.length || b.valoreTotale - a.valoreTotale);
}
