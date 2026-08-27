import { getState } from "./store.js";
import { money, percent } from "./format.js";

export function coperturaGruppo(gruppoId, puntiVendita) {
  const pdv = puntiVendita.filter(p => String(p.gruppo_id) === String(gruppoId));
  const totale = pdv.length;
  const serviti = pdv.filter(p => p.stato === "servito").length;
  const pct = totale ? (serviti / totale) * 100 : 0;
  return { totale, serviti, pct };
}

export function fatturatoUltimi12Mesi(vendite) {
  const oggi = new Date();
  const soglia = new Date(oggi.getFullYear(), oggi.getMonth() - 11, 1);
  return vendite
    .filter(v => v.periodo && new Date(v.periodo) >= soglia)
    .reduce((sum, v) => sum + Number(v.valore_euro || 0), 0);
}

export function computeGlobalStats() {
  const { gruppi, puntiVendita, vendite } = getState();
  const gruppiAttivi = gruppi.filter(g => g.stato === "attivo").length;
  const pdvTotali = puntiVendita.length;
  const pdvServiti = puntiVendita.filter(p => p.stato === "servito").length;
  const coperturaPct = pdvTotali ? (pdvServiti / pdvTotali) * 100 : 0;
  const gruppiCritici = gruppi.filter(g => g.stato === "sospeso").length;
  const fatturato = fatturatoUltimi12Mesi(vendite);
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
