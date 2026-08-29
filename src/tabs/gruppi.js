import { getState, loadAll, gruppoById, agenteNome, puntiVenditaDelGruppo } from "../lib/store.js";
import { insertRow, updateRow, deleteRow } from "../lib/db.js";
import { escapeHtml, statoBadge, STATO_GRUPPO, STATO_PDV, formatDate, money } from "../lib/format.js";
import { openModal, closeModal } from "../lib/modal.js";
import { toast, toastError } from "../lib/ui.js";
import { notifyDataChanged } from "../lib/bus.js";
import { confirmDialog } from "../lib/confirm.js";
import { coperturaGruppo, fatturatoAnnoCorrente, ultimaDataVendite } from "../lib/kpis.js";
import { openPdvModal, wirePdvRowActions, populateGruppoSelect } from "../lib/pdv-shared.js";
import { renderAssortimentoGruppo } from "./assortimenti.js";

const TABLE = "gdo_groups";
let editingId = null;
let selectedGruppoId = null;
const PDV_TOP_N = 30;
let pdvShowAll = false;

// ---------------------------------------------------------------- LISTA ---

function filters() {
  return {
    search: (document.getElementById("gr-search")?.value || "").trim().toLowerCase(),
    stato: document.getElementById("gr-filter-stato")?.value || "",
  };
}

function filteredGruppi() {
  const f = filters();
  return getState().gruppi.filter(g => {
    if (f.search && !`${g.nome} ${g.area_geografica || ""}`.toLowerCase().includes(f.search)) return false;
    if (f.stato && g.stato !== f.stato) return false;
    return true;
  });
}

function renderLista() {
  const rows = filteredGruppi();
  const tbody = document.getElementById("gruppi-table-body");
  const mobile = document.getElementById("gruppi-mobile");
  tbody.innerHTML = "";
  mobile.innerHTML = "";

  if (!rows.length) tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Nessun gruppo GDO trovato.</td></tr>`;

  rows.forEach(g => {
    const { totale, serviti, pct } = coperturaGruppo(g.id, getState().puntiVendita);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="row-link" data-open="${g.id}">${escapeHtml(g.nome)}</span></td>
      <td>${escapeHtml(g.area_geografica || "—")}</td>
      <td>${statoBadge(STATO_GRUPPO, g.stato)}</td>
      <td>${totale ? `${serviti} / ${totale}` : "—"}</td>
      <td>${totale ? `${pct.toFixed(1)}%` : "—"}</td>
      <td>${escapeHtml(g.referente_buyer || "—")}</td>
      <td style="text-align:center">
        <button class="btn btn-ghost btn-sm rw-only" data-edit="${g.id}">Modifica</button>
        <button class="btn btn-red btn-sm rw-only" data-delete="${g.id}">Elimina</button>
      </td>`;
    tbody.appendChild(tr);

    const card = document.createElement("div");
    card.className = "m-card";
    card.innerHTML = `
      <div class="m-card-header">
        <span class="row-link m-card-title" data-open="${g.id}">${escapeHtml(g.nome)}</span>
        ${statoBadge(STATO_GRUPPO, g.stato)}
      </div>
      <div style="font-size:0.75rem;color:var(--text-muted)">${escapeHtml(g.area_geografica || "—")} · ${totale ? `PdV ${serviti}/${totale} (${pct.toFixed(1)}%)` : "senza punti vendita"}</div>
      <div class="m-card-details">
        <span>${escapeHtml(g.referente_buyer || "—")}</span>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm rw-only" data-edit="${g.id}">Modifica</button>
          <button class="btn btn-red btn-sm rw-only" data-delete="${g.id}">Elimina</button>
        </div>
      </div>`;
    mobile.appendChild(card);
  });

  [tbody, mobile].forEach(container => {
    container.querySelectorAll("[data-open]").forEach(el => el.addEventListener("click", () => openDetail(el.dataset.open)));
    container.querySelectorAll("[data-edit]").forEach(el => el.addEventListener("click", () => onEditFromList(el.dataset.edit)));
    container.querySelectorAll("[data-delete]").forEach(el => el.addEventListener("click", () => onDelete(el.dataset.delete)));
  });
}

function resetForm() {
  editingId = null;
  document.getElementById("gruppo-modal-title").textContent = "Nuovo gruppo GDO";
  document.getElementById("gruppo-form").reset();
  document.getElementById("g-stato").value = "attivo";
}

function fillForm(g) {
  editingId = g.id;
  document.getElementById("gruppo-modal-title").textContent = "Modifica gruppo GDO";
  document.getElementById("g-nome").value = g.nome;
  document.getElementById("g-area").value = g.area_geografica || "";
  document.getElementById("g-stato").value = g.stato;
  document.getElementById("g-buyer").value = g.referente_buyer || "";
  document.getElementById("g-contatto").value = g.contatto_buyer || "";
  document.getElementById("g-note").value = g.note || "";
}

function onEditFromList(id) {
  const g = gruppoById(id);
  if (!g) return;
  fillForm(g);
  openModal("gruppoModal");
}

async function onDelete(id) {
  const { totale } = coperturaGruppo(id, getState().puntiVendita);
  const warn = totale ? ` Verranno eliminati anche i suoi ${totale} punti vendita e i relativi assortimenti.` : "";
  if (!(await confirmDialog(`Eliminare questo gruppo GDO?${warn}`))) return;
  try {
    await deleteRow(TABLE, id);
    await loadAll();
    if (String(selectedGruppoId) === String(id)) backToList();
    notifyDataChanged();
    toast("Gruppo eliminato");
  } catch (err) {
    toastError(err);
  }
}

async function onSubmit(event) {
  event.preventDefault();
  const payload = {
    nome: document.getElementById("g-nome").value.trim(),
    area_geografica: document.getElementById("g-area").value.trim() || null,
    stato: document.getElementById("g-stato").value,
    referente_buyer: document.getElementById("g-buyer").value.trim() || null,
    contatto_buyer: document.getElementById("g-contatto").value.trim() || null,
    note: document.getElementById("g-note").value.trim() || null,
  };
  if (!payload.nome) {
    toast("Inserisci il nome del gruppo.", "error");
    return;
  }
  const submitBtn = event.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    if (editingId) await updateRow(TABLE, editingId, payload);
    else await insertRow(TABLE, payload);
    closeModal("gruppoModal");
    await loadAll();
    notifyDataChanged();
    toast("Gruppo salvato", "success");
  } catch (err) {
    toastError(err);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// -------------------------------------------------------------- DETTAGLIO ---

function openDetail(id) {
  selectedGruppoId = id;
  pdvShowAll = false;
  document.getElementById("gd-pdv-search").value = "";
  document.getElementById("gd-pdv-filter-stato").value = "";
  document.getElementById("gruppi-list-view").style.display = "none";
  document.getElementById("gruppo-detail-view").style.display = "block";
  switchSubview("gd-pdv");
  renderDetail();
}

function backToList() {
  selectedGruppoId = null;
  document.getElementById("gruppo-detail-view").style.display = "none";
  document.getElementById("gruppi-list-view").style.display = "block";
  renderLista();
}

function switchSubview(id) {
  document.querySelectorAll(".subtab-btn").forEach(b => b.classList.toggle("active", b.dataset.subview === id));
  document.querySelectorAll(".subview").forEach(v => v.classList.toggle("active", v.id === id));
}

function renderDetail() {
  const g = gruppoById(selectedGruppoId);
  if (!g) { backToList(); return; }

  document.getElementById("gd-nome").textContent = g.nome;
  document.getElementById("gd-kpi-stato").innerHTML = statoBadge(STATO_GRUPPO, g.stato);
  document.getElementById("gd-kpi-buyer").textContent = g.referente_buyer || "Nessun referente registrato";

  const { totale, serviti, pct } = coperturaGruppo(g.id, getState().puntiVendita);
  document.getElementById("gd-kpi-pdv").textContent = totale ? `${serviti} / ${totale}` : "—";
  document.getElementById("gd-kpi-pdv-sub").textContent = totale ? `Copertura ${pct.toFixed(1)}%` : "Gruppo senza punti vendita (gestito a magazzino centrale)";

  const venditeGruppo = getState().vendite.filter(v => String(v.gruppo_id) === String(g.id));
  document.getElementById("gd-kpi-fatturato").textContent = money(fatturatoAnnoCorrente(venditeGruppo));
  const ultimoAggiornamento = ultimaDataVendite(venditeGruppo);
  document.getElementById("gd-kpi-fatturato-sub").textContent = ultimoAggiornamento ? `Da statistiche venduto (dati al ${formatDate(ultimoAggiornamento)})` : "Da statistiche venduto";

  renderPdvSubview();
  renderAssortimentoGruppo(g.id);
  renderAttivitaSubview();
}

function pdvSubviewFiltered() {
  const search = (document.getElementById("gd-pdv-search")?.value || "").trim().toLowerCase();
  const stato = document.getElementById("gd-pdv-filter-stato")?.value || "";
  return puntiVenditaDelGruppo(selectedGruppoId).filter(p => {
    if (search && !`${p.nome_insegna} ${p.comune || ""}`.toLowerCase().includes(search)) return false;
    if (stato && p.stato !== stato) return false;
    return true;
  });
}

function renderPdvSubview() {
  const all = pdvSubviewFiltered();
  const rows = pdvShowAll ? all : all.slice(0, PDV_TOP_N);
  const tbody = document.getElementById("gd-pdv-table-body");
  const mobile = document.getElementById("gd-pdv-mobile");
  const moreEl = document.getElementById("gd-pdv-more");
  tbody.innerHTML = "";
  mobile.innerHTML = "";

  if (!all.length) tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Nessun punto vendita trovato.</td></tr>`;

  moreEl.innerHTML = all.length > PDV_TOP_N
    ? `<button class="btn btn-ghost btn-sm" id="gd-pdv-more-btn">${pdvShowAll ? `Mostra solo le prime ${PDV_TOP_N}` : `Mostra tutti i ${all.length} punti vendita`}</button>`
    : "";
  document.getElementById("gd-pdv-more-btn")?.addEventListener("click", () => {
    pdvShowAll = !pdvShowAll;
    renderPdvSubview();
  });

  rows.forEach(p => {
    const agente = agenteNome(p.agente_id) || "—";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(p.nome_insegna)}</strong></td>
      <td>${escapeHtml(p.comune || "—")}</td>
      <td>${statoBadge(STATO_PDV, p.stato)}</td>
      <td>${escapeHtml(agente)}</td>
      <td style="text-align:center">
        <button class="btn btn-ghost btn-sm rw-only" data-pdv-edit="${p.id}">Modifica</button>
        <button class="btn btn-red btn-sm rw-only" data-pdv-delete="${p.id}">Elimina</button>
      </td>`;
    tbody.appendChild(tr);

    const card = document.createElement("div");
    card.className = "m-card";
    card.innerHTML = `
      <div class="m-card-header">
        <span class="m-card-title">${escapeHtml(p.nome_insegna)}</span>
        ${statoBadge(STATO_PDV, p.stato)}
      </div>
      <div style="font-size:0.75rem;color:var(--text-muted)">${escapeHtml(p.comune || "—")}</div>
      <div class="m-card-details">
        <span>Agente: ${escapeHtml(agente)}</span>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm rw-only" data-pdv-edit="${p.id}">Modifica</button>
          <button class="btn btn-red btn-sm rw-only" data-pdv-delete="${p.id}">Elimina</button>
        </div>
      </div>`;
    mobile.appendChild(card);
  });

  wirePdvRowActions(tbody, rows);
  wirePdvRowActions(mobile, rows);
}

// ---------------------------------------------------------------- ATTIVITA ---

const TIPO_LABEL = { nota: "Nota", chiamata: "Chiamata", visita: "Visita", task: "Task" };

function renderAttivitaSubview() {
  const rows = getState().attivita.filter(a => String(a.gruppo_id) === String(selectedGruppoId));
  const container = document.getElementById("gd-attivita-list");

  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">Nessuna attività registrata per questo gruppo.</div>`;
    return;
  }

  container.innerHTML = rows.map(a => `
    <div class="m-card" style="margin-bottom:8px">
      <div class="m-card-header">
        <span class="badge" style="background:${a.completato ? "var(--accent-green)" : "var(--accent-blue)"}">${TIPO_LABEL[a.tipo] || a.tipo}</span>
        <div style="display:flex;gap:6px">
          ${a.tipo === "task" ? `<button class="btn btn-ghost btn-sm rw-only" data-toggle-attivita="${a.id}">${a.completato ? "Riapri" : "Completa"}</button>` : ""}
          <button class="btn btn-red btn-sm rw-only" data-delete-attivita="${a.id}">Elimina</button>
        </div>
      </div>
      <div style="font-size:0.85rem;margin-top:4px">${escapeHtml(a.descrizione)}</div>
      <div class="m-card-details">
        <span>${escapeHtml(a.responsabile || "—")}${a.scadenza ? " · scadenza " + formatDate(a.scadenza) : ""}</span>
        <span class="text-muted">${formatDate(a.created_at)}</span>
      </div>
    </div>`).join("");

  container.querySelectorAll("[data-delete-attivita]").forEach(el => el.addEventListener("click", () => onDeleteAttivita(el.dataset.deleteAttivita)));
  container.querySelectorAll("[data-toggle-attivita]").forEach(el => el.addEventListener("click", () => onToggleAttivita(el.dataset.toggleAttivita)));
}

async function onDeleteAttivita(id) {
  if (!(await confirmDialog("Eliminare questa attività?"))) return;
  try {
    await deleteRow("attivita", id);
    await loadAll();
    notifyDataChanged();
    toast("Attività eliminata");
  } catch (err) {
    toastError(err);
  }
}

async function onToggleAttivita(id) {
  const row = getState().attivita.find(a => String(a.id) === String(id));
  if (!row) return;
  try {
    await updateRow("attivita", id, { completato: !row.completato });
    await loadAll();
    notifyDataChanged();
  } catch (err) {
    toastError(err);
  }
}

async function onSubmitAttivita(event) {
  event.preventDefault();
  const payload = {
    gruppo_id: Number(document.getElementById("at-gruppo").value),
    tipo: document.getElementById("at-tipo").value,
    descrizione: document.getElementById("at-descrizione").value.trim(),
    responsabile: document.getElementById("at-responsabile").value.trim() || null,
    scadenza: document.getElementById("at-scadenza").value || null,
  };
  if (!payload.gruppo_id) {
    toast("Seleziona un gruppo GDO.", "error");
    return;
  }
  if (!payload.descrizione) {
    toast("Inserisci una descrizione.", "error");
    return;
  }
  const submitBtn = event.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    await insertRow("attivita", payload);
    closeModal("attivitaModal");
    document.getElementById("attivita-form").reset();
    await loadAll();
    notifyDataChanged();
    toast("Attività salvata", "success");
  } catch (err) {
    toastError(err);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// -------------------------------------------------------------------- init ---

export function render() {
  if (selectedGruppoId) renderDetail();
  else renderLista();
}

export function initGruppi() {
  document.getElementById("gruppo-form").addEventListener("submit", onSubmit);
  document.querySelector('[data-open-modal="gruppoModal"]').addEventListener("click", resetForm);
  window.addEventListener("open-gruppo-detail", event => openDetail(event.detail.id));

  document.getElementById("gr-search").addEventListener("input", renderLista);
  document.getElementById("gr-filter-stato").addEventListener("change", renderLista);

  document.getElementById("gruppo-back").addEventListener("click", backToList);
  document.getElementById("gd-edit").addEventListener("click", () => {
    const g = gruppoById(selectedGruppoId);
    if (g) { fillForm(g); openModal("gruppoModal"); }
  });
  document.getElementById("gd-delete").addEventListener("click", () => onDelete(selectedGruppoId));

  document.querySelectorAll(".subtab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchSubview(btn.dataset.subview));
  });

  document.getElementById("gd-pdv-new").addEventListener("click", () => openPdvModal({ gruppoId: selectedGruppoId }));
  document.getElementById("gd-pdv-search").addEventListener("input", renderPdvSubview);
  document.getElementById("gd-pdv-filter-stato").addEventListener("change", renderPdvSubview);

  document.getElementById("gd-attivita-new").addEventListener("click", () => {
    document.getElementById("attivita-form").reset();
    populateGruppoSelect(document.getElementById("at-gruppo"), selectedGruppoId);
    openModal("attivitaModal");
  });
  document.getElementById("attivita-form").addEventListener("submit", onSubmitAttivita);
}
