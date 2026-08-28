import { getState, gruppoById } from "../lib/store.js";
import { escapeHtml, money, percent, statoBadge, STATO_GRUPPO } from "../lib/format.js";
import { coperturaGruppo } from "../lib/kpis.js";
import { barChartHorizontal } from "../lib/charts.js";
import { topGruppiPerFatturato, topAgentiPerFatturato, confrontoCediDiretto, gruppiMargineBasso, pdvNonServitiSenzaAgente, SOGLIA_MARGINE_BASSO } from "../lib/analytics.js";

function coverageColor(pct) {
  if (pct >= 60) return "var(--accent-green)";
  if (pct >= 25) return "var(--accent-amber)";
  return "var(--accent-red)";
}

export function render() {
  const container = document.getElementById("dashboard-content");
  if (!container) return;
  const { gruppi, puntiVendita, vendite, agenti, assortimenti } = getState();

  container.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <h2>Copertura per gruppo GDO</h2>
        <div id="dash-coverage-chart"></div>
      </div>
      <div class="card">
        <h2>Top gruppi per fatturato</h2>
        <div id="dash-top-fatturato"></div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <h2>Top agenti per fatturato</h2>
        <div id="dash-top-agenti"></div>
      </div>
      <div class="card">
        <h2>CEDI vs diretto per gruppo</h2>
        <p class="hint">Fatturato ultimi 12 mesi tramite magazzino centrale rispetto ai negozi diretti, per i gruppi che hanno entrambi i canali.</p>
        <div id="dash-cedi-confronto"></div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <h2>Rischio marginalità</h2>
        <p class="hint">Gruppi con margine sotto il ${SOGLIA_MARGINE_BASSO}% sul fatturato importato.</p>
        <div id="dash-margine-basso"></div>
      </div>
      <div class="card">
        <h2>Punti vendita da assegnare</h2>
        <p class="hint">Non serviti e senza nessun agente: l'opportunità più libera su cui intervenire.</p>
        <div id="dash-senza-agente"></div>
      </div>
    </div>
    <div class="card">
      <h2>Maggiori opportunità di sviluppo</h2>
      <p class="hint">Gruppi con più punti vendita ancora non serviti (assegnati o meno).</p>
      <div id="dash-opportunita"></div>
    </div>
    <div class="card">
      <h2>Gruppi che richiedono attenzione</h2>
      <div id="dash-attenzione"></div>
    </div>`;

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

  // Top gruppi per fatturato
  const topFatturato = topGruppiPerFatturato(vendite, 8)
    .filter(g => g.valore_euro > 0)
    .map(g => ({ label: gruppoById(g.gruppo_id)?.nome || "—", value: g.valore_euro, color: "var(--accent-blue)" }));
  document.getElementById("dash-top-fatturato").innerHTML = topFatturato.length
    ? barChartHorizontal({ items: topFatturato, formatValue: v => money(v) })
    : `<div class="empty-state">Nessun dato di venduto ancora importato.</div>`;

  // Top agenti per fatturato
  const topAgenti = topAgentiPerFatturato(agenti, vendite, puntiVendita, 8)
    .map(a => ({ label: a.nome, value: a.fatturatoTotale, color: "var(--accent-green)" }));
  document.getElementById("dash-top-agenti").innerHTML = topAgenti.length
    ? barChartHorizontal({ items: topAgenti, formatValue: v => money(v) })
    : `<div class="empty-state">Nessun punto vendita gestito da un agente ha ancora venduto.</div>`;

  // CEDI vs diretto per gruppo
  const cediConfronto = confrontoCediDiretto(gruppi, vendite, assortimenti);
  document.getElementById("dash-cedi-confronto").innerHTML = cediConfronto.length ? `
    <div style="overflow-x:auto"><table class="desktop-table">
      <thead><tr><th>Gruppo</th><th style="text-align:right">Fatturato diretto</th><th style="text-align:right">Fatturato CEDI</th><th style="text-align:right">Articoli diretto</th><th style="text-align:right">Articoli CEDI</th></tr></thead>
      <tbody>
        ${cediConfronto.map(x => `<tr>
          <td><strong>${escapeHtml(x.nome)}</strong></td>
          <td style="text-align:right" class="amount">${money(x.diretto.fatturato)}</td>
          <td style="text-align:right" class="amount">${money(x.cedi.fatturato)}</td>
          <td style="text-align:right">${x.diretto.articoli}</td>
          <td style="text-align:right">${x.cedi.articoli}</td>
        </tr>`).join("")}
      </tbody>
    </table></div>` : `<div class="empty-state">Nessun gruppo ha ancora sia un canale diretto sia un CEDI.</div>`;

  // Rischio marginalità
  const margineBasso = gruppiMargineBasso(vendite);
  const margEl = document.getElementById("dash-margine-basso");
  margEl.innerHTML = margineBasso.length ? `
    <div style="overflow-x:auto"><table class="desktop-table">
      <thead><tr><th>Gruppo</th><th style="text-align:right">Fatturato</th><th style="text-align:right">Margine</th></tr></thead>
      <tbody>
        ${margineBasso.slice(0, 8).map(g => `<tr>
          <td><strong>${escapeHtml(gruppoById(g.gruppo_id)?.nome || "—")}</strong></td>
          <td style="text-align:right">${money(g.valore_euro)}</td>
          <td style="text-align:right" class="text-red">${percent(g.marginePct)}</td>
        </tr>`).join("")}
      </tbody>
    </table></div>` : `<div class="empty-state">Nessun gruppo sotto la soglia di margine, o dati di venduto non ancora importati.</div>`;

  // Punti vendita non serviti e senza agente
  const senzaAgente = pdvNonServitiSenzaAgente(puntiVendita);
  const saEl = document.getElementById("dash-senza-agente");
  saEl.innerHTML = senzaAgente.length ? `
    <div style="overflow-x:auto"><table class="desktop-table">
      <thead><tr><th>Punto vendita</th><th>Gruppo</th><th>Comune</th></tr></thead>
      <tbody>
        ${senzaAgente.slice(0, 8).map(p => `<tr>
          <td><strong>${escapeHtml(p.nome_insegna)}</strong></td>
          <td>${escapeHtml(gruppoById(p.gruppo_id)?.nome || "—")}</td>
          <td>${escapeHtml(p.comune || "—")}</td>
        </tr>`).join("")}
      </tbody>
    </table></div>
    ${senzaAgente.length > 8 ? `<p class="hint" style="margin-top:8px;margin-bottom:0">e altri ${senzaAgente.length - 8} punti vendita.</p>` : ""}
    ` : `<div class="empty-state">Tutti i punti vendita non serviti hanno già un agente assegnato.</div>`;

  // Maggiori opportunita': piu' PdV non serviti
  const opportunita = conCopertura
    .map(x => ({ ...x, nonServiti: x.totale - x.serviti }))
    .filter(x => x.nonServiti > 0)
    .sort((a, b) => b.nonServiti - a.nonServiti)
    .slice(0, 8);

  const oppEl = document.getElementById("dash-opportunita");
  oppEl.innerHTML = opportunita.length ? `
    <div style="overflow-x:auto"><table class="desktop-table">
      <thead><tr><th>Gruppo</th><th>PdV non serviti</th><th>Copertura attuale</th></tr></thead>
      <tbody>
        ${opportunita.map(x => `<tr>
          <td><strong>${escapeHtml(x.g.nome)}</strong></td>
          <td>${x.nonServiti} su ${x.totale}</td>
          <td>${x.pct.toFixed(1)}%</td>
        </tr>`).join("")}
      </tbody>
    </table></div>` : `<div class="empty-state">Nessuna opportunità rilevata: tutti i punti vendita censiti sono serviti.</div>`;

  // Gruppi in attenzione: stato sospeso
  const attenzione = gruppi.filter(g => g.stato === "sospeso");
  const attEl = document.getElementById("dash-attenzione");
  attEl.innerHTML = attenzione.length ? `
    <div style="overflow-x:auto"><table class="desktop-table">
      <thead><tr><th>Gruppo</th><th>Area</th><th>Stato</th><th>Note</th></tr></thead>
      <tbody>
        ${attenzione.map(g => `<tr>
          <td><strong>${escapeHtml(g.nome)}</strong></td>
          <td>${escapeHtml(g.area_geografica || "—")}</td>
          <td>${statoBadge(STATO_GRUPPO, g.stato)}</td>
          <td>${escapeHtml(g.note || "—")}</td>
        </tr>`).join("")}
      </tbody>
    </table></div>` : `<div class="empty-state">Nessun gruppo in stato critico al momento.</div>`;
}
