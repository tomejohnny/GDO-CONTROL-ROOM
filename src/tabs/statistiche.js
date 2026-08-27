import { getState, gruppoById, articoloById } from "../lib/store.js";
import { escapeHtml, money, number, formatMonth, CATEGORIE_ARTICOLO } from "../lib/format.js";
import { lineChart, barChartVertical } from "../lib/charts.js";

function monthKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function filters() {
  return {
    gruppo: document.getElementById("st-filter-gruppo")?.value || "",
    categoria: document.getElementById("st-filter-categoria")?.value || "",
    da: document.getElementById("st-filter-da")?.value || "",
    a: document.getElementById("st-filter-a")?.value || "",
  };
}

function filteredVendite() {
  const f = filters();
  return getState().vendite.filter(v => {
    if (f.gruppo && String(v.gruppo_id) !== f.gruppo) return false;
    if (f.categoria) {
      const art = articoloById(v.articolo_id);
      if (!art || art.categoria !== f.categoria) return false;
    }
    if (f.da && v.periodo < f.da) return false;
    if (f.a && v.periodo > f.a) return false;
    return true;
  });
}

function renderContent() {
  const rows = filteredVendite();

  const totaleValore = rows.reduce((s, v) => s + Number(v.valore_euro || 0), 0);
  const totaleQuantita = rows.reduce((s, v) => s + Number(v.quantita || 0), 0);
  const gruppiCoinvolti = new Set(rows.map(v => v.gruppo_id)).size;

  document.getElementById("st-kpi-valore").textContent = money(totaleValore);
  document.getElementById("st-kpi-quantita").textContent = number(totaleQuantita);
  document.getElementById("st-kpi-gruppi").textContent = gruppiCoinvolti;
  document.getElementById("st-kpi-righe").textContent = number(rows.length);

  // Trend mensile
  const byMonth = new Map();
  rows.forEach(v => {
    const key = monthKey(v.periodo);
    byMonth.set(key, (byMonth.get(key) || 0) + Number(v.valore_euro || 0));
  });
  const months = [...byMonth.keys()].sort();
  const points = months.map(m => ({ x: m, y: byMonth.get(m), label: formatMonth(m + "-01") }));
  document.getElementById("st-trend-chart").innerHTML = points.length
    ? lineChart({ points })
    : `<div class="empty-state">Nessun dato di venduto per i filtri selezionati.</div>`;

  // Per categoria
  const byCategoria = new Map();
  rows.forEach(v => {
    const art = articoloById(v.articolo_id);
    const cat = art ? CATEGORIE_ARTICOLO[art.categoria] || art.categoria : "Non classificato";
    byCategoria.set(cat, (byCategoria.get(cat) || 0) + Number(v.valore_euro || 0));
  });
  const catLabels = [...byCategoria.keys()];
  document.getElementById("st-categoria-chart").innerHTML = catLabels.length
    ? barChartVertical({ labels: catLabels, series: [{ label: "Fatturato", values: catLabels.map(c => byCategoria.get(c)), color: "var(--accent-blue)" }] })
    : `<div class="empty-state">Nessun dato per categoria.</div>`;

  // Tabella dettaglio (ultime 100 righe per periodo desc)
  const tbody = document.getElementById("st-table-body");
  const detail = [...rows].sort((a, b) => (a.periodo < b.periodo ? 1 : -1)).slice(0, 100);
  tbody.innerHTML = detail.length ? detail.map(v => {
    const gruppo = gruppoById(v.gruppo_id);
    const pdv = getState().puntiVendita.find(p => String(p.id) === String(v.punto_vendita_id));
    const art = articoloById(v.articolo_id);
    return `<tr>
      <td>${formatMonth(v.periodo)}</td>
      <td>${escapeHtml(gruppo?.nome || "—")}</td>
      <td>${escapeHtml(pdv?.nome_insegna || "Aggregato gruppo")}</td>
      <td>${escapeHtml(art?.descrizione || "—")}</td>
      <td style="text-align:right">${number(v.quantita)}</td>
      <td style="text-align:right" class="amount">${money(v.valore_euro)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="6" class="empty-state">Nessuna riga di venduto trovata. Usa "Import dati" per caricare le statistiche.</td></tr>`;
  if (rows.length > 100) {
    tbody.innerHTML += `<tr><td colspan="6" class="text-muted" style="text-align:center;font-size:0.72rem">Mostrate le 100 righe più recenti su ${rows.length} totali. Affina i filtri per restringere.</td></tr>`;
  }
}

export function render() {
  const container = document.getElementById("statistiche-content");
  if (!container) return;

  const gruppi = [...getState().gruppi].sort((a, b) => a.nome.localeCompare(b.nome));

  container.innerHTML = `
    <div class="card">
      <div class="filter-bar">
        <select id="st-filter-gruppo"><option value="">Tutti i gruppi</option>${gruppi.map(g => `<option value="${g.id}">${escapeHtml(g.nome)}</option>`).join("")}</select>
        <select id="st-filter-categoria">
          <option value="">Tutte le categorie</option>
          ${Object.entries(CATEGORIE_ARTICOLO).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
        </select>
        <input type="month" id="st-filter-da" title="Da">
        <input type="month" id="st-filter-a" title="A">
      </div>
      <div class="grid-kpi" style="margin-bottom:0">
        <div class="kpi-card">
          <div class="kpi-title">Fatturato periodo</div>
          <div class="kpi-value" id="st-kpi-valore">€ 0,00</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Quantità totale</div>
          <div class="kpi-value" id="st-kpi-quantita">0</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Gruppi coinvolti</div>
          <div class="kpi-value" id="st-kpi-gruppi">0</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Righe di venduto</div>
          <div class="kpi-value" id="st-kpi-righe">0</div>
        </div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <h2>Andamento mensile del fatturato</h2>
        <div id="st-trend-chart"></div>
      </div>
      <div class="card">
        <h2>Fatturato per categoria di prodotto</h2>
        <div id="st-categoria-chart"></div>
      </div>
    </div>
    <div class="card">
      <h2>Dettaglio venduto</h2>
      <table class="desktop-table">
        <thead><tr><th>Periodo</th><th>Gruppo</th><th>Punto vendita</th><th>Articolo</th><th style="text-align:right">Quantità</th><th style="text-align:right">Valore</th></tr></thead>
        <tbody id="st-table-body"></tbody>
      </table>
    </div>`;

  ["st-filter-gruppo", "st-filter-categoria", "st-filter-da", "st-filter-a"].forEach(id => {
    document.getElementById(id).addEventListener("change", renderContent);
  });
  renderContent();
}
