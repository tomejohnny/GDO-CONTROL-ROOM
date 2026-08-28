import { getState, loadAll, gruppoById, articoloById } from "../lib/store.js";
import { insertRow, updateRow, deleteRow } from "../lib/db.js";
import { escapeHtml, statoBadge, STATO_ASSORTIMENTO, CATEGORIE_ARTICOLO, formatDate, money } from "../lib/format.js";
import { openModal, closeModal } from "../lib/modal.js";
import { toast, toastError } from "../lib/ui.js";
import { notifyDataChanged } from "../lib/bus.js";
import { confirmDialog } from "../lib/confirm.js";
import { assortimentiSenzaVendite, venditeSenzaAssortimento, coperturaAssortimentoPerPdv } from "../lib/analytics.js";

let editingArticoloId = null;

// ============================================================= CATALOGO ===

function articoloRow(a) {
  return `<tr>
    <td><strong>${escapeHtml(a.descrizione)}</strong>${a.codice ? ` <span class="text-muted">(${escapeHtml(a.codice)})</span>` : ""}</td>
    <td>${escapeHtml(CATEGORIE_ARTICOLO[a.categoria] || a.categoria)}</td>
    <td>${escapeHtml(a.unita_misura || "—")}</td>
    <td>${a.attivo === false ? `<span class="badge" style="background:var(--text-muted)">Non attivo</span>` : `<span class="badge" style="background:var(--accent-green)">Attivo</span>`}</td>
    <td style="text-align:center">
      <button class="btn btn-ghost btn-sm" data-art-edit="${a.id}">Modifica</button>
      <button class="btn btn-red btn-sm" data-art-delete="${a.id}">Elimina</button>
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

// ========================================================= VISTA GLOBALE ===

function globalFilters() {
  return {
    search: (document.getElementById("as-g-search")?.value || "").trim().toLowerCase(),
    gruppo: document.getElementById("as-g-filter-gruppo")?.value || "",
    stato: document.getElementById("as-g-filter-stato")?.value || "",
  };
}

function globalFilteredRows() {
  const f = globalFilters();
  return getState().assortimenti.filter(row => {
    const articolo = articoloById(row.articolo_id);
    if (f.gruppo && String(row.gruppo_id) !== f.gruppo) return false;
    if (f.stato && row.stato !== f.stato) return false;
    const gruppo = gruppoById(row.gruppo_id);
    if (f.search && !`${articolo?.descrizione || ""} ${gruppo?.nome || ""}`.toLowerCase().includes(f.search)) return false;
    return true;
  });
}

function renderGlobalTable() {
  const tbody = document.getElementById("as-g-table-body");
  if (!tbody) return;
  const rows = globalFilteredRows();

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Nessun assortimento trovato con questi filtri.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const gruppo = gruppoById(row.gruppo_id);
    const articolo = articoloById(row.articolo_id);
    return `<tr>
      <td>${escapeHtml(gruppo?.nome || "—")}</td>
      <td>${escapeHtml(articolo?.descrizione || "—")}</td>
      <td>${statoBadge(STATO_ASSORTIMENTO, row.stato)}</td>
      <td>${formatDate(row.data_inizio)}</td>
      <td style="text-align:center"><button class="btn btn-red btn-sm" data-as-delete="${row.id}">Elimina</button></td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-as-delete]").forEach(el => el.addEventListener("click", () => onDeleteAssortimento(el.dataset.asDelete)));
}

function renderDisallineamenti() {
  const { assortimenti, vendite } = getState();

  const senzaVendite = assortimentiSenzaVendite(assortimenti, vendite);
  const elA = document.getElementById("as-senza-vendite");
  elA.innerHTML = senzaVendite.length ? `
    <table class="desktop-table">
      <thead><tr><th>Gruppo</th><th>Articolo</th></tr></thead>
      <tbody>
        ${senzaVendite.slice(0, 20).map(a => {
          const articolo = articoloById(a.articolo_id);
          return `<tr>
            <td>${escapeHtml(gruppoById(a.gruppo_id)?.nome || "—")}</td>
            <td>${escapeHtml(articolo?.descrizione || "—")}</td>
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
      <thead><tr><th>Gruppo</th><th>Articolo</th><th style="text-align:right">Valore</th></tr></thead>
      <tbody>
        ${senzaAssortimento.slice(0, 20).map(v => {
          const articolo = articoloById(v.articolo_id);
          return `<tr>
            <td>${escapeHtml(gruppoById(v.gruppo_id)?.nome || "—")}</td>
            <td>${escapeHtml(articolo?.descrizione || "—")}</td>
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

export function render() {
  const container = document.getElementById("assortimenti-content");
  if (!container) return;

  const gruppi = [...getState().gruppi].sort((a, b) => a.nome.localeCompare(b.nome));
  container.innerHTML = `
    <div class="card">
      <h2>
        <span>Catalogo articoli</span>
        <button class="btn btn-sm" id="as-art-new">+ Nuovo articolo</button>
      </h2>
      <table class="desktop-table">
        <thead><tr><th>Articolo</th><th>Categoria</th><th>U.M.</th><th>Stato</th><th style="text-align:center">Azioni</th></tr></thead>
        <tbody id="as-articoli-table-body">${getState().articoli.map(articoloRow).join("") || `<tr><td colspan="5" class="empty-state">Nessun articolo a catalogo. Aggiungine uno per iniziare.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="card">
      <h2>Assortimenti — vista trasversale</h2>
      <p class="hint">Quali articoli sono in assortimento per ciascun gruppo GDO, e a che punto sono le proposte in corso. Per aggiungere un articolo, apri il gruppo GDO e usa la scheda "Assortimento".</p>
      <div class="filter-bar">
        <input id="as-g-search" placeholder="Cerca articolo o gruppo">
        <select id="as-g-filter-gruppo"><option value="">Tutti i gruppi</option>${gruppi.map(g => `<option value="${g.id}">${escapeHtml(g.nome)}</option>`).join("")}</select>
        <select id="as-g-filter-stato">
          <option value="">Tutti gli stati</option>
          <option value="attivo">Attivo</option>
          <option value="proposto">Proposto</option>
          <option value="in_trattativa">In trattativa</option>
          <option value="rifiutato">Rifiutato</option>
          <option value="sospeso">Sospeso</option>
        </select>
      </div>
      <table class="desktop-table">
        <thead><tr><th>Gruppo</th><th>Articolo</th><th>Stato</th><th>Data inizio</th><th style="text-align:center">Azioni</th></tr></thead>
        <tbody id="as-g-table-body"></tbody>
      </table>
    </div>
    <div class="grid-2">
      <div class="card">
        <h2>Assortimento senza venduto</h2>
        <p class="hint">Articoli "attivo" nell'assortimento di un gruppo, ma senza nessuna vendita registrata su nessun suo punto vendita — possibile disallineamento.</p>
        <div id="as-senza-vendite"></div>
      </div>
      <div class="card">
        <h2>Venduto non tracciato in assortimento</h2>
        <p class="hint">Vendite reali su combinazioni gruppo + articolo che non risultano in nessun assortimento.</p>
        <div id="as-senza-assortimento"></div>
      </div>
    </div>`;

  wireArticoloActions(container);
  document.getElementById("as-art-new").addEventListener("click", () => openArticoloModal(null));
  ["as-g-search", "as-g-filter-gruppo", "as-g-filter-stato"].forEach(id => {
    document.getElementById(id).addEventListener("input", renderGlobalTable);
    document.getElementById(id).addEventListener("change", renderGlobalTable);
  });
  renderGlobalTable();
  renderDisallineamenti();
}

// ==================================================== VISTA PER GRUPPO ===

function articoliDisponibiliPerGruppo(gruppoId) {
  const usati = new Set(getState().assortimenti.filter(r => String(r.gruppo_id) === String(gruppoId)).map(r => String(r.articolo_id)));
  return getState().articoli.filter(a => a.attivo !== false && !usati.has(String(a.id)));
}

export function renderAssortimentoGruppo(gruppoId) {
  const container = document.getElementById("gd-assortimento-content");
  if (!container) return;

  container.innerHTML = `
    <div class="filter-bar">
      <button class="btn btn-sm" id="gd-as-add">+ Aggiungi articolo</button>
    </div>
    <table class="desktop-table">
      <thead><tr><th>Articolo</th><th>Categoria</th><th>Stato</th><th>Data inizio</th><th>Note</th><th style="text-align:center">Azioni</th></tr></thead>
      <tbody id="gd-as-table-body"></tbody>
    </table>
    <h3 style="margin-top:20px;font-size:0.95rem">Copertura sui punti vendita</h3>
    <p class="hint">Per ogni articolo attivo in assortimento, quali punti vendita del gruppo lo acquistano davvero (in base al venduto importato) e quali no.</p>
    <div id="gd-as-copertura"></div>`;

  renderAssortimentoGruppoTable(gruppoId);
  renderCoperturaPdv(gruppoId);

  document.getElementById("gd-as-add").addEventListener("click", () => openAssortimentoModal(gruppoId));
}

function renderAssortimentoGruppoTable(gruppoId) {
  const tbody = document.getElementById("gd-as-table-body");
  if (!tbody) return;
  const rows = getState().assortimenti.filter(r => String(r.gruppo_id) === String(gruppoId));

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Nessun articolo in assortimento o in proposta per questo gruppo.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const articolo = articoloById(row.articolo_id);
    return `<tr>
      <td><strong>${escapeHtml(articolo?.descrizione || "—")}</strong></td>
      <td>${escapeHtml(CATEGORIE_ARTICOLO[articolo?.categoria] || "—")}</td>
      <td>
        <select class="as-stato-select" data-as-id="${row.id}" style="font-size:0.75rem;padding:4px 6px;border-radius:6px;border:1px solid var(--border-color)">
          ${Object.entries(STATO_ASSORTIMENTO).map(([k, v]) => `<option value="${k}" ${row.stato === k ? "selected" : ""}>${v.label}</option>`).join("")}
        </select>
      </td>
      <td>${formatDate(row.data_inizio)}</td>
      <td>${escapeHtml(row.note || "—")}</td>
      <td style="text-align:center"><button class="btn btn-red btn-sm" data-as-delete="${row.id}">Elimina</button></td>
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
