import { getState, loadAll, gruppoById, agenteNome } from "../lib/store.js";
import { updateRow, deleteRow, deleteRows } from "../lib/db.js";
import { escapeHtml, statoBadge, STATO_PDV, money } from "../lib/format.js";
import { openPdvModal, populateGruppoSelect, populateAgenteSelect, wirePdvRowActions } from "../lib/pdv-shared.js";
import { toast, toastError } from "../lib/ui.js";
import { notifyDataChanged } from "../lib/bus.js";
import { confirmDialog } from "../lib/confirm.js";

// ================================================ PUNTI VENDITA DUPLICATI ===

// Import da fonti diverse (vendite vs anagrafica agenti) creano a volte lo
// stesso negozio due volte con una forma societaria in più/meno nel nome
// (es. "ACIL AGORDO" e "ACIL SRL AGORDO"). Confronto per insieme di parole,
// dopo aver tolto le sigle di forma societaria, non per testo grezzo — e solo
// tra punti vendita dello stesso gruppo.
const PDV_STOPWORDS = new Set(["srl", "spa", "snc", "sas", "soc", "coop", "cooperativa", "s", "r", "l", "p", "a", "n", "c"]);

function pdvNameTokens(nome) {
  const s = (nome || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ");
  return s.split(" ").filter(t => t && !PDV_STOPWORDS.has(t));
}

function fatturatoPerPdvMap(vendite) {
  const map = new Map();
  vendite.forEach(v => {
    if (v.punto_vendita_id == null) return;
    map.set(v.punto_vendita_id, (map.get(v.punto_vendita_id) || 0) + Number(v.valore_euro || 0));
  });
  return map;
}

function duplicatiPuntiVendita() {
  const { puntiVendita, vendite } = getState();
  const fatturato = fatturatoPerPdvMap(vendite);

  const byGruppo = new Map();
  puntiVendita.forEach(p => {
    if (!byGruppo.has(p.gruppo_id)) byGruppo.set(p.gruppo_id, []);
    byGruppo.get(p.gruppo_id).push({ ...p, tokens: pdvNameTokens(p.nome_insegna), fatturato: fatturato.get(p.id) || 0 });
  });

  const gruppi = [];
  byGruppo.forEach(list => {
    const used = new Set();
    list.forEach((p, i) => {
      if (used.has(p.id) || !p.tokens.length) return;
      const setA = new Set(p.tokens);
      const group = [p];
      list.forEach((q, j) => {
        if (i === j || used.has(q.id) || !q.tokens.length) return;
        const setB = new Set(q.tokens);
        const subset = [...setA].every(t => setB.has(t)) || [...setB].every(t => setA.has(t));
        if (subset) group.push(q);
      });
      if (group.length > 1) {
        group.forEach(g => used.add(g.id));
        gruppi.push(group.sort((a, b) => b.fatturato - a.fatturato));
      }
    });
  });

  return gruppi.sort((a, b) => b.length - a.length);
}

// Unisce piu' punti vendita duplicati in uno solo: le schede vuote del
// canonico (agente, comune, indirizzo, provincia, cap, data attivazione,
// note) vengono completate dai duplicati — senza sovrascrivere quelle già
// valorizzate — poi le vendite dei duplicati vengono spostate sul canonico e
// i duplicati eliminati. Lo stato del canonico non viene mai toccato.
async function mergePuntiVendita(canonicalId, duplicateIds) {
  const { puntiVendita, vendite } = getState();
  const canonico = puntiVendita.find(p => String(p.id) === String(canonicalId));
  if (!canonico) return;

  const patch = {};
  const campiCompletabili = ["agente_id", "comune", "indirizzo", "provincia", "cap", "data_attivazione", "note"];
  for (const dupId of duplicateIds) {
    const dup = puntiVendita.find(p => String(p.id) === String(dupId));
    if (!dup) continue;
    campiCompletabili.forEach(campo => {
      if ((canonico[campo] == null || canonico[campo] === "") && dup[campo] != null && dup[campo] !== "") {
        if (!(campo in patch)) patch[campo] = dup[campo];
      }
    });
  }
  if (Object.keys(patch).length) await updateRow("punti_vendita", canonicalId, patch);

  const dupIdSet = new Set(duplicateIds.map(String));
  const venditeDaSpostare = vendite.filter(v => dupIdSet.has(String(v.punto_vendita_id)));
  for (const v of venditeDaSpostare) {
    await updateRow("vendite", v.id, { punto_vendita_id: Number(canonicalId) });
  }

  await deleteRows("punti_vendita", duplicateIds.map(Number));
}

function renderDuplicatiPdv() {
  const card = document.getElementById("pv-dup-card");
  if (!card) return;
  const gruppi = duplicatiPuntiVendita();
  if (!gruppi.length) {
    card.style.display = "none";
    return;
  }
  card.style.display = "";
  document.getElementById("pv-dup-count").textContent = gruppi.length;
  document.getElementById("pv-dup-list").innerHTML = gruppi.map((group, gi) => {
    const gruppo = gruppoById(group[0].gruppo_id);
    return `<details style="margin-bottom:8px;border:1px solid var(--border-color);border-radius:8px;padding:8px 12px">
      <summary style="cursor:pointer;font-size:0.85rem">
        <strong>${escapeHtml(group.map(p => p.nome_insegna).join(" / "))}</strong>
        <span class="text-muted">— ${escapeHtml(gruppo?.nome || "—")}, ${group.length} varianti</span>
      </summary>
      <div style="overflow-x:auto;margin-top:10px">
        <table class="desktop-table">
          <thead><tr><th>Canonico</th><th>Insegna</th><th>Stato</th><th>Agente</th><th style="text-align:right">Fatturato 12 mesi*</th></tr></thead>
          <tbody>
            ${group.map(p => `<tr>
              <td style="text-align:center"><input type="radio" name="pv-dup-canon-${gi}" value="${p.id}" ${p.id === group[0].id ? "checked" : ""}></td>
              <td>${escapeHtml(p.nome_insegna)}</td>
              <td>${statoBadge(STATO_PDV, p.stato)}</td>
              <td class="text-muted">${escapeHtml(agenteNome(p.agente_id) || "—")}</td>
              <td style="text-align:right" class="amount">${money(p.fatturato)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <p class="hint" style="margin:6px 0 0">*Selezionato di default quello col fatturato più alto. Le schede vuote del canonico vengono completate dagli altri (es. l'agente), il venduto degli altri si somma su quello scelto.</p>
      <button class="btn btn-sm" data-pdv-dup-merge="${gi}" style="margin-top:8px">Unisci in uno</button>
    </details>`;
  }).join("");

  gruppi.forEach((group, gi) => {
    document.querySelector(`[data-pdv-dup-merge="${gi}"]`)?.addEventListener("click", async () => {
      const canonId = document.querySelector(`input[name="pv-dup-canon-${gi}"]:checked`)?.value;
      if (!canonId) return;
      const dupIds = group.map(p => p.id).filter(id => String(id) !== String(canonId));
      if (!(await confirmDialog(`Unire ${group.length} punti vendita in uno solo? Il venduto degli altri verrà spostato su quello scelto, gli altri eliminati. Non è reversibile.`))) return;
      try {
        await mergePuntiVendita(canonId, dupIds);
        await loadAll();
        notifyDataChanged();
        toast("Punti vendita uniti", "success");
      } catch (err) {
        toastError(err);
      }
    });
  });
}

// ============================================================= VISTA ===

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
  renderDuplicatiPdv();
}

export function initPuntiVendita() {
  ["pv-search", "pv-filter-gruppo", "pv-filter-agente", "pv-filter-stato"].forEach(id => {
    document.getElementById(id).addEventListener("input", render);
    document.getElementById(id).addEventListener("change", render);
  });
  document.getElementById("pv-new").addEventListener("click", () => openPdvModal());
}
