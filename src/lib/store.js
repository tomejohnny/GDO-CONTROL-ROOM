import { listRows } from "./db.js";

const state = {
  gruppi: [],
  puntiVendita: [],
  agenti: [],
  articoli: [],
  assortimenti: [],
  vendite: [],
  attivita: [],
  importBatches: [],
};

export function getState() {
  return state;
}

export async function loadAll() {
  const [gruppi, puntiVendita, agenti, articoli, assortimenti, vendite, attivita, importBatches] = await Promise.all([
    listRows("gdo_groups", { orderBy: "nome" }),
    listRows("punti_vendita", { orderBy: "nome_insegna" }),
    listRows("agenti", { orderBy: "cognome" }),
    listRows("articoli", { orderBy: "descrizione" }),
    listRows("assortimenti", { orderBy: "created_at", ascending: false }),
    listRows("vendite", { orderBy: "periodo", ascending: false }),
    listRows("attivita", { orderBy: "created_at", ascending: false }),
    listRows("import_batches", { orderBy: "created_at", ascending: false }),
  ]);
  state.gruppi = gruppi;
  state.puntiVendita = puntiVendita;
  state.agenti = agenti;
  state.articoli = articoli;
  state.assortimenti = assortimenti;
  state.vendite = vendite;
  state.attivita = attivita;
  state.importBatches = importBatches;
  return state;
}

export function gruppoById(id) {
  return state.gruppi.find(g => String(g.id) === String(id));
}

export function agenteById(id) {
  return state.agenti.find(a => String(a.id) === String(id));
}

export function agenteNome(id) {
  const a = agenteById(id);
  return a ? `${a.nome} ${a.cognome}` : null;
}

export function puntiVenditaDelGruppo(gruppoId) {
  return state.puntiVendita.filter(p => String(p.gruppo_id) === String(gruppoId));
}

export function articoloById(id) {
  return state.articoli.find(a => String(a.id) === String(id));
}
