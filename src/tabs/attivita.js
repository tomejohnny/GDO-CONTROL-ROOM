import { getState, loadAll, gruppoById } from "../lib/store.js";
import { updateRow, deleteRow } from "../lib/db.js";
import { escapeHtml, formatDate, todayIso } from "../lib/format.js";
import { openModal } from "../lib/modal.js";
import { toast, toastError } from "../lib/ui.js";
import { notifyDataChanged } from "../lib/bus.js";
import { confirmDialog } from "../lib/confirm.js";
import { populateGruppoSelect } from "../lib/pdv-shared.js";

const TIPO_LABEL = { nota: "Nota", chiamata: "Chiamata", visita: "Visita", task: "Task" };

function filters() {
  return {
    search: (document.getElementById("at-search")?.value || "").trim().toLowerCase(),
    gruppo: document.getElementById("at-filter-gruppo")?.value || "",
    tipo: document.getElementById("at-filter-tipo")?.value || "",
    stato: document.getElementById("at-filter-stato")?.value || "",
  };
}

function filteredAttivita() {
  const f = filters();
  return getState().attivita.filter(a => {
    if (f.search && !`${a.descrizione} ${a.responsabile || ""}`.toLowerCase().includes(f.search)) return false;
    if (f.gruppo && String(a.gruppo_id) !== f.gruppo) return false;
    if (f.tipo && a.tipo !== f.tipo) return false;
    if (f.stato === "aperte" && a.completato) return false;
    if (f.stato === "completate" && !a.completato) return false;
    return true;
  });
}

function renderList() {
  const rows = [...filteredAttivita()].sort((a, b) => {
    if (!a.scadenza && !b.scadenza) return new Date(b.created_at) - new Date(a.created_at);
    if (!a.scadenza) return 1;
    if (!b.scadenza) return -1;
    return a.scadenza < b.scadenza ? -1 : 1;
  });

  const tbody = document.getElementById("at-table-body");
  const today = todayIso();

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Nessuna attività trovata.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(a => {
    const gruppo = gruppoById(a.gruppo_id);
    const scaduta = a.scadenza && a.scadenza < today && !a.completato;
    return `<tr${scaduta ? ` style="background:var(--accent-red-soft)"` : ""}>
      <td><span class="badge" style="background:${a.completato ? "var(--accent-green)" : "var(--accent-blue)"}">${TIPO_LABEL[a.tipo] || a.tipo}</span></td>
      <td>${escapeHtml(a.descrizione)}</td>
      <td><span class="row-link" data-open-gruppo="${a.gruppo_id}">${escapeHtml(gruppo?.nome || "—")}</span></td>
      <td>${escapeHtml(a.responsabile || "—")}</td>
      <td class="${scaduta ? "text-red" : ""}">${a.scadenza ? formatDate(a.scadenza) : "—"}</td>
      <td style="text-align:center">
        ${a.tipo === "task" ? `<button class="btn btn-ghost btn-sm" data-toggle="${a.id}">${a.completato ? "Riapri" : "Completa"}</button>` : ""}
        <button class="btn btn-red btn-sm" data-delete="${a.id}">Elimina</button>
      </td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-toggle]").forEach(el => el.addEventListener("click", () => onToggle(el.dataset.toggle)));
  tbody.querySelectorAll("[data-delete]").forEach(el => el.addEventListener("click", () => onDelete(el.dataset.delete)));
  tbody.querySelectorAll("[data-open-gruppo]").forEach(el => el.addEventListener("click", () => {
    document.querySelector('.nav-btn[data-view="gruppi"]')?.click();
    window.dispatchEvent(new CustomEvent("open-gruppo-detail", { detail: { id: el.dataset.openGruppo } }));
  }));
}

async function onToggle(id) {
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

async function onDelete(id) {
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

export function render() {
  const container = document.getElementById("attivita-content");
  if (!container) return;

  const gruppi = [...getState().gruppi].sort((a, b) => a.nome.localeCompare(b.nome));
  const aperte = getState().attivita.filter(a => !a.completato).length;
  const scadute = getState().attivita.filter(a => a.scadenza && a.scadenza < todayIso() && !a.completato).length;

  container.innerHTML = `
    <div class="grid-kpi">
      <div class="kpi-card">
        <div class="kpi-title">Attività aperte</div>
        <div class="kpi-value">${aperte}</div>
      </div>
      <div class="kpi-card red">
        <div class="kpi-title">Scadute</div>
        <div class="kpi-value">${scadute}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Totale (tutti i gruppi)</div>
        <div class="kpi-value">${getState().attivita.length}</div>
      </div>
    </div>
    <div class="actions-bar">
      <button class="btn" id="at-new">+ Nuova attività</button>
    </div>
    <div class="card">
      <div class="filter-bar">
        <input id="at-search" placeholder="Cerca descrizione o responsabile">
        <select id="at-filter-gruppo"><option value="">Tutti i gruppi</option>${gruppi.map(g => `<option value="${g.id}">${escapeHtml(g.nome)}</option>`).join("")}</select>
        <select id="at-filter-tipo">
          <option value="">Tutti i tipi</option>
          <option value="nota">Nota</option><option value="chiamata">Chiamata</option><option value="visita">Visita</option><option value="task">Task</option>
        </select>
        <select id="at-filter-stato">
          <option value="aperte">Solo aperte</option>
          <option value="">Tutte</option>
          <option value="completate">Solo completate</option>
        </select>
      </div>
      <div style="overflow-x:auto">
        <table class="desktop-table">
          <thead><tr><th>Tipo</th><th>Descrizione</th><th>Gruppo</th><th>Responsabile</th><th>Scadenza</th><th style="text-align:center">Azioni</th></tr></thead>
          <tbody id="at-table-body"></tbody>
        </table>
      </div>
    </div>`;

  ["at-search", "at-filter-gruppo", "at-filter-tipo", "at-filter-stato"].forEach(id => {
    document.getElementById(id).addEventListener("input", renderList);
    document.getElementById(id).addEventListener("change", renderList);
  });
  document.getElementById("at-new").addEventListener("click", () => {
    document.getElementById("attivita-form").reset();
    populateGruppoSelect(document.getElementById("at-gruppo"));
    openModal("attivitaModal");
  });

  renderList();
}
