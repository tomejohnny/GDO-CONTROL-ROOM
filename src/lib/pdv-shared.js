import { getState, loadAll } from "./store.js";
import { insertRow, updateRow, deleteRow } from "./db.js";
import { escapeHtml } from "./format.js";
import { openModal, closeModal } from "./modal.js";
import { toast, toastError } from "./ui.js";
import { notifyDataChanged } from "./bus.js";
import { confirmDialog } from "./confirm.js";

let editingId = null;

export function populateGruppoSelect(select, selectedId) {
  const gruppi = [...getState().gruppi].sort((a, b) => a.nome.localeCompare(b.nome));
  select.innerHTML = gruppi.map(g => `<option value="${g.id}">${escapeHtml(g.nome)}</option>`).join("");
  if (selectedId != null) select.value = String(selectedId);
}

export function populateAgenteSelect(select, selectedId, { includeEmpty = true, includeInactive = false } = {}) {
  const agenti = getState().agenti
    .filter(a => includeInactive || a.attivo !== false)
    .sort((a, b) => a.cognome.localeCompare(b.cognome));
  const emptyOpt = includeEmpty ? `<option value="">Nessuno</option>` : "";
  select.innerHTML = emptyOpt + agenti.map(a => `<option value="${a.id}">${escapeHtml(a.nome)} ${escapeHtml(a.cognome)}</option>`).join("");
  select.value = selectedId != null ? String(selectedId) : "";
}

export function openPdvModal({ gruppoId = null, row = null } = {}) {
  editingId = row?.id ?? null;
  document.getElementById("pdv-modal-title").textContent = row ? "Modifica punto vendita" : "Nuovo punto vendita";
  populateGruppoSelect(document.getElementById("p-gruppo"), row?.gruppo_id ?? gruppoId);
  populateAgenteSelect(document.getElementById("p-agente"), row?.agente_id ?? null);
  document.getElementById("p-nome").value = row?.nome_insegna || "";
  document.getElementById("p-indirizzo").value = row?.indirizzo || "";
  document.getElementById("p-comune").value = row?.comune || "";
  document.getElementById("p-provincia").value = row?.provincia || "";
  document.getElementById("p-stato").value = row?.stato || "non_servito";
  document.getElementById("p-data-attivazione").value = row?.data_attivazione || "";
  document.getElementById("p-note").value = row?.note || "";
  openModal("pdvModal");
}

async function onDelete(id) {
  if (!(await confirmDialog("Eliminare questo punto vendita? Verranno rimossi anche gli assortimenti collegati."))) return;
  try {
    await deleteRow("punti_vendita", id);
    await loadAll();
    notifyDataChanged();
    toast("Punto vendita eliminato");
  } catch (err) {
    toastError(err);
  }
}

async function onSubmit(event) {
  event.preventDefault();
  const payload = {
    gruppo_id: Number(document.getElementById("p-gruppo").value),
    nome_insegna: document.getElementById("p-nome").value.trim(),
    indirizzo: document.getElementById("p-indirizzo").value.trim() || null,
    comune: document.getElementById("p-comune").value.trim() || null,
    provincia: document.getElementById("p-provincia").value.trim().toUpperCase() || null,
    stato: document.getElementById("p-stato").value,
    agente_id: document.getElementById("p-agente").value ? Number(document.getElementById("p-agente").value) : null,
    data_attivazione: document.getElementById("p-data-attivazione").value || null,
    note: document.getElementById("p-note").value.trim() || null,
  };
  if (!payload.nome_insegna || !payload.gruppo_id) {
    toast("Seleziona il gruppo e inserisci il nome insegna.", "error");
    return;
  }
  const submitBtn = event.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    if (editingId) await updateRow("punti_vendita", editingId, payload);
    else await insertRow("punti_vendita", payload);
    closeModal("pdvModal");
    await loadAll();
    notifyDataChanged();
    toast("Punto vendita salvato", "success");
  } catch (err) {
    toastError(err);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

export function initPdvShared() {
  document.getElementById("pdv-form").addEventListener("submit", onSubmit);
}

export function wirePdvRowActions(container, rows) {
  container.querySelectorAll("[data-pdv-edit]").forEach(el => el.addEventListener("click", () => {
    const row = rows.find(r => String(r.id) === el.dataset.pdvEdit);
    if (row) openPdvModal({ row });
  }));
  container.querySelectorAll("[data-pdv-delete]").forEach(el => el.addEventListener("click", () => onDelete(el.dataset.pdvDelete)));
}
