import { getState, loadAll, gruppoById } from "../lib/store.js";
import { insertRow, updateRow, deleteRow } from "../lib/db.js";
import { escapeHtml, money, percent, formatDate } from "../lib/format.js";
import { openModal, closeModal } from "../lib/modal.js";
import { toast, toastError } from "../lib/ui.js";
import { notifyDataChanged } from "../lib/bus.js";
import { confirmDialog } from "../lib/confirm.js";
import { fatturatoPerAgente } from "../lib/analytics.js";
import { ultimaDataVendite } from "../lib/kpis.js";

const TABLE = "agenti";
let editingId = null;

function pdvCount(agenteId) {
  return getState().puntiVendita.filter(p => String(p.agente_id) === String(agenteId)).length;
}

export function render() {
  const rows = [...getState().agenti].sort((a, b) => a.cognome.localeCompare(b.cognome));
  const tbody = document.getElementById("agenti-table-body");
  const mobile = document.getElementById("agenti-mobile");
  tbody.innerHTML = "";
  mobile.innerHTML = "";

  if (!rows.length) tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Nessun agente censito.</td></tr>`;

  rows.forEach(a => {
    const contatti = [a.telefono, a.email].filter(Boolean).join(" · ") || "—";
    const statoBadge = a.attivo === false
      ? `<span class="badge" style="background:var(--text-muted)">Non attivo</span>`
      : `<span class="badge" style="background:var(--accent-green)">Attivo</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="row-link" data-detail="${a.id}"><strong>${escapeHtml(a.nome)} ${escapeHtml(a.cognome)}</strong></span></td>
      <td>${escapeHtml(a.zona || "—")}</td>
      <td>${escapeHtml(contatti)}</td>
      <td>${pdvCount(a.id)}</td>
      <td>${statoBadge}</td>
      <td style="text-align:center">
        <button class="btn btn-ghost btn-sm" data-edit="${a.id}">Modifica</button>
        <button class="btn btn-red btn-sm" data-delete="${a.id}">Elimina</button>
      </td>`;
    tbody.appendChild(tr);

    const card = document.createElement("div");
    card.className = "m-card";
    card.innerHTML = `
      <div class="m-card-header">
        <span class="row-link m-card-title" data-detail="${a.id}">${escapeHtml(a.nome)} ${escapeHtml(a.cognome)}</span>
        ${statoBadge}
      </div>
      <div style="font-size:0.75rem;color:var(--text-muted)">${escapeHtml(a.zona || "—")} · ${escapeHtml(contatti)}</div>
      <div class="m-card-details">
        <span>${pdvCount(a.id)} PdV assegnati</span>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" data-edit="${a.id}">Modifica</button>
          <button class="btn btn-red btn-sm" data-delete="${a.id}">Elimina</button>
        </div>
      </div>`;
    mobile.appendChild(card);
  });

  [tbody, mobile].forEach(container => {
    container.querySelectorAll("[data-edit]").forEach(el => el.addEventListener("click", () => onEdit(el.dataset.edit)));
    container.querySelectorAll("[data-delete]").forEach(el => el.addEventListener("click", () => onDelete(el.dataset.delete)));
    container.querySelectorAll("[data-detail]").forEach(el => el.addEventListener("click", () => openAgenteDetail(el.dataset.detail)));
  });
}

function openAgenteDetail(id) {
  const a = getState().agenti.find(r => String(r.id) === String(id));
  if (!a) return;
  const { vendite, puntiVendita } = getState();
  const { righe, fatturatoTotale, margineTotalePct } = fatturatoPerAgente(id, vendite, puntiVendita);

  document.getElementById("agente-detail-title").textContent = `${a.nome} ${a.cognome}`;
  document.getElementById("ad-kpi-fatturato").textContent = money(fatturatoTotale);
  document.getElementById("ad-kpi-pdv").textContent = righe.length;
  document.getElementById("ad-kpi-margine").textContent = percent(margineTotalePct);

  const pdvIds = new Set(puntiVendita.filter(p => String(p.agente_id) === String(id)).map(p => p.id));
  const ultimoAggiornamento = ultimaDataVendite(vendite.filter(v => pdvIds.has(v.punto_vendita_id)));
  document.getElementById("ad-kpi-fatturato-sub").textContent = ultimoAggiornamento ? `Dati al ${formatDate(ultimoAggiornamento)}` : "";

  const tbody = document.getElementById("ad-table-body");
  tbody.innerHTML = righe.length ? righe.map(r => {
    const pdv = puntiVendita.find(p => String(p.id) === String(r.punto_vendita_id));
    const gruppo = gruppoById(r.gruppo_id);
    return `<tr>
      <td>${escapeHtml(pdv?.nome_insegna || "—")}</td>
      <td>${escapeHtml(gruppo?.nome || "—")}</td>
      <td style="text-align:right" class="amount">${money(r.valore_euro)}</td>
      <td style="text-align:right">${r.valore_euro ? percent(r.marginePct) : "—"}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="4" class="empty-state">Nessun punto vendita assegnato a questo agente.</td></tr>`;

  openModal("agenteDetailModal");
}

function resetForm() {
  editingId = null;
  document.getElementById("agente-modal-title").textContent = "Nuovo agente";
  document.getElementById("agente-form").reset();
  document.getElementById("a-attivo").checked = true;
}

function onEdit(id) {
  const a = getState().agenti.find(r => String(r.id) === String(id));
  if (!a) return;
  editingId = a.id;
  document.getElementById("agente-modal-title").textContent = "Modifica agente";
  document.getElementById("a-nome").value = a.nome;
  document.getElementById("a-cognome").value = a.cognome;
  document.getElementById("a-zona").value = a.zona || "";
  document.getElementById("a-telefono").value = a.telefono || "";
  document.getElementById("a-email").value = a.email || "";
  document.getElementById("a-attivo").checked = a.attivo !== false;
  document.getElementById("a-note").value = a.note || "";
  openModal("agenteModal");
}

async function onDelete(id) {
  const message = pdvCount(id) > 0
    ? "Questo agente ha punti vendita assegnati, che resteranno senza agente. Continuare?"
    : "Eliminare questo agente?";
  if (!(await confirmDialog(message))) return;
  try {
    await deleteRow(TABLE, id);
    await loadAll();
    notifyDataChanged();
    toast("Agente eliminato");
  } catch (err) {
    toastError(err);
  }
}

async function onSubmit(event) {
  event.preventDefault();
  const payload = {
    nome: document.getElementById("a-nome").value.trim(),
    cognome: document.getElementById("a-cognome").value.trim(),
    zona: document.getElementById("a-zona").value.trim() || null,
    telefono: document.getElementById("a-telefono").value.trim() || null,
    email: document.getElementById("a-email").value.trim() || null,
    attivo: document.getElementById("a-attivo").checked,
    note: document.getElementById("a-note").value.trim() || null,
  };
  if (!payload.nome || !payload.cognome) {
    toast("Inserisci nome e cognome.", "error");
    return;
  }
  const submitBtn = event.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    if (editingId) await updateRow(TABLE, editingId, payload);
    else await insertRow(TABLE, payload);
    closeModal("agenteModal");
    await loadAll();
    notifyDataChanged();
    toast("Agente salvato", "success");
  } catch (err) {
    toastError(err);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

export function initAgenti() {
  document.getElementById("agente-form").addEventListener("submit", onSubmit);
  document.querySelector('[data-open-modal="agenteModal"]').addEventListener("click", resetForm);
}
