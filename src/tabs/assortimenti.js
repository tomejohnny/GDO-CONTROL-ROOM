import { getState, loadAll, gruppoById, articoloById } from "../lib/store.js";
import { insertRow, updateRow, deleteRow, deleteRows } from "../lib/db.js";
import { escapeHtml, statoBadge, STATO_ASSORTIMENTO, CATEGORIE_ARTICOLO, formatDate, money } from "../lib/format.js";
import { openModal, closeModal } from "../lib/modal.js";
import { toast, toastError } from "../lib/ui.js";
import { notifyDataChanged } from "../lib/bus.js";
import { confirmDialog } from "../lib/confirm.js";
import { downloadCsv } from "../lib/export.js";
import { assortimentiSenzaVendite, venditeSenzaAssortimento, coperturaAssortimentoPerPdv } from "../lib/analytics.js";
import { normalizeCodice } from "../lib/import-engine.js";
import { isReadOnly } from "../lib/permissions.js";

let editingArticoloId = null;
let selectedGruppoMain = null;
let cmpGruppoA = null;
let cmpGruppoB = null;
let activeAssortSubtab = "as-tab-gruppo";

// ============================================================= CATALOGO ===

function articoloRow(a) {
  return `<tr>
    <td><strong>${escapeHtml(a.descrizione)}</strong>${a.codice ? ` <span class="text-muted">(${escapeHtml(a.codice)})</span>` : ""}</td>
    <td>${escapeHtml(CATEGORIE_ARTICOLO[a.categoria] || a.categoria)}</td>
    <td>${escapeHtml(a.unita_misura || "—")}</td>
    <td>${a.attivo === false ? `<span class="badge" style="background:var(--text-muted)">Non attivo</span>` : `<span class="badge" style="background:var(--accent-green)">Attivo</span>`}</td>
    <td style="text-align:center">
      <button class="btn btn-ghost btn-sm rw-only" data-art-edit="${a.id}">Modifica</button>
      <button class="btn btn-red btn-sm rw-only" data-art-delete="${a.id}">Elimina</button>
    </td>
  </tr>`;
}

function wireArticoloActions(root) {
  root.querySelectorAll("[data-art-edit]").forEach(el => el.addEventListener("click", () => openArticoloModal(el.dataset.artEdit)));
  root.querySelectorAll("[data-art-delete]").forEach(el => el.addEventListener("click", () => onDeleteArticolo(el.dataset.artDelete)));
}

function openArticoloModal(id) {
  const a = id ? getState().articoli.find(r => String(r.id) === String(id)) : null;
  editingArticoloId = a?.id ?? null;
  document.getElementById("articolo-modal-title").textContent = a ? "Modifica articolo" : "Nuovo articolo";
  document.getElementById("ar-descrizione").value = a?.descrizione || "";
  document.getElementById("ar-codice").value = a?.codice || "";
  document.getElementById("ar-um").value = a?.unita_misura || "";
  document.getElementById("ar-categoria").value = a?.categoria || "formaggi";
  document.getElementById("ar-attivo").checked = a ? a.attivo !== false : true;
  openModal("articoloModal");
}

async function onDeleteArticolo(id) {
  if (!(await confirmDialog("Eliminare questo articolo dal catalogo? Verranno rimossi anche gli assortimenti collegati."))) return;
  try {
    await deleteRow("articoli", id);
    await loadAll();
    notifyDataChanged();
    toast("Articolo eliminato");
  } catch (err) {
    toastError(err);
  }
}

async function onSubmitArticolo(event) {
  event.preventDefault();
  const payload = {
    descrizione: document.getElementById("ar-descrizione").value.trim(),
    codice: document.getElementById("ar-codice").value.trim() || null,
    unita_misura: document.getElementById("ar-um").value.trim() || null,
    categoria: document.getElementById("ar-categoria").value,
    attivo: document.getElementById("ar-attivo").checked,
  };
  if (!payload.descrizione) {
    toast("Inserisci la descrizione dell'articolo.", "error");
    return;
  }
  const submitBtn = event.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    if (editingArticoloId) await updateRow("articoli", editingArticoloId, payload);
    else await insertRow("articoli", payload);
    closeModal("articoloModal");
    await loadAll();
    notifyDataChanged();
    toast("Articolo salvato", "success");
  } catch (err) {
    toastError(err);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// Chiave per trovare articoli duplicati a catalogo: il confronto e' sul
// CODICE articolo (ignorando solo differenze innocue come zeri iniziali
// persi da Excel), non sulla descrizione. Due codici che differiscono per
// altro — es. uno "T" finale — sono ordinativi distinti nel gestionale
// anche se la descrizione testuale coincide, quindi vanno lasciati separati.
function duplicatiArticoli() {
  const byKey = new Map();
  getState().articoli.forEach(a => {
    if (!a.codice) return;
    const key = normalizeCodice(a.codice);
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(a);
  });
  return [...byKey.values()].filter(group => group.length > 1).sort((a, b) => b.length - a.length);
}

// Unisce piu' articoli-duplicati in uno solo: gli assortimenti dei gruppi
// che hanno gia' il canonico vengono scartati (altrimenti violerebbero il
// vincolo unique gruppo+articolo), gli altri spostati sul canonico; le
// vendite vengono sempre spostate; gli articoli duplicati infine eliminati.
async function mergeArticoli(canonicalId, duplicateIds) {
  const { assortimenti, vendite } = getState();
  const gruppiConCanonico = new Set(assortimenti.filter(a => String(a.articolo_id) === String(canonicalId)).map(a => String(a.gruppo_id)));
  for (const dupId of duplicateIds) {
    const rows = assortimenti.filter(a => String(a.articolo_id) === String(dupId));
    for (const row of rows) {
      if (gruppiConCanonico.has(String(row.gruppo_id))) {
        await deleteRow("assortimenti", row.id);
      } else {
        await updateRow("assortimenti", row.id, { articolo_id: Number(canonicalId) });
        gruppiConCanonico.add(String(row.gruppo_id));
      }
    }
  }
  const dupIdSet = new Set(duplicateIds.map(String));
  const venditeDaSpostare = vendite.filter(v => dupIdSet.has(String(v.articolo_id)));
  for (const v of venditeDaSpostare) {
    await updateRow("vendite", v.id, { articolo_id: Number(canonicalId) });
  }
  await deleteRows("articoli", duplicateIds.map(Number));
}

function renderDuplicatiArticoli() {
  const card = document.getElementById("as-dup-card");
  if (!card) return;
  const groups = duplicatiArticoli();
  if (!groups.length) {
    card.style.display = "none";
    return;
  }
  card.style.display = "";
  document.getElementById("as-dup-count").textContent = groups.length;
  document.getElementById("as-dup-list").innerHTML = groups.map((group, gi) => {
    const sorted = [...group].sort((a, b) => a.id - b.id);
    return `<details style="margin-bottom:8px;border:1px solid var(--border-color);border-radius:8px;padding:8px 12px">
      <summary style="cursor:pointer;font-size:0.85rem"><strong>${escapeHtml(sorted[0].descrizione)}</strong> — ${sorted.length} varianti a catalogo</summary>
      <div style="overflow-x:auto;margin-top:10px">
        <table class="desktop-table">
          <thead><tr><th>Canonico</th><th>Descrizione</th><th>Codice</th><th>Categoria</th></tr></thead>
          <tbody>
            ${sorted.map(a => `<tr>
              <td style="text-align:center"><input type="radio" name="as-dup-canon-${gi}" value="${a.id}" ${a.id === sorted[0].id ? "checked" : ""}></td>
              <td>${escapeHtml(a.descrizione)}</td>
              <td class="text-muted">${escapeHtml(a.codice || "—")}</td>
              <td>${escapeHtml(CATEGORIE_ARTICOLO[a.categoria] || a.categoria)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <button class="btn btn-sm" data-dup-merge="${gi}" style="margin-top:8px">Unisci in uno</button>
    </details>`;
  }).join("");

  groups.forEach((group, gi) => {
    document.querySelector(`[data-dup-merge="${gi}"]`)?.addEventListener("click", async () => {
      const canonId = document.querySelector(`input[name="as-dup-canon-${gi}"]:checked`)?.value;
      if (!canonId) return;
      const dupIds = group.map(a => a.id).filter(id => String(id) !== String(canonId));
      if (!(await confirmDialog(`Unire ${group.length} articoli in uno solo? Gli assortimenti e le vendite collegate verranno spostati su quello scelto, gli altri eliminati dal catalogo. Non è reversibile.`))) return;
      try {
        await mergeArticoli(canonId, dupIds);
        await loadAll();
        notifyDataChanged();
        toast("Articoli uniti", "success");
      } catch (err) {
        toastError(err);
      }
    });
  });
}

// ========================================================= VISTA GLOBALE ===

// Righe la cui gruppo_id non risolve a nessun gruppo GDO esistente in stato:
// un refuso di import (gruppo con nome/spazi imprevisti finito su un altro
// record, o un vecchio residuo). Non dovrebbero mai esserci vista la foreign
// key sul database, quindi qui e' solo un modo per scovarle e ripulirle.
function senzaGruppoRows() {
  return getState().assortimenti.filter(row => !gruppoById(row.gruppo_id));
}

function renderSenzaGruppo() {
  const card = document.getElementById("as-senza-gruppo-card");
  if (!card) return;
  const rows = senzaGruppoRows();
  if (!rows.length) {
    card.style.display = "none";
    return;
  }
  card.style.display = "";
  document.getElementById("as-senza-gruppo-count").textContent = rows.length;
  document.getElementById("as-senza-gruppo-body").innerHTML = rows.slice(0, 50).map(row => {
    const articolo = articoloById(row.articolo_id);
    return `<tr>
      <td class="text-muted">${escapeHtml(String(row.gruppo_id ?? "null"))}</td>
      <td>${escapeHtml(articolo?.descrizione || "—")}</td>
      <td>${statoBadge(STATO_ASSORTIMENTO, row.stato)}</td>
      <td style="text-align:center"><button class="btn btn-red btn-sm" data-as-delete="${row.id}">Elimina</button></td>
    </tr>`;
  }).join("");
  document.getElementById("as-senza-gruppo-more").textContent = rows.length > 50 ? `e altre ${rows.length - 50}.` : "";
  card.querySelectorAll("[data-as-delete]").forEach(el => el.addEventListener("click", () => onDeleteAssortimento(el.dataset.asDelete)));
}

async function onDeleteAllSenzaGruppo() {
  const rows = senzaGruppoRows();
  if (!rows.length) return;
  if (!(await confirmDialog(`Eliminare tutte le ${rows.length} righe senza un gruppo riconosciuto? L'operazione non è reversibile.`))) return;
  try {
    await deleteRows("assortimenti", rows.map(r => r.id));
    await loadAll();
    notifyDataChanged();
    toast(`${rows.length} righe eliminate`, "success");
  } catch (err) {
    toastError(err);
  }
}

function globalFilters() {
  return {
    search: (document.getElementById("as-g-search")?.value || "").trim().toLowerCase(),
    gruppo: document.getElementById("as-g-filter-gruppo")?.value || "",
    stato: document.getElementById("as-g-filter-stato")?.value || "",
    categoria: document.getElementById("as-g-filter-categoria")?.value || "",
  };
}

function globalFilteredRows() {
  const f = globalFilters();
  return getState().assortimenti
    .filter(row => {
      const articolo = articoloById(row.articolo_id);
      if (f.gruppo && String(row.gruppo_id) !== f.gruppo) return false;
      if (f.stato && row.stato !== f.stato) return false;
      if (f.categoria && articolo?.categoria !== f.categoria) return false;
      const gruppo = gruppoById(row.gruppo_id);
      if (f.search && !`${articolo?.descrizione || ""} ${gruppo?.nome || ""}`.toLowerCase().includes(f.search)) return false;
      return true;
    })
    .sort((a, b) => {
      const gruppoCmp = (gruppoById(a.gruppo_id)?.nome || "").localeCompare(gruppoById(b.gruppo_id)?.nome || "");
      if (gruppoCmp) return gruppoCmp;
      return (articoloById(a.articolo_id)?.descrizione || "").localeCompare(articoloById(b.articolo_id)?.descrizione || "");
    });
}

function renderGlobalTable() {
  const tbody = document.getElementById("as-g-table-body");
  if (!tbody) return;
  const rows = globalFilteredRows();

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Nessun assortimento trovato con questi filtri.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const gruppo = gruppoById(row.gruppo_id);
    const articolo = articoloById(row.articolo_id);
    return `<tr>
      <td>${escapeHtml(gruppo?.nome || "—")}</td>
      <td>${escapeHtml(articolo?.descrizione || "—")}</td>
      <td class="text-muted">${escapeHtml(articolo?.codice || "—")}</td>
      <td>${statoBadge(STATO_ASSORTIMENTO, row.stato)}</td>
      <td>${formatDate(row.data_inizio)}</td>
      <td style="text-align:center"><button class="btn btn-red btn-sm rw-only" data-as-delete="${row.id}">Elimina</button></td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-as-delete]").forEach(el => el.addEventListener("click", () => onDeleteAssortimento(el.dataset.asDelete)));
}

function exportGlobalCsv() {
  const rows = globalFilteredRows();
  const headers = ["Gruppo", "Articolo", "Codice", "Categoria", "Stato", "Data inizio"];
  const data = rows.map(row => {
    const gruppo = gruppoById(row.gruppo_id);
    const articolo = articoloById(row.articolo_id);
    return [gruppo?.nome || "", articolo?.descrizione || "", articolo?.codice || "", articolo ? CATEGORIE_ARTICOLO[articolo.categoria] || articolo.categoria : "", STATO_ASSORTIMENTO[row.stato]?.label || row.stato, row.data_inizio || ""];
  });
  downloadCsv("assortimenti.csv", headers, data);
}

function renderDisallineamenti() {
  const { assortimenti, vendite } = getState();

  const senzaVendite = assortimentiSenzaVendite(assortimenti, vendite);
  const elA = document.getElementById("as-senza-vendite");
  elA.innerHTML = senzaVendite.length ? `
    <table class="desktop-table">
      <thead><tr><th>Gruppo</th><th>Articolo</th><th>Codice</th></tr></thead>
      <tbody>
        ${senzaVendite.slice(0, 20).map(a => {
          const articolo = articoloById(a.articolo_id);
          return `<tr>
            <td>${escapeHtml(gruppoById(a.gruppo_id)?.nome || "—")}</td>
            <td>${escapeHtml(articolo?.descrizione || "—")}</td>
            <td class="text-muted">${escapeHtml(articolo?.codice || "—")}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    ${senzaVendite.length > 20 ? `<p class="hint" style="margin-top:8px;margin-bottom:0">e altri ${senzaVendite.length - 20}.</p>` : ""}
  ` : `<div class="empty-state">Nessun disallineamento: tutti gli assortimenti attivi hanno vendite registrate.</div>`;

  const senzaAssortimento = venditeSenzaAssortimento(vendite, assortimenti);
  const elB = document.getElementById("as-senza-assortimento");
  elB.innerHTML = senzaAssortimento.length ? `
    <table class="desktop-table">
      <thead><tr><th>Gruppo</th><th>Articolo</th><th>Codice</th><th style="text-align:right">Valore</th></tr></thead>
      <tbody>
        ${senzaAssortimento.slice(0, 20).map(v => {
          const articolo = articoloById(v.articolo_id);
          return `<tr>
            <td>${escapeHtml(gruppoById(v.gruppo_id)?.nome || "—")}</td>
            <td>${escapeHtml(articolo?.descrizione || "—")}</td>
            <td class="text-muted">${escapeHtml(articolo?.codice || "—")}</td>
            <td style="text-align:right" class="amount">${money(v.valore_euro)}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    ${senzaAssortimento.length > 20 ? `<p class="hint" style="margin-top:8px;margin-bottom:0">e altri ${senzaAssortimento.length - 20}.</p>` : ""}
  ` : `<div class="empty-state">Nessun venduto fuori dall'assortimento tracciato.</div>`;
}

async function onDeleteAssortimento(id) {
  if (!(await confirmDialog("Rimuovere questo assortimento?"))) return;
  try {
    await deleteRow("assortimenti", id);
    await loadAll();
    notifyDataChanged();
    toast("Assortimento rimosso");
  } catch (err) {
    toastError(err);
  }
}

function switchAssortSubview(container, id) {
  activeAssortSubtab = id;
  container.querySelectorAll(".subtab-btn").forEach(b => b.classList.toggle("active", b.dataset.subview === id));
  container.querySelectorAll(".subview").forEach(v => v.classList.toggle("active", v.id === id));
}

export function render() {
  const container = document.getElementById("assortimenti-content");
  if (!container) return;

  const gruppi = [...getState().gruppi].sort((a, b) => a.nome.localeCompare(b.nome));
  container.innerHTML = `
    <div class="card">
      <div class="subtabs">
        <button class="subtab-btn ${activeAssortSubtab === "as-tab-gruppo" ? "active" : ""}" data-subview="as-tab-gruppo">Per gruppo</button>
        <button class="subtab-btn ${activeAssortSubtab === "as-tab-confronto" ? "active" : ""}" data-subview="as-tab-confronto">Confronta gruppi</button>
        <button class="subtab-btn ${activeAssortSubtab === "as-tab-ricerca" ? "active" : ""}" data-subview="as-tab-ricerca">Ricerca globale</button>
        <button class="subtab-btn ${activeAssortSubtab === "as-tab-dati" ? "active" : ""}" data-subview="as-tab-dati">Dati &amp; catalogo<span id="as-tab-dati-badge"></span></button>
      </div>

      <div id="as-tab-gruppo" class="subview ${activeAssortSubtab === "as-tab-gruppo" ? "active" : ""}">
        <p class="hint">Seleziona un gruppo per vedere, modificare e integrare il suo assortimento senza dover passare dalla scheda del gruppo.</p>
        <div class="filter-bar">
          <select id="as-sel-gruppo">${gruppi.map(g => `<option value="${g.id}" ${String(g.id) === String(selectedGruppoMain) ? "selected" : ""}>${escapeHtml(g.nome)}</option>`).join("")}</select>
          <button class="btn btn-sm rw-only" id="as-sel-add">+ Aggiungi articolo</button>
        </div>
        <div style="overflow-x:auto">
          <table class="desktop-table">
            <thead><tr><th>Articolo</th><th>Codice</th><th>Categoria</th><th>Stato</th><th>Data inizio</th><th>Note</th><th style="text-align:center">Azioni</th></tr></thead>
            <tbody id="as-sel-table-body"></tbody>
          </table>
        </div>
      </div>

      <div id="as-tab-confronto" class="subview ${activeAssortSubtab === "as-tab-confronto" ? "active" : ""}">
        <p class="hint">Articoli attivi in comune tra due gruppi, e quelli tenuti solo dall'uno o dall'altro — utile per proporre a un gruppo quello che un cliente simile già acquista.</p>
        <div class="filter-bar">
          <select id="as-cmp-a"></select>
          <span class="text-muted">vs</span>
          <select id="as-cmp-b"></select>
        </div>
        <div id="as-cmp-result"></div>
      </div>

      <div id="as-tab-ricerca" class="subview ${activeAssortSubtab === "as-tab-ricerca" ? "active" : ""}">
        <h2>
          <span>Assortimenti — vista trasversale</span>
          <button class="btn btn-ghost btn-sm" id="as-g-export">⇩ Esporta CSV</button>
        </h2>
        <p class="hint">Quali articoli sono in assortimento per ciascun gruppo GDO, e a che punto sono le proposte in corso.</p>
        <div class="filter-bar">
          <input id="as-g-search" placeholder="Cerca articolo o gruppo">
          <select id="as-g-filter-gruppo"><option value="">Tutti i gruppi</option>${gruppi.map(g => `<option value="${g.id}">${escapeHtml(g.nome)}</option>`).join("")}</select>
          <select id="as-g-filter-categoria">
            <option value="">Tutte le categorie</option>
            ${Object.entries(CATEGORIE_ARTICOLO).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
          </select>
          <select id="as-g-filter-stato">
            <option value="">Tutti gli stati</option>
            <option value="attivo">Attivo</option>
            <option value="proposto">Proposto</option>
            <option value="in_trattativa">In trattativa</option>
            <option value="rifiutato">Rifiutato</option>
            <option value="sospeso">Sospeso</option>
          </select>
        </div>
        <div style="overflow-x:auto">
          <table class="desktop-table">
            <thead><tr><th>Gruppo</th><th>Articolo</th><th>Codice</th><th>Stato</th><th>Data inizio</th><th style="text-align:center">Azioni</th></tr></thead>
            <tbody id="as-g-table-body"></tbody>
          </table>
        </div>
      </div>

      <div id="as-tab-dati" class="subview ${activeAssortSubtab === "as-tab-dati" ? "active" : ""}">
        <div id="as-senza-gruppo-card" class="rw-only" style="display:none;border:1px solid var(--accent-red);border-radius:10px;padding:14px;margin-bottom:16px">
          <h2 style="border:none;padding-bottom:0;margin-bottom:8px">
            <span>⚠ Righe con gruppo non riconosciuto (<span id="as-senza-gruppo-count">0</span>)</span>
            <button class="btn btn-red btn-sm" id="as-senza-gruppo-delete-all">Elimina tutte</button>
          </h2>
          <p class="hint">Queste righe di assortimento puntano a un gruppo GDO che non esiste più (nome cambiato, gruppo eliminato, o un refuso di import). Controlla se sono da eliminare o se manca solo un gruppo da ricreare.</p>
          <div style="overflow-x:auto">
            <table class="desktop-table">
              <thead><tr><th>ID gruppo grezzo</th><th>Articolo</th><th>Stato</th><th style="text-align:center">Azioni</th></tr></thead>
              <tbody id="as-senza-gruppo-body"></tbody>
            </table>
          </div>
          <p class="hint" id="as-senza-gruppo-more" style="margin-top:8px;margin-bottom:0"></p>
        </div>

        <div id="as-dup-card" class="rw-only" style="display:none;margin-bottom:16px">
          <h2 style="border:none;padding-bottom:0;margin-bottom:8px">⚠ Possibili articoli duplicati a catalogo (<span id="as-dup-count">0</span>)</h2>
          <p class="hint">Stesso prodotto importato più volte con piccole differenze (maiuscole, zero iniziale sul codice, marcatore "(P)"). Scegli quale versione tenere e unisci le altre: assortimenti e vendite vengono spostati automaticamente su quella scelta.</p>
          <div id="as-dup-list"></div>
        </div>

        <div class="grid-2">
          <div>
            <h2 style="border:none;padding-bottom:0;margin-bottom:8px">Assortimento senza venduto</h2>
            <p class="hint">Articoli "attivo" nell'assortimento di un gruppo, ma senza nessuna vendita registrata su nessun suo punto vendita — possibile disallineamento.</p>
            <div id="as-senza-vendite"></div>
          </div>
          <div>
            <h2 style="border:none;padding-bottom:0;margin-bottom:8px">Venduto non tracciato in assortimento</h2>
            <p class="hint">Vendite reali su combinazioni gruppo + articolo che non risultano in nessun assortimento.</p>
            <div id="as-senza-assortimento"></div>
          </div>
        </div>

        <details style="margin-top:16px">
          <summary style="cursor:pointer;font-weight:700;font-size:0.95rem">Catalogo articoli (avanzato)</summary>
          <div style="margin-top:12px">
            <div class="filter-bar" style="justify-content:flex-end">
              <button class="btn btn-sm rw-only" id="as-art-new">+ Nuovo articolo</button>
            </div>
            <div style="overflow-x:auto">
              <table class="desktop-table">
                <thead><tr><th>Articolo</th><th>Categoria</th><th>U.M.</th><th>Stato</th><th style="text-align:center">Azioni</th></tr></thead>
                <tbody id="as-articoli-table-body">${getState().articoli.map(articoloRow).join("") || `<tr><td colspan="5" class="empty-state">Nessun articolo a catalogo. Aggiungine uno per iniziare.</td></tr>`}</tbody>
              </table>
            </div>
          </div>
        </details>
      </div>
    </div>`;

  container.querySelectorAll(".subtab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchAssortSubview(container, btn.dataset.subview));
  });

  wireArticoloActions(container);
  document.getElementById("as-art-new").addEventListener("click", () => openArticoloModal(null));
  document.getElementById("as-g-export").addEventListener("click", exportGlobalCsv);
  document.getElementById("as-senza-gruppo-delete-all").addEventListener("click", onDeleteAllSenzaGruppo);
  ["as-g-search", "as-g-filter-gruppo", "as-g-filter-categoria", "as-g-filter-stato"].forEach(id => {
    document.getElementById(id).addEventListener("input", renderGlobalTable);
    document.getElementById(id).addEventListener("change", renderGlobalTable);
  });

  if (gruppi.length) {
    if (!selectedGruppoMain || !gruppi.some(g => String(g.id) === String(selectedGruppoMain))) selectedGruppoMain = gruppi[0].id;
    const selGruppo = document.getElementById("as-sel-gruppo");
    selGruppo.value = selectedGruppoMain;
    selGruppo.addEventListener("change", () => {
      selectedGruppoMain = selGruppo.value;
      renderAssortimentoGruppoTable(selGruppo.value, "as-sel-table-body");
    });
    document.getElementById("as-sel-add").addEventListener("click", () => openAssortimentoModal(selGruppo.value));
    renderAssortimentoGruppoTable(selGruppo.value, "as-sel-table-body");

    if (!cmpGruppoA || !gruppi.some(g => String(g.id) === String(cmpGruppoA))) cmpGruppoA = gruppi[0].id;
    if (!cmpGruppoB || !gruppi.some(g => String(g.id) === String(cmpGruppoB))) cmpGruppoB = gruppi[1]?.id ?? gruppi[0].id;
    const cmpA = document.getElementById("as-cmp-a");
    const cmpB = document.getElementById("as-cmp-b");
    cmpA.innerHTML = gruppi.map(g => `<option value="${g.id}">${escapeHtml(g.nome)}</option>`).join("");
    cmpB.innerHTML = gruppi.map(g => `<option value="${g.id}">${escapeHtml(g.nome)}</option>`).join("");
    cmpA.value = cmpGruppoA;
    cmpB.value = cmpGruppoB;
    cmpA.addEventListener("change", () => { cmpGruppoA = cmpA.value; renderConfrontoGruppi(cmpA.value, cmpB.value); });
    cmpB.addEventListener("change", () => { cmpGruppoB = cmpB.value; renderConfrontoGruppi(cmpA.value, cmpB.value); });
    renderConfrontoGruppi(cmpA.value, cmpB.value);
  } else {
    document.getElementById("as-sel-table-body").innerHTML = `<tr><td colspan="6" class="empty-state">Crea prima un gruppo GDO.</td></tr>`;
    document.getElementById("as-cmp-result").innerHTML = `<div class="empty-state">Servono almeno due gruppi per confrontarli.</div>`;
  }

  renderGlobalTable();
  renderDisallineamenti();
  renderSenzaGruppo();
  renderDuplicatiArticoli();
  updateDatiBadge();
}

function updateDatiBadge() {
  const badge = document.getElementById("as-tab-dati-badge");
  if (!badge) return;
  const count = senzaGruppoRows().length + duplicatiArticoli().length;
  badge.textContent = count ? ` ⚠ ${count}` : "";
  badge.style.color = count ? "var(--accent-red)" : "";
}

function renderConfrontoGruppi(gruppoAId, gruppoBId) {
  const el = document.getElementById("as-cmp-result");
  if (!el) return;
  if (String(gruppoAId) === String(gruppoBId)) {
    el.innerHTML = `<div class="empty-state">Seleziona due gruppi diversi.</div>`;
    return;
  }
  const { assortimenti } = getState();
  const attiviDi = gruppoId => new Set(assortimenti.filter(a => String(a.gruppo_id) === String(gruppoId) && a.stato === "attivo").map(a => a.articolo_id));
  const setA = attiviDi(gruppoAId);
  const setB = attiviDi(gruppoBId);
  const comuni = [...setA].filter(id => setB.has(id));
  const soloA = [...setA].filter(id => !setB.has(id));
  const soloB = [...setB].filter(id => !setA.has(id));
  const nomeA = gruppoById(gruppoAId)?.nome || "—";
  const nomeB = gruppoById(gruppoBId)?.nome || "—";

  const list = ids => ids.length
    ? `<ul style="margin:0;padding-left:18px;font-size:0.82rem;max-height:260px;overflow-y:auto">${ids.map(id => {
        const a = articoloById(id);
        return `<li>${escapeHtml(a?.descrizione || "—")}${a?.codice ? ` <span class="text-muted">(${escapeHtml(a.codice)})</span>` : ""}</li>`;
      }).join("")}</ul>`
    : `<p class="hint" style="margin:0">Nessuno</p>`;

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-top:12px">
      <div>
        <p class="hint" style="margin:0 0 6px"><strong>Solo ${escapeHtml(nomeA)}</strong> (${soloA.length})</p>
        ${list(soloA)}
      </div>
      <div>
        <p class="hint" style="margin:0 0 6px"><strong>In comune</strong> (${comuni.length})</p>
        ${list(comuni)}
      </div>
      <div>
        <p class="hint" style="margin:0 0 6px"><strong>Solo ${escapeHtml(nomeB)}</strong> (${soloB.length})</p>
        ${list(soloB)}
      </div>
    </div>`;
}

// ==================================================== VISTA PER GRUPPO ===

function articoliDisponibiliPerGruppo(gruppoId) {
  const usati = new Set(getState().assortimenti.filter(r => String(r.gruppo_id) === String(gruppoId)).map(r => String(r.articolo_id)));
  return getState().articoli.filter(a => a.attivo !== false && !usati.has(String(a.id)));
}

let activeGdAssortSubtab = "gd-as-tab-lista";

export function renderAssortimentoGruppo(gruppoId) {
  const container = document.getElementById("gd-assortimento-content");
  if (!container) return;

  container.innerHTML = `
    <div class="subtabs-nested">
      <button class="subtab-btn-nested ${activeGdAssortSubtab === "gd-as-tab-lista" ? "active" : ""}" data-subview="gd-as-tab-lista">Assortimento</button>
      <button class="subtab-btn-nested ${activeGdAssortSubtab === "gd-as-tab-copertura" ? "active" : ""}" data-subview="gd-as-tab-copertura">Copertura punti vendita</button>
    </div>

    <div id="gd-as-tab-lista" class="subview-nested ${activeGdAssortSubtab === "gd-as-tab-lista" ? "active" : ""}">
      <div class="filter-bar">
        <button class="btn btn-sm rw-only" id="gd-as-add">+ Aggiungi articolo</button>
      </div>
      <div style="overflow-x:auto">
        <table class="desktop-table">
          <thead><tr><th>Articolo</th><th>Codice</th><th>Categoria</th><th>Stato</th><th>Data inizio</th><th>Note</th><th style="text-align:center">Azioni</th></tr></thead>
          <tbody id="gd-as-table-body"></tbody>
        </table>
      </div>
    </div>

    <div id="gd-as-tab-copertura" class="subview-nested ${activeGdAssortSubtab === "gd-as-tab-copertura" ? "active" : ""}">
      <p class="hint">Per ogni articolo attivo in assortimento, quali punti vendita del gruppo lo acquistano davvero (in base al venduto importato) e quali no. Ordinato per copertura decrescente.</p>
      <div id="gd-as-copertura"></div>
    </div>`;

  renderAssortimentoGruppoTable(gruppoId);
  renderCoperturaPdv(gruppoId);

  document.getElementById("gd-as-add").addEventListener("click", () => openAssortimentoModal(gruppoId));
  container.querySelectorAll(".subtab-btn-nested").forEach(btn => {
    btn.addEventListener("click", () => {
      activeGdAssortSubtab = btn.dataset.subview;
      container.querySelectorAll(".subtab-btn-nested").forEach(b => b.classList.toggle("active", b === btn));
      container.querySelectorAll(".subview-nested").forEach(v => v.classList.toggle("active", v.id === btn.dataset.subview));
    });
  });
}

function renderAssortimentoGruppoTable(gruppoId, tbodyId = "gd-as-table-body") {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const rows = getState().assortimenti
    .filter(r => String(r.gruppo_id) === String(gruppoId))
    .sort((a, b) => (articoloById(a.articolo_id)?.descrizione || "").localeCompare(articoloById(b.articolo_id)?.descrizione || ""));

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Nessun articolo in assortimento o in proposta per questo gruppo.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const articolo = articoloById(row.articolo_id);
    return `<tr>
      <td><strong>${escapeHtml(articolo?.descrizione || "—")}</strong></td>
      <td class="text-muted">${escapeHtml(articolo?.codice || "—")}</td>
      <td>${escapeHtml(CATEGORIE_ARTICOLO[articolo?.categoria] || "—")}</td>
      <td>
        <select class="as-stato-select" data-as-id="${row.id}" ${isReadOnly() ? "disabled" : ""} style="font-size:0.75rem;padding:4px 6px;border-radius:6px;border:1px solid var(--border-color)">
          ${Object.entries(STATO_ASSORTIMENTO).map(([k, v]) => `<option value="${k}" ${row.stato === k ? "selected" : ""}>${v.label}</option>`).join("")}
        </select>
      </td>
      <td>${formatDate(row.data_inizio)}</td>
      <td>${escapeHtml(row.note || "—")}</td>
      <td style="text-align:center"><button class="btn btn-red btn-sm rw-only" data-as-delete="${row.id}">Elimina</button></td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".as-stato-select").forEach(el => el.addEventListener("change", () => onChangeStatoAssortimento(el.dataset.asId, el.value)));
  tbody.querySelectorAll("[data-as-delete]").forEach(el => el.addEventListener("click", () => onDeleteAssortimento(el.dataset.asDelete)));
}

function renderCoperturaPdv(gruppoId) {
  const el = document.getElementById("gd-as-copertura");
  if (!el) return;
  const { assortimenti, vendite, puntiVendita } = getState();
  const copertura = coperturaAssortimentoPerPdv(gruppoId, assortimenti, vendite, puntiVendita);

  if (!copertura.length) {
    el.innerHTML = `<div class="empty-state">Nessun articolo attivo in assortimento per questo gruppo.</div>`;
    return;
  }

  el.innerHTML = copertura.map(c => {
    const articolo = articoloById(c.articolo_id);
    const totale = c.pdvAcquirenti.length + c.pdvNonAcquirenti.length;
    return `<details style="margin-bottom:8px;border:1px solid var(--border-color);border-radius:8px;padding:8px 12px">
      <summary style="cursor:pointer;font-size:0.85rem">
        <strong>${escapeHtml(articolo?.descrizione || "—")}</strong>
        ${articolo?.codice ? `<span class="text-muted">(${escapeHtml(articolo.codice)})</span>` : ""}
        — <span style="color:var(--accent-green)">${c.pdvAcquirenti.length} acquistano</span>
        / <span style="color:var(--text-muted)">${c.pdvNonAcquirenti.length} non acquistano</span>
        su ${totale} punti vendita
      </summary>
      <div class="grid-2" style="margin-top:10px">
        <div>
          <p class="hint" style="margin:0 0 4px">Acquistano</p>
          ${c.pdvAcquirenti.length ? `<ul style="margin:0;padding-left:18px;font-size:0.82rem">${c.pdvAcquirenti.map(p => `<li>${escapeHtml(p.nome_insegna)}</li>`).join("")}</ul>` : `<p class="hint" style="margin:0">Nessuno</p>`}
        </div>
        <div>
          <p class="hint" style="margin:0 0 4px">Non acquistano</p>
          ${c.pdvNonAcquirenti.length ? `<ul style="margin:0;padding-left:18px;font-size:0.82rem">${c.pdvNonAcquirenti.map(p => `<li>${escapeHtml(p.nome_insegna)}</li>`).join("")}</ul>` : `<p class="hint" style="margin:0">Nessuno</p>`}
        </div>
      </div>
    </details>`;
  }).join("");
}

async function onChangeStatoAssortimento(id, stato) {
  try {
    await updateRow("assortimenti", id, { stato });
    await loadAll();
    notifyDataChanged();
    toast("Stato aggiornato", "success");
  } catch (err) {
    toastError(err);
  }
}

let assortimentoGruppoId = null;

function openAssortimentoModal(gruppoId) {
  const gruppo = gruppoById(gruppoId);
  if (!gruppo) return;
  assortimentoGruppoId = gruppoId;
  const disponibili = articoliDisponibiliPerGruppo(gruppoId);
  document.getElementById("as-gruppo-nome").value = gruppo.nome;
  document.getElementById("as-articolo").innerHTML = disponibili.length
    ? disponibili.map(a => `<option value="${a.id}">${escapeHtml(a.descrizione)}</option>`).join("")
    : `<option value="">Nessun articolo disponibile — aggiungilo prima a catalogo</option>`;
  document.getElementById("as-stato").value = "proposto";
  document.getElementById("as-data-inizio").value = "";
  document.getElementById("as-note").value = "";
  openModal("assortimentoModal");
}

async function onSubmitAssortimento(event) {
  event.preventDefault();
  const articoloId = document.getElementById("as-articolo").value;
  if (!articoloId) {
    toast("Seleziona un articolo.", "error");
    return;
  }
  const payload = {
    gruppo_id: Number(assortimentoGruppoId),
    articolo_id: Number(articoloId),
    stato: document.getElementById("as-stato").value,
    data_inizio: document.getElementById("as-data-inizio").value || null,
    note: document.getElementById("as-note").value.trim() || null,
  };
  const submitBtn = event.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    await insertRow("assortimenti", payload);
    closeModal("assortimentoModal");
    await loadAll();
    notifyDataChanged();
    toast("Assortimento salvato", "success");
  } catch (err) {
    toastError(err);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

export function initAssortimenti() {
  document.getElementById("articolo-form").addEventListener("submit", onSubmitArticolo);
  document.getElementById("assortimento-form").addEventListener("submit", onSubmitAssortimento);
}
