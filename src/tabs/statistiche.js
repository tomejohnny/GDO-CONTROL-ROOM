import { getState, gruppoById, articoloById, agenteNome, agenteById } from "../lib/store.js";
import { escapeHtml, money, number, percent, CATEGORIE_ARTICOLO } from "../lib/format.js";
import { barChartVertical } from "../lib/charts.js";
import { downloadCsv } from "../lib/export.js";
import { articoliComuniTraGruppi } from "../lib/analytics.js";

const TOP_N = 15;
const sectionState = {
  articolo: { collapsed: true, showAll: false },
  pdv: { collapsed: true, showAll: false },
  agente: { collapsed: true, showAll: false },
  comuni: { collapsed: true, showAll: false },
};
let lastAggregatedArticolo = [];
let lastAggregatedPdv = [];
let lastAggregatedAgente = [];

function exportArticoloCsv() {
  const headers = ["Gruppo", "Articolo", "Codice", "Categoria", "Punti vendita", "Quantità", "Valore", "Costo", "Margine €", "Margine %"];
  const rows = lastAggregatedArticolo.map(g => {
    const gruppo = gruppoById(g.gruppo_id);
    const art = articoloById(g.articolo_id);
    const marginePct = g.valore_euro ? (g.margine_valore / g.valore_euro) * 100 : 0;
    return [gruppo?.nome || "", art?.descrizione || "", art?.codice || "", art ? CATEGORIE_ARTICOLO[art.categoria] || art.categoria : "", g.puntiVendita.size, g.quantita, g.valore_euro.toFixed(2), g.costo_acquisto.toFixed(2), g.margine_valore.toFixed(2), marginePct.toFixed(1)];
  });
  downloadCsv("venduto_per_articolo.csv", headers, rows);
}

function exportPdvCsv() {
  const headers = ["Gruppo", "Punto vendita", "Articoli", "Quantità", "Valore", "Costo", "Margine €", "Margine %"];
  const rows = lastAggregatedPdv.map(g => {
    const gruppo = gruppoById(g.gruppo_id);
    const pdv = g.punto_vendita_id != null ? getState().puntiVendita.find(p => String(p.id) === String(g.punto_vendita_id)) : null;
    const marginePct = g.valore_euro ? (g.margine_valore / g.valore_euro) * 100 : 0;
    return [gruppo?.nome || "", pdv?.nome_insegna || "Aggregato gruppo", g.articoli.size, g.quantita, g.valore_euro.toFixed(2), g.costo_acquisto.toFixed(2), g.margine_valore.toFixed(2), marginePct.toFixed(1)];
  });
  downloadCsv("fatturato_per_punto_vendita.csv", headers, rows);
}

function exportAgenteCsv() {
  const headers = ["Agente", "Zona", "Punti vendita attivi", "Fatturato medio/PdV", "Quantità", "Valore", "Costo", "Margine €", "Margine %"];
  const rows = lastAggregatedAgente.map(g => {
    const marginePct = g.valore_euro ? (g.margine_valore / g.valore_euro) * 100 : 0;
    const mediaPdv = g.puntiVendita.size ? g.valore_euro / g.puntiVendita.size : 0;
    return [agenteNome(g.agente_id) || "Senza agente", g.agente_id != null ? agenteById(g.agente_id)?.zona || "" : "", g.puntiVendita.size, mediaPdv.toFixed(2), g.quantita, g.valore_euro.toFixed(2), g.costo_acquisto.toFixed(2), g.margine_valore.toFixed(2), marginePct.toFixed(1)];
  });
  downloadCsv("venduto_per_agente.csv", headers, rows);
}

function filters() {
  return {
    gruppo: document.getElementById("st-filter-gruppo")?.value || "",
    puntoVendita: document.getElementById("st-filter-pdv")?.value || "",
    categoria: document.getElementById("st-filter-categoria")?.value || "",
    da: document.getElementById("st-filter-da")?.value || "",
    a: document.getElementById("st-filter-a")?.value || "",
  };
}

function filteredVendite() {
  const f = filters();
  return getState().vendite.filter(v => {
    if (f.gruppo && String(v.gruppo_id) !== f.gruppo) return false;
    if (f.puntoVendita && String(v.punto_vendita_id) !== f.puntoVendita) return false;
    if (f.categoria) {
      const art = articoloById(v.articolo_id);
      if (!art || art.categoria !== f.categoria) return false;
    }
    if (f.da && v.periodo < f.da) return false;
    if (f.a && v.periodo > f.a) return false;
    return true;
  });
}

// Come filteredVendite() ma ignora il filtro gruppo/punto vendita: il
// confronto tra gruppi non ha senso se lo si limita a un solo gruppo.
function filteredVenditeIgnorandoGruppo() {
  const f = filters();
  return getState().vendite.filter(v => {
    if (f.categoria) {
      const art = articoloById(v.articolo_id);
      if (!art || art.categoria !== f.categoria) return false;
    }
    if (f.da && v.periodo < f.da) return false;
    if (f.a && v.periodo > f.a) return false;
    return true;
  });
}

function populatePdvFilter() {
  const sel = document.getElementById("st-filter-pdv");
  if (!sel) return;
  const gruppoId = document.getElementById("st-filter-gruppo")?.value || "";
  const current = sel.value;
  if (!gruppoId) {
    sel.innerHTML = `<option value="">Seleziona un gruppo per filtrare il punto vendita</option>`;
    sel.disabled = true;
    return;
  }
  const pdvList = getState().puntiVendita
    .filter(p => String(p.gruppo_id) === gruppoId)
    .sort((a, b) => a.nome_insegna.localeCompare(b.nome_insegna));
  sel.disabled = false;
  sel.innerHTML = `<option value="">Tutti i punti vendita del gruppo</option>` + pdvList.map(p => `<option value="${p.id}">${escapeHtml(p.nome_insegna)}</option>`).join("");
  if (pdvList.some(p => String(p.id) === current)) sel.value = current;
}

// Aggrega per gruppo+articolo (o solo articolo se il filtro e' gia' su un
// singolo punto vendita): l'elenco riga-per-riga di 1000+ vendite non e'
// utile di per se', quanto/quanto-vale per articolo si'.
function aggregateByArticolo(rows) {
  const groups = new Map();
  rows.forEach(v => {
    const key = `${v.gruppo_id}::${v.articolo_id}`;
    if (!groups.has(key)) {
      groups.set(key, { gruppo_id: v.gruppo_id, articolo_id: v.articolo_id, quantita: 0, valore_euro: 0, costo_acquisto: 0, margine_valore: 0, puntiVendita: new Set() });
    }
    const g = groups.get(key);
    g.quantita += Number(v.quantita || 0);
    g.valore_euro += Number(v.valore_euro || 0);
    g.costo_acquisto += Number(v.costo_acquisto || 0);
    g.margine_valore += Number(v.margine_valore || 0);
    if (v.punto_vendita_id != null) g.puntiVendita.add(v.punto_vendita_id);
  });
  return [...groups.values()].sort((a, b) => b.valore_euro - a.valore_euro);
}

// Stessa aggregazione ma per punto vendita: quali clienti fatturano di piu'.
function aggregateByPuntoVendita(rows) {
  const groups = new Map();
  rows.forEach(v => {
    const key = `${v.gruppo_id}::${v.punto_vendita_id}`;
    if (!groups.has(key)) {
      groups.set(key, { gruppo_id: v.gruppo_id, punto_vendita_id: v.punto_vendita_id, quantita: 0, valore_euro: 0, costo_acquisto: 0, margine_valore: 0, articoli: new Set() });
    }
    const g = groups.get(key);
    g.quantita += Number(v.quantita || 0);
    g.valore_euro += Number(v.valore_euro || 0);
    g.costo_acquisto += Number(v.costo_acquisto || 0);
    g.margine_valore += Number(v.margine_valore || 0);
    if (v.articolo_id != null) g.articoli.add(v.articolo_id);
  });
  return [...groups.values()].sort((a, b) => b.valore_euro - a.valore_euro);
}

// Stessa aggregazione ma per agente (via il punto vendita che gestisce): chi
// sta portando più fatturato, non solo a quanti PdV è assegnato. Le vendite
// di punti vendita senza agente finiscono in un gruppo "Senza agente"
// separato, cosi' la lacuna si vede subito invece di sparire nel totale.
function aggregateByAgente(rows) {
  const pdvAgente = new Map(getState().puntiVendita.map(p => [p.id, p.agente_id]));
  const groups = new Map();
  rows.forEach(v => {
    const agenteId = v.punto_vendita_id != null ? pdvAgente.get(v.punto_vendita_id) ?? null : null;
    const key = agenteId ?? "senza-agente";
    if (!groups.has(key)) {
      groups.set(key, { agente_id: agenteId, quantita: 0, valore_euro: 0, costo_acquisto: 0, margine_valore: 0, puntiVendita: new Set() });
    }
    const g = groups.get(key);
    g.quantita += Number(v.quantita || 0);
    g.valore_euro += Number(v.valore_euro || 0);
    g.costo_acquisto += Number(v.costo_acquisto || 0);
    g.margine_valore += Number(v.margine_valore || 0);
    if (v.punto_vendita_id != null) g.puntiVendita.add(v.punto_vendita_id);
  });
  return [...groups.values()].sort((a, b) => b.valore_euro - a.valore_euro);
}

function renderSection(key, tbodyId, items, rowFn, colspan) {
  const state = sectionState[key];
  const body = document.getElementById(`st-${key}-body-wrap`);
  const toggleBtn = document.getElementById(`st-toggle-${key}`);
  body.style.display = state.collapsed ? "none" : "block";
  toggleBtn.textContent = state.collapsed ? "▸ Espandi" : "▾ Comprimi";
  toggleBtn.classList.toggle("btn-ghost", !state.collapsed);
  if (state.collapsed) return;

  const tbody = document.getElementById(tbodyId);
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="empty-state">Nessun dato di venduto per i filtri selezionati.</td></tr>`;
    document.getElementById(`st-${key}-more`).innerHTML = "";
    return;
  }
  const visible = state.showAll ? items : items.slice(0, TOP_N);
  tbody.innerHTML = visible.map(rowFn).join("");

  const moreEl = document.getElementById(`st-${key}-more`);
  if (items.length > TOP_N) {
    moreEl.innerHTML = `<button class="btn btn-ghost btn-sm" id="st-more-${key}-btn">${state.showAll ? `Mostra solo le prime ${TOP_N}` : `Mostra tutte le ${items.length} righe`}</button>`;
    document.getElementById(`st-more-${key}-btn`).addEventListener("click", () => {
      state.showAll = !state.showAll;
      renderContent();
    });
  } else {
    moreEl.innerHTML = "";
  }
}

function renderComuniSection(items) {
  const state = sectionState.comuni;
  const body = document.getElementById("st-comuni-body-wrap");
  const toggleBtn = document.getElementById("st-toggle-comuni");
  body.style.display = state.collapsed ? "none" : "block";
  toggleBtn.textContent = state.collapsed ? "▸ Espandi" : "▾ Comprimi";
  toggleBtn.classList.toggle("btn-ghost", !state.collapsed);
  if (state.collapsed) return;

  const listEl = document.getElementById("st-comuni-list");
  if (!items.length) {
    listEl.innerHTML = `<div class="empty-state">Nessun articolo è ancora in assortimento attivo per più di un gruppo.</div>`;
    document.getElementById("st-comuni-more").innerHTML = "";
    return;
  }
  const visible = state.showAll ? items : items.slice(0, TOP_N);
  listEl.innerHTML = visible.map(item => {
    const art = articoloById(item.articolo_id);
    return `<details style="margin-bottom:8px;border:1px solid var(--border-color);border-radius:8px;padding:8px 12px">
      <summary style="cursor:pointer;font-size:0.85rem">
        <strong>${escapeHtml(art?.descrizione || "—")}</strong>
        — in assortimento presso <strong>${item.gruppi.length}</strong> gruppi, fatturato totale ${money(item.valoreTotale)}
      </summary>
      <div style="overflow-x:auto;margin-top:10px">
        <table class="desktop-table">
          <thead><tr><th>Gruppo</th><th style="text-align:right">Quantità</th><th style="text-align:right">Valore</th><th style="text-align:right">Margine €</th><th style="text-align:right">Margine %</th></tr></thead>
          <tbody>
            ${item.gruppi.map(g => `<tr>
              <td>${escapeHtml(gruppoById(g.gruppo_id)?.nome || "—")}</td>
              <td style="text-align:right">${number(g.quantita)}</td>
              <td style="text-align:right" class="amount">${money(g.valore_euro)}</td>
              <td style="text-align:right" class="amount">${money(g.margine_valore)}</td>
              <td style="text-align:right">${g.valore_euro ? percent(g.marginePct) : "—"}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </details>`;
  }).join("");

  const moreEl = document.getElementById("st-comuni-more");
  if (items.length > TOP_N) {
    moreEl.innerHTML = `<button class="btn btn-ghost btn-sm" id="st-more-comuni-btn">${state.showAll ? `Mostra solo i primi ${TOP_N}` : `Mostra tutti i ${items.length} articoli`}</button>`;
    document.getElementById("st-more-comuni-btn").addEventListener("click", () => {
      state.showAll = !state.showAll;
      renderContent();
    });
  } else {
    moreEl.innerHTML = "";
  }
}

function renderContent() {
  const rows = filteredVendite();

  const totaleValore = rows.reduce((s, v) => s + Number(v.valore_euro || 0), 0);
  const totaleQuantita = rows.reduce((s, v) => s + Number(v.quantita || 0), 0);
  const totaleCosto = rows.reduce((s, v) => s + Number(v.costo_acquisto || 0), 0);
  const totaleMargine = rows.reduce((s, v) => s + Number(v.margine_valore || 0), 0);
  const margineMedioPct = totaleValore ? (totaleMargine / totaleValore) * 100 : 0;
  const gruppiCoinvolti = new Set(rows.map(v => v.gruppo_id)).size;

  // Incidenza sul fatturato di tutti i gruppi nello stesso periodo/categoria
  // (ignora il filtro gruppo/PdV apposta: senza confronto con tutti gli
  // altri, "quota" non vorrebbe dire nulla).
  const totaleGlobale = filteredVenditeIgnorandoGruppo().reduce((s, v) => s + Number(v.valore_euro || 0), 0);
  const incidenzaPct = totaleGlobale ? (totaleValore / totaleGlobale) * 100 : 0;

  document.getElementById("st-kpi-valore").textContent = money(totaleValore);
  document.getElementById("st-kpi-incidenza").textContent = `${percent(incidenzaPct)} del fatturato di tutti i gruppi`;
  document.getElementById("st-kpi-quantita").textContent = number(totaleQuantita);
  document.getElementById("st-kpi-gruppi").textContent = gruppiCoinvolti;
  document.getElementById("st-kpi-righe").textContent = number(rows.length);
  document.getElementById("st-kpi-costo").textContent = money(totaleCosto);
  document.getElementById("st-kpi-margine").textContent = money(totaleMargine);
  document.getElementById("st-kpi-margine-pct").textContent = margineMedioPct.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";

  // Fatturato per anno. Non per mese: molti import hanno il totale annuale
  // accorpato su un'unica data (in mancanza del dettaglio mese per mese),
  // quindi un trend mensile mostrerebbe un andamento inventato. Per anno
  // resta corretto qualunque sia il livello di dettaglio dei dati importati.
  const byYear = new Map();
  rows.forEach(v => {
    const anno = new Date(v.periodo).getFullYear();
    byYear.set(anno, (byYear.get(anno) || 0) + Number(v.valore_euro || 0));
  });
  const anni = [...byYear.keys()].sort();
  document.getElementById("st-trend-chart").innerHTML = anni.length
    ? barChartVertical({ labels: anni.map(String), series: [{ label: "Fatturato", values: anni.map(a => byYear.get(a)), color: "var(--accent-blue)" }], formatValue: v => money(v) })
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
    ? barChartVertical({ labels: catLabels, series: [{ label: "Fatturato", values: catLabels.map(c => byCategoria.get(c)), color: "var(--accent-blue)" }], formatValue: v => money(v) })
    : `<div class="empty-state">Nessun dato per categoria.</div>`;

  // Tabella: aggregata per gruppo+articolo (quanto vale un articolo nel suo
  // complesso, non riga per riga per punto vendita).
  const f = filters();
  const pdvSelezionato = f.puntoVendita ? getState().puntiVendita.find(p => String(p.id) === f.puntoVendita) : null;
  document.getElementById("st-table-title").textContent = pdvSelezionato
    ? `Venduto per articolo — ${pdvSelezionato.nome_insegna}`
    : "Venduto per gruppo e articolo";

  lastAggregatedArticolo = aggregateByArticolo(rows);
  lastAggregatedPdv = aggregateByPuntoVendita(rows);

  renderSection("articolo", "st-table-body", lastAggregatedArticolo, g => {
    const gruppo = gruppoById(g.gruppo_id);
    const art = articoloById(g.articolo_id);
    const marginePct = g.valore_euro ? (g.margine_valore / g.valore_euro) * 100 : 0;
    return `<tr>
      <td>${escapeHtml(gruppo?.nome || "—")}</td>
      <td>${escapeHtml(art?.descrizione || "—")}</td>
      <td class="text-muted">${escapeHtml(art?.codice || "—")}</td>
      <td class="text-muted">${escapeHtml(art ? CATEGORIE_ARTICOLO[art.categoria] || art.categoria : "—")}</td>
      <td style="text-align:right">${g.puntiVendita.size || "—"}</td>
      <td style="text-align:right">${number(g.quantita)}</td>
      <td style="text-align:right" class="amount">${money(g.valore_euro)}</td>
      <td style="text-align:right" class="amount">${money(g.costo_acquisto)}</td>
      <td style="text-align:right" class="amount">${money(g.margine_valore)}</td>
      <td style="text-align:right">${percent(marginePct)}</td>
    </tr>`;
  }, 10);

  renderSection("pdv", "st-table-pdv-body", lastAggregatedPdv, g => {
    const gruppo = gruppoById(g.gruppo_id);
    const pdv = g.punto_vendita_id != null ? getState().puntiVendita.find(p => String(p.id) === String(g.punto_vendita_id)) : null;
    const marginePct = g.valore_euro ? (g.margine_valore / g.valore_euro) * 100 : 0;
    return `<tr>
      <td>${escapeHtml(gruppo?.nome || "—")}</td>
      <td>${escapeHtml(pdv?.nome_insegna || "Aggregato gruppo")}</td>
      <td style="text-align:right">${g.articoli.size || "—"}</td>
      <td style="text-align:right">${number(g.quantita)}</td>
      <td style="text-align:right" class="amount">${money(g.valore_euro)}</td>
      <td style="text-align:right" class="amount">${money(g.costo_acquisto)}</td>
      <td style="text-align:right" class="amount">${money(g.margine_valore)}</td>
      <td style="text-align:right">${percent(marginePct)}</td>
    </tr>`;
  }, 8);

  lastAggregatedAgente = aggregateByAgente(rows);
  renderSection("agente", "st-table-agente-body", lastAggregatedAgente, g => {
    const marginePct = g.valore_euro ? (g.margine_valore / g.valore_euro) * 100 : 0;
    const mediaPdv = g.puntiVendita.size ? g.valore_euro / g.puntiVendita.size : 0;
    const nome = agenteNome(g.agente_id);
    return `<tr>
      <td>${nome ? `<strong>${escapeHtml(nome)}</strong>` : `<span class="text-red">Senza agente</span>`}</td>
      <td class="text-muted">${escapeHtml(g.agente_id != null ? agenteById(g.agente_id)?.zona || "—" : "—")}</td>
      <td style="text-align:right">${g.puntiVendita.size || "—"}</td>
      <td style="text-align:right" class="amount">${money(mediaPdv)}</td>
      <td style="text-align:right">${number(g.quantita)}</td>
      <td style="text-align:right" class="amount">${money(g.valore_euro)}</td>
      <td style="text-align:right" class="amount">${money(g.costo_acquisto)}</td>
      <td style="text-align:right" class="amount">${money(g.margine_valore)}</td>
      <td style="text-align:right">${percent(marginePct)}</td>
    </tr>`;
  }, 9);

  renderComuniSection(articoliComuniTraGruppi(getState().assortimenti, filteredVenditeIgnorandoGruppo()));
}

export function render() {
  const container = document.getElementById("statistiche-content");
  if (!container) return;

  const gruppi = [...getState().gruppi].sort((a, b) => a.nome.localeCompare(b.nome));

  container.innerHTML = `
    <div class="card">
      <div class="filter-bar">
        <select id="st-filter-gruppo"><option value="">Tutti i gruppi</option>${gruppi.map(g => `<option value="${g.id}">${escapeHtml(g.nome)}</option>`).join("")}</select>
        <select id="st-filter-pdv" disabled><option value="">Seleziona un gruppo per filtrare il punto vendita</option></select>
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
          <div class="kpi-sub" id="st-kpi-incidenza"></div>
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
        <div class="kpi-card">
          <div class="kpi-title">Costo di acquisto</div>
          <div class="kpi-value" id="st-kpi-costo">€ 0,00</div>
        </div>
        <div class="kpi-card green">
          <div class="kpi-title">Margine %</div>
          <div class="kpi-value" id="st-kpi-margine-pct">0,0%</div>
          <div class="kpi-sub"><span id="st-kpi-margine">€ 0,00</span> di margine sul periodo</div>
        </div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <h2>Fatturato per anno</h2>
        <div id="st-trend-chart"></div>
      </div>
      <div class="card">
        <h2>Fatturato per categoria di prodotto</h2>
        <div id="st-categoria-chart"></div>
      </div>
    </div>
    <div class="card">
      <h2>
        <span id="st-table-title">Venduto per gruppo e articolo</span>
        <span style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" id="st-export-articolo">⇩ Esporta CSV</button>
          <button class="btn btn-sm" id="st-toggle-articolo">▸ Espandi</button>
        </span>
      </h2>
      <div id="st-articolo-body-wrap">
        <p class="hint">Aggregato su tutto il periodo filtrato. Seleziona un gruppo e poi un punto vendita specifico per l'analisi di un singolo cliente.</p>
        <div style="overflow-x:auto">
          <table class="desktop-table">
            <thead><tr>
              <th>Gruppo</th><th>Articolo</th><th>Codice</th><th>Categoria</th><th style="text-align:right">PdV</th>
              <th style="text-align:right">Quantità</th><th style="text-align:right">Valore</th>
              <th style="text-align:right">Costo</th><th style="text-align:right">Margine €</th><th style="text-align:right">Margine %</th>
            </tr></thead>
            <tbody id="st-table-body"></tbody>
          </table>
        </div>
        <div id="st-articolo-more" style="margin-top:12px;text-align:center"></div>
      </div>
    </div>
    <div class="card">
      <h2>
        <span>Fatturato per punto vendita</span>
        <span style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" id="st-export-pdv">⇩ Esporta CSV</button>
          <button class="btn btn-sm" id="st-toggle-pdv">▸ Espandi</button>
        </span>
      </h2>
      <div id="st-pdv-body-wrap">
        <p class="hint">Chi fattura di più, a parità di filtri applicati sopra.</p>
        <div style="overflow-x:auto">
          <table class="desktop-table">
            <thead><tr>
              <th>Gruppo</th><th>Punto vendita</th><th style="text-align:right">Articoli</th>
              <th style="text-align:right">Quantità</th><th style="text-align:right">Valore</th>
              <th style="text-align:right">Costo</th><th style="text-align:right">Margine €</th><th style="text-align:right">Margine %</th>
            </tr></thead>
            <tbody id="st-table-pdv-body"></tbody>
          </table>
        </div>
        <div id="st-pdv-more" style="margin-top:12px;text-align:center"></div>
      </div>
    </div>
    <div class="card">
      <h2>
        <span>Venduto per agente</span>
        <span style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" id="st-export-agente">⇩ Esporta CSV</button>
          <button class="btn btn-sm" id="st-toggle-agente">▸ Espandi</button>
        </span>
      </h2>
      <div id="st-agente-body-wrap">
        <p class="hint">Chi porta più fatturato, non solo a quanti punti vendita è assegnato. "Fatturato medio/PdV" aiuta a confrontare chi segue pochi clienti grandi con chi ne segue tanti piccoli.</p>
        <div style="overflow-x:auto">
          <table class="desktop-table">
            <thead><tr>
              <th>Agente</th><th>Zona</th><th style="text-align:right">PdV attivi</th><th style="text-align:right">Fatturato medio/PdV</th>
              <th style="text-align:right">Quantità</th><th style="text-align:right">Valore</th>
              <th style="text-align:right">Costo</th><th style="text-align:right">Margine €</th><th style="text-align:right">Margine %</th>
            </tr></thead>
            <tbody id="st-table-agente-body"></tbody>
          </table>
        </div>
        <div id="st-agente-more" style="margin-top:12px;text-align:center"></div>
      </div>
    </div>
    <div class="card">
      <h2>
        <span>Confronto tra gruppi sugli articoli in comune</span>
        <button class="btn btn-sm" id="st-toggle-comuni">▸ Espandi</button>
      </h2>
      <div id="st-comuni-body-wrap">
        <p class="hint">Articoli attivi nell'assortimento di più gruppi: chi li vende di più e a che margine, sullo stesso periodo/categoria filtrati sopra (il filtro gruppo/punto vendita non si applica qui, altrimenti il confronto non avrebbe senso).</p>
        <div id="st-comuni-list"></div>
        <div id="st-comuni-more" style="margin-top:12px;text-align:center"></div>
      </div>
    </div>`;

  document.getElementById("st-export-articolo").addEventListener("click", exportArticoloCsv);
  document.getElementById("st-export-pdv").addEventListener("click", exportPdvCsv);
  document.getElementById("st-export-agente").addEventListener("click", exportAgenteCsv);

  document.getElementById("st-toggle-articolo").addEventListener("click", () => {
    sectionState.articolo.collapsed = !sectionState.articolo.collapsed;
    renderContent();
  });
  document.getElementById("st-toggle-pdv").addEventListener("click", () => {
    sectionState.pdv.collapsed = !sectionState.pdv.collapsed;
    renderContent();
  });
  document.getElementById("st-toggle-agente").addEventListener("click", () => {
    sectionState.agente.collapsed = !sectionState.agente.collapsed;
    renderContent();
  });
  document.getElementById("st-toggle-comuni").addEventListener("click", () => {
    sectionState.comuni.collapsed = !sectionState.comuni.collapsed;
    renderContent();
  });

  document.getElementById("st-filter-gruppo").addEventListener("change", () => {
    populatePdvFilter();
    renderContent();
  });
  ["st-filter-pdv", "st-filter-categoria", "st-filter-da", "st-filter-a"].forEach(id => {
    document.getElementById(id).addEventListener("change", renderContent);
  });
  populatePdvFilter();
  renderContent();
}
