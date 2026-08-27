import { getState, gruppoById, agenteNome } from "../lib/store.js";
import { escapeHtml, statoBadge, STATO_PDV } from "../lib/format.js";
import { openPdvModal, populateGruppoSelect, populateAgenteSelect, wirePdvRowActions } from "../lib/pdv-shared.js";

function filters() {
  return {
    search: (document.getElementById("pv-search")?.value || "").trim().toLowerCase(),
    gruppo: document.getElementById("pv-filter-gruppo")?.value || "",
    agente: document.getElementById("pv-filter-agente")?.value || "",
    stato: document.getElementById("pv-filter-stato")?.value || "",
  };
}

function filteredRows() {
  const f = filters();
  return getState().puntiVendita.filter(p => {
    if (f.search && !`${p.nome_insegna} ${p.comune || ""}`.toLowerCase().includes(f.search)) return false;
    if (f.gruppo && String(p.gruppo_id) !== f.gruppo) return false;
    if (f.agente && String(p.agente_id) !== f.agente) return false;
    if (f.stato && p.stato !== f.stato) return false;
    return true;
  });
}

function populateFilterSelects() {
  const gruppoSel = document.getElementById("pv-filter-gruppo");
  const agenteSel = document.getElementById("pv-filter-agente");
  const currentGruppo = gruppoSel.value;
  const currentAgente = agenteSel.value;
  const gruppi = [...getState().gruppi].sort((a, b) => a.nome.localeCompare(b.nome));
  const agenti = [...getState().agenti].sort((a, b) => a.cognome.localeCompare(b.cognome));
  gruppoSel.innerHTML = `<option value="">Tutti i gruppi</option>` + gruppi.map(g => `<option value="${g.id}">${escapeHtml(g.nome)}</option>`).join("");
  agenteSel.innerHTML = `<option value="">Tutti gli agenti</option>` + agenti.map(a => `<option value="${a.id}">${escapeHtml(a.nome)} ${escapeHtml(a.cognome)}</option>`).join("");
  gruppoSel.value = currentGruppo;
  agenteSel.value = currentAgente;
}

export function render() {
  populateFilterSelects();
  const rows = filteredRows();
  const tbody = document.getElementById("pv-table-body");
  const mobile = document.getElementById("pv-mobile");
  tbody.innerHTML = "";
  mobile.innerHTML = "";

  if (!rows.length) tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Nessun punto vendita trovato.</td></tr>`;

  rows.forEach(p => {
    const gruppo = gruppoById(p.gruppo_id);
    const agente = agenteNome(p.agente_id) || "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(p.nome_insegna)}</strong></td>
      <td>${escapeHtml(gruppo?.nome || "—")}</td>
      <td>${escapeHtml(p.comune || "—")}</td>
      <td>${escapeHtml(p.provincia || "—")}</td>
      <td>${statoBadge(STATO_PDV, p.stato)}</td>
      <td>${escapeHtml(agente)}</td>
      <td style="text-align:center">
        <button class="btn btn-ghost btn-sm" data-pdv-edit="${p.id}">Modifica</button>
        <button class="btn btn-red btn-sm" data-pdv-delete="${p.id}">Elimina</button>
      </td>`;
    tbody.appendChild(tr);

    const card = document.createElement("div");
    card.className = "m-card";
    card.innerHTML = `
      <div class="m-card-header">
        <span class="m-card-title">${escapeHtml(p.nome_insegna)}</span>
        ${statoBadge(STATO_PDV, p.stato)}
      </div>
      <div style="font-size:0.75rem;color:var(--text-muted)">${escapeHtml(gruppo?.nome || "—")} · ${escapeHtml(p.comune || "—")} ${escapeHtml(p.provincia || "")}</div>
      <div class="m-card-details">
        <span>Agente: ${escapeHtml(agente)}</span>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" data-pdv-edit="${p.id}">Modifica</button>
          <button class="btn btn-red btn-sm" data-pdv-delete="${p.id}">Elimina</button>
        </div>
      </div>`;
    mobile.appendChild(card);
  });

  wirePdvRowActions(tbody, rows);
  wirePdvRowActions(mobile, rows);
}

export function initPuntiVendita() {
  ["pv-search", "pv-filter-gruppo", "pv-filter-agente", "pv-filter-stato"].forEach(id => {
    document.getElementById(id).addEventListener("input", render);
    document.getElementById(id).addEventListener("change", render);
  });
  document.getElementById("pv-new").addEventListener("click", () => openPdvModal());
}
