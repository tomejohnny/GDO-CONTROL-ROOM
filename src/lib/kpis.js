import { getState } from "./store.js";
import { money, percent } from "./format.js";

export function coperturaGruppo(gruppoId, puntiVendita) {
  const pdv = puntiVendita.filter(p => String(p.gruppo_id) === String(gruppoId));
  const totale = pdv.length;
  const serviti = pdv.filter(p => p.stato === "servito").length;
  const pct = totale ? (serviti / totale) * 100 : 0;
  return { totale, serviti, pct };
}

// Anno corrente (1 gennaio - oggi), non un rolling di 12 mesi: molti import
// hanno il totale annuale accorpato su un'unica data (in mancanza del
// dettaglio mese per mese), quindi "ultimi 12 mesi" risulterebbe fuorviante
// mentre "anno corrente" resta un'etichetta corretta in ogni caso.
export function fatturatoAnnoCorrente(vendite) {
  const oggi = new Date();
  const inizioAnno = new Date(oggi.getFullYear(), 0, 1);
  return vendite
    .filter(v => v.periodo && new Date(v.periodo) >= inizioAnno)
    .reduce((sum, v) => sum + Number(v.valore_euro || 0), 0);
}

export function computeGlobalStats() {
  const { gruppi, puntiVendita, vendite } = getState();
  const gruppiAttivi = gruppi.filter(g => g.stato === "attivo").length;
  const pdvTotali = puntiVendita.length;
  const pdvServiti = puntiVendita.filter(p => p.stato === "servito").length;
  const coperturaPct = pdvTotali ? (pdvServiti / pdvTotali) * 100 : 0;
  const gruppiCritici = gruppi.filter(g => g.stato === "sospeso").length;
  const fatturato = fatturatoAnnoCorrente(vendite);
  return { totaleGruppi: gruppi.length, gruppiAttivi, pdvTotali, pdvServiti, coperturaPct, gruppiCritici, fatturato };
}

export function refreshKpis() {
  const s = computeGlobalStats();
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set("kpi-gruppi", s.totaleGruppi);
  set("kpi-gruppi-sub", `${s.gruppiAttivi} attivi`);
  set("kpi-pdv", `${s.pdvServiti} / ${s.pdvTotali}`);
  set("kpi-pdv-sub", `Copertura ${percent(s.coperturaPct)}`);
  set("kpi-fatturato", money(s.fatturato));
  set("kpi-attenzione", s.gruppiCritici);
}
