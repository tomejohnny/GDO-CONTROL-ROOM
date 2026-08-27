import { getState } from "../lib/store.js";
import { escapeHtml, statoBadge, STATO_GRUPPO } from "../lib/format.js";
import { coperturaGruppo } from "../lib/kpis.js";
import { barChartHorizontal } from "../lib/charts.js";

function coverageColor(pct) {
  if (pct >= 60) return "var(--accent-green)";
  if (pct >= 25) return "var(--accent-amber)";
  return "var(--accent-red)";
}

export function render() {
  const { gruppi, puntiVendita } = getState();

  const conCopertura = gruppi.map(g => ({ g, ...coperturaGruppo(g.id, puntiVendita) }));

  // Copertura per gruppo (solo gruppi con almeno un PdV)
  const coverageItems = conCopertura
    .filter(x => x.totale > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 12)
    .map(x => ({ label: x.g.nome, value: x.pct, color: coverageColor(x.pct) }));
  document.getElementById("dash-coverage-chart").innerHTML = coverageItems.length
    ? barChartHorizontal({ items: coverageItems, max: 100, unit: "%" })
    : `<div class="empty-state">Aggiungi punti vendita ai gruppi GDO per vedere la copertura.</div>`;

  // Maggiori opportunita': piu' PdV non serviti
  const opportunita = conCopertura
    .map(x => ({ ...x, nonServiti: x.totale - x.serviti }))
    .filter(x => x.nonServiti > 0)
    .sort((a, b) => b.nonServiti - a.nonServiti)
    .slice(0, 8);

  const oppEl = document.getElementById("dash-opportunita");
  oppEl.innerHTML = opportunita.length ? `
    <table class="desktop-table">
      <thead><tr><th>Gruppo</th><th>PdV non serviti</th><th>Copertura attuale</th></tr></thead>
      <tbody>
        ${opportunita.map(x => `<tr>
          <td><strong>${escapeHtml(x.g.nome)}</strong></td>
          <td>${x.nonServiti} su ${x.totale}</td>
          <td>${x.pct.toFixed(1)}%</td>
        </tr>`).join("")}
      </tbody>
    </table>` : `<div class="empty-state">Nessuna opportunità rilevata: tutti i punti vendita censiti sono serviti.</div>`;

  // Gruppi in attenzione: stato sospeso, o copertura bassa nonostante siano attivi da tempo
  const attenzione = gruppi.filter(g => g.stato === "sospeso");
  const attEl = document.getElementById("dash-attenzione");
  attEl.innerHTML = attenzione.length ? `
    <table class="desktop-table">
      <thead><tr><th>Gruppo</th><th>Area</th><th>Stato</th><th>Note</th></tr></thead>
      <tbody>
        ${attenzione.map(g => `<tr>
          <td><strong>${escapeHtml(g.nome)}</strong></td>
          <td>${escapeHtml(g.area_geografica || "—")}</td>
          <td>${statoBadge(STATO_GRUPPO, g.stato)}</td>
          <td>${escapeHtml(g.note || "—")}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : `<div class="empty-state">Nessun gruppo in stato critico al momento.</div>`;
}
