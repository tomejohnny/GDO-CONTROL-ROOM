import * as XLSX from "xlsx";
import { escapeHtml } from "../lib/format.js";
import { TARGETS, suggestColumn, runImport } from "../lib/import-engine.js";
import { toast, toastError } from "../lib/ui.js";
import { getState } from "../lib/store.js";

// Alcuni campi (gruppo, agente) hanno quasi sempre un valore unico per tutto
// il file (es. "l'elenco punti vendita di Conad Dao Trento", o "i PdV
// dell'agente Rossi") — meglio sceglierli una volta da un menu con quelli
// già censiti che pretendere una colonna nel file.
const FIXED_VALUE_SOURCES = {
  gruppo: () => [...getState().gruppi].sort((a, b) => a.nome.localeCompare(b.nome)).map(g => ({ value: g.nome, label: g.nome })),
  agente: () => [...getState().agenti].sort((a, b) => a.cognome.localeCompare(b.cognome)).map(a => ({ value: `${a.nome} ${a.cognome}`, label: `${a.nome} ${a.cognome}` })),
};

// Macchina a stati locale: il tab viene ridisegnato da renderAll() ad ogni
// modifica dati (anche quelle innescate dall'import stesso), quindi lo stato
// del wizard va tenuto qui fuori dal DOM, non dedotto dal DOM.
let step = "pick"; // pick | mapping | preview | summary
let currentTarget = "gruppi";
let parsedHeaders = [];
let parsedRows = [];
let parsedSheets = {}; // { sheetName: rows[] }
let sheetNames = [];
let multiSheetMode = false;
let sheetGruppoNames = {}; // { sheetName: nome gruppo da usare, di default = sheetName }
let currentFilename = "";
let savedMapping = {};
let savedFixed = {};
let savedFfill = {};
let mappedRows = [];
let lastResult = null;
let fileError = null;

function resetWizard() {
  step = "pick";
  parsedHeaders = [];
  parsedRows = [];
  parsedSheets = {};
  sheetNames = [];
  multiSheetMode = false;
  currentFilename = "";
  savedMapping = {};
  savedFixed = {};
  savedFfill = {};
  mappedRows = [];
  lastResult = null;
  fileError = null;
}

function renderTargetPicker() {
  return `
    <div class="card">
      <h2>1. Scegli cosa importare</h2>
      <div class="filter-bar">
        <select id="imp-target">
          ${Object.entries(TARGETS).map(([key, t]) => `<option value="${key}" ${key === currentTarget ? "selected" : ""}>${escapeHtml(t.label)}</option>`).join("")}
        </select>
      </div>
      <p class="hint">Campi attesi per "${escapeHtml(TARGETS[currentTarget].label)}": ${TARGETS[currentTarget].fields.map(f => f.label + (f.required ? "*" : "")).join(", ")}. I campi con * sono obbligatori.</p>
      <div class="dropzone" id="imp-dropzone">
        <div>Trascina qui un file <strong>.csv</strong> o <strong>.xlsx</strong>, oppure clicca per sceglierlo</div>
        <input type="file" id="imp-file" accept=".csv,.xlsx,.xls" hidden>
      </div>
      ${fileError ? `<div class="empty-state" style="text-align:left;color:var(--accent-red);background:var(--accent-red-soft);border-radius:8px;margin-top:12px;padding:12px">${escapeHtml(fileError)}</div>` : ""}
    </div>`;
}

export function render() {
  const container = document.getElementById("import-content");
  if (!container) return;
  container.innerHTML = renderTargetPicker() + `<div id="imp-wizard-area"></div>`;

  document.getElementById("imp-target").addEventListener("change", event => {
    currentTarget = event.target.value;
    resetWizard();
    render();
  });

  const dropzone = document.getElementById("imp-dropzone");
  const fileInput = document.getElementById("imp-file");
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", event => { event.preventDefault(); dropzone.classList.add("drag"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
  dropzone.addEventListener("drop", event => {
    event.preventDefault();
    dropzone.classList.remove("drag");
    if (event.dataTransfer.files?.[0]) handleFile(event.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", event => {
    if (event.target.files?.[0]) handleFile(event.target.files[0]);
  });

  if (step === "mapping") renderMapping();
  else if (step === "preview") renderPreview();
  else if (step === "summary") renderSummary();
}

function friendlyFileError(err) {
  const msg = err?.message || "";
  if (/zip/i.test(msg)) {
    return `Non riesco a leggere questo file come Excel/CSV valido (${msg}). Capita spesso con file esportati da gestionali con estensione .xlsx ma non in vero formato Excel: prova ad aprirlo in Excel e a salvarlo di nuovo come .xlsx, oppure esportalo come CSV e carica quello.`;
  }
  return `Errore nella lettura del file: ${msg || "formato non riconosciuto"}.`;
}

async function handleFile(file) {
  fileError = null;
  try {
    const buffer = await file.arrayBuffer();
    let workbook;
    try {
      workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    } catch (zipErr) {
      // Molti "Excel" esportati da gestionali/ERP sono in realta' tabelle HTML
      // o XML (SpreadsheetML) salvate con estensione .xlsx: il parser ZIP
      // fallisce, ma SheetJS li legge comunque se passati come testo.
      const text = new TextDecoder("utf-8").decode(buffer);
      workbook = XLSX.read(text, { type: "string", cellDates: true });
    }
    sheetNames = workbook.SheetNames;
    parsedSheets = {};
    sheetGruppoNames = {};
    sheetNames.forEach(name => {
      parsedSheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "", raw: false });
    });
    const rows = parsedSheets[sheetNames[0]];
    if (!rows.length) {
      fileError = "Il file non contiene righe di dati.";
      render();
      return;
    }
    parsedHeaders = Object.keys(rows[0]);
    parsedRows = rows;
    currentFilename = file.name;
    savedMapping = {};
    savedFixed = {};
    savedFfill = {};
    sheetNames.forEach(name => { sheetGruppoNames[name] = name; });
    multiSheetMode = sheetNames.length > 1;
    step = "mapping";
    renderMapping();
  } catch (err) {
    fileError = friendlyFileError(err);
    render();
  }
}

function forwardFillColumn(rows, column) {
  let last = "";
  return rows.map(row => {
    const val = row[column];
    if (val !== "" && val != null) { last = val; return row; }
    return { ...row, [column]: last };
  });
}

function buildMappedRowsForSheet(rows, target, mapping, fixed, ffill, forcedGruppo) {
  let workingRows = rows;
  target.fields.forEach(f => {
    if (!fixed[f.key] && ffill[f.key] && mapping[f.key]) {
      workingRows = forwardFillColumn(workingRows, mapping[f.key]);
    }
  });
  return workingRows.map(row => {
    const mapped = {};
    target.fields.forEach(f => {
      if (f.key === "gruppo" && forcedGruppo) mapped[f.key] = forcedGruppo;
      else if (fixed[f.key]) mapped[f.key] = fixed[f.key];
      else mapped[f.key] = mapping[f.key] ? row[mapping[f.key]] : "";
    });
    return mapped;
  });
}

function renderMapping() {
  const area = document.getElementById("imp-wizard-area");
  if (!area) return;
  const target = TARGETS[currentTarget];
  const hasGruppoField = target.fields.some(f => f.key === "gruppo");

  area.innerHTML = `
    <div class="card">
      <h2>2. Fai corrispondere le colonne</h2>
      <p class="hint">File: <strong>${escapeHtml(currentFilename)}</strong> — ${parsedRows.length} righe trovate${sheetNames.length > 1 ? ` nel primo di ${sheetNames.length} fogli (${escapeHtml(sheetNames.join(", "))})` : ""}. Ho provato ad abbinare automaticamente le colonne, correggi dove serve. Per "Gruppo GDO" e "Agente" puoi anche scegliere un valore fisso già censito, valido per tutte le righe del file, invece di mapparlo da una colonna.</p>
      ${sheetNames.length > 1 && hasGruppoField ? `
        <div class="calculator-box" style="margin-bottom:14px">
          <label style="display:flex;align-items:center;gap:8px;font-size:0.8rem;color:var(--text-main)">
            <input type="checkbox" id="imp-multisheet" style="width:auto" ${multiSheetMode ? "checked" : ""}>
            Importa tutti i ${sheetNames.length} fogli insieme, usando il nome di ciascun foglio come Gruppo GDO
          </label>
          ${multiSheetMode ? `
            <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px">
              <p class="hint" style="margin:0">Se un foglio corrisponde a un gruppo che hai già censito con un altro nome, correggilo qui prima di importare (altrimenti verrebbe creato un gruppo duplicato).</p>
              ${sheetNames.map(name => `
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:0.75rem;color:var(--text-muted);min-width:130px">${escapeHtml(name)} →</span>
                  <input type="text" data-sheet-gruppo="${escapeHtml(name)}" value="${escapeHtml(sheetGruppoNames[name] ?? name)}" style="padding:6px 8px;font-size:0.78rem;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);flex:1">
                </div>`).join("")}
            </div>` : ""}
        </div>` : ""}
      <div style="overflow-x:auto">
        <table class="mapping-table">
          <thead><tr><th>Campo destinazione</th><th>Colonna nel file</th></tr></thead>
          <tbody>
            ${target.fields.map(f => {
              const isGruppoForced = f.key === "gruppo" && multiSheetMode && hasGruppoField && sheetNames.length > 1;
              if (isGruppoForced) {
                return `<tr>
                  <td>${escapeHtml(f.label)}${f.required ? " <span class=\"text-red\">*</span>" : ""}</td>
                  <td class="text-muted" style="font-size:0.78rem">Preso dal nome del foglio (vedi sopra)</td>
                </tr>`;
              }
              const selected = savedMapping[f.key] ?? suggestColumn(f.key, parsedHeaders);
              const fixedValue = savedFixed[f.key] || "";
              const columnSelectHtml = `
                <select data-map-field="${f.key}" ${fixedValue ? "disabled" : ""}>
                  <option value="">— Nessuna colonna —</option>
                  ${parsedHeaders.map(h => `<option value="${escapeHtml(h)}" ${selected === h ? "selected" : ""}>${escapeHtml(h)}</option>`).join("")}
                </select>
                <label style="font-size:0.65rem;color:var(--text-muted);display:flex;align-items:center;gap:4px;margin-top:3px">
                  <input type="checkbox" data-ffill-field="${f.key}" style="width:auto" ${savedFfill[f.key] ? "checked" : ""}>
                  celle unite: riempi verso il basso
                </label>`;

              if (f.type === "date") {
                return `<tr>
                  <td>${escapeHtml(f.label)}${f.required ? " <span class=\"text-red\">*</span>" : ""}</td>
                  <td>
                    <div style="display:flex;flex-direction:column;gap:6px">
                      <div style="display:flex;gap:6px;align-items:center">
                        <span style="font-size:0.72rem;color:var(--text-muted)">Data fissa per tutto il file:</span>
                        <input type="date" data-fixed-field="${f.key}" value="${escapeHtml(fixedValue)}">
                      </div>
                      <div>${columnSelectHtml}</div>
                    </div>
                  </td>
                </tr>`;
              }

              const fixedSource = FIXED_VALUE_SOURCES[f.key];
              if (!fixedSource) {
                return `<tr>
                  <td>${escapeHtml(f.label)}${f.required ? " <span class=\"text-red\">*</span>" : ""}</td>
                  <td>${columnSelectHtml}</td>
                </tr>`;
              }
              const options = fixedSource();
              return `<tr>
                <td>${escapeHtml(f.label)}${f.required ? " <span class=\"text-red\">*</span>" : ""}</td>
                <td>
                  <div style="display:flex;flex-direction:column;gap:6px">
                    <select data-fixed-field="${f.key}">
                      <option value="">— Usa una colonna del file —</option>
                      ${options.map(o => `<option value="${escapeHtml(o.value)}" ${fixedValue === o.value ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
                    </select>
                    <div>${columnSelectHtml}</div>
                  </div>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="actions-bar" style="margin-top:14px;margin-bottom:0">
        <button class="btn btn-ghost" id="imp-cancel">Annulla</button>
        <button class="btn" id="imp-next">Avanti: anteprima</button>
      </div>
    </div>`;

  document.getElementById("imp-cancel").addEventListener("click", () => { resetWizard(); render(); });

  document.getElementById("imp-multisheet")?.addEventListener("change", event => {
    multiSheetMode = event.target.checked;
    renderMapping();
  });

  document.querySelectorAll("[data-sheet-gruppo]").forEach(el => {
    el.addEventListener("input", () => {
      sheetGruppoNames[el.dataset.sheetGruppo] = el.value.trim() || el.dataset.sheetGruppo;
    });
  });

  document.querySelectorAll("[data-fixed-field]").forEach(el => {
    el.addEventListener("change", () => {
      const columnSelect = document.querySelector(`[data-map-field="${el.dataset.fixedField}"]`);
      if (columnSelect) columnSelect.disabled = !!el.value;
    });
  });

  document.getElementById("imp-next").addEventListener("click", () => {
    const target = TARGETS[currentTarget];
    const mapping = {};
    document.querySelectorAll("[data-map-field]").forEach(el => { mapping[el.dataset.mapField] = el.value; });
    const fixed = {};
    document.querySelectorAll("[data-fixed-field]").forEach(el => { if (el.value) fixed[el.dataset.fixedField] = el.value; });
    const ffill = {};
    document.querySelectorAll("[data-ffill-field]").forEach(el => { ffill[el.dataset.ffillField] = el.checked; });

    const multiSheet = multiSheetMode && hasGruppoField && sheetNames.length > 1;
    const missingRequired = target.fields.filter(f => {
      if (f.key === "gruppo" && multiSheet) return false;
      return f.required && !mapping[f.key] && !fixed[f.key];
    });
    if (missingRequired.length) {
      toast(`Fai corrispondere anche: ${missingRequired.map(f => f.label).join(", ")}`, "error");
      return;
    }

    savedMapping = mapping;
    savedFixed = fixed;
    savedFfill = ffill;

    if (multiSheet) {
      mappedRows = sheetNames.flatMap(name => buildMappedRowsForSheet(parsedSheets[name], target, mapping, fixed, ffill, sheetGruppoNames[name] || name));
    } else {
      mappedRows = buildMappedRowsForSheet(parsedRows, target, mapping, fixed, ffill, null);
    }

    step = "preview";
    renderPreview();
  });
}

function renderPreview() {
  const area = document.getElementById("imp-wizard-area");
  if (!area) return;
  const target = TARGETS[currentTarget];
  const previewRows = mappedRows.slice(0, 8);

  area.innerHTML = `
    <div class="card">
      <h2>2. Fai corrispondere le colonne</h2>
      <p class="hint">File: <strong>${escapeHtml(currentFilename)}</strong> — ${parsedRows.length} righe. <span class="row-link" id="imp-edit-mapping">Modifica corrispondenze</span></p>
    </div>
    <div class="card">
      <h2>3. Anteprima e conferma</h2>
      <p class="hint">Prime ${previewRows.length} righe su ${mappedRows.length}. Gruppo, punto vendita o articolo non trovati verranno creati automaticamente.</p>
      <div style="overflow-x:auto">
        <table class="desktop-table">
          <thead><tr>${target.fields.map(f => `<th>${escapeHtml(f.label)}</th>`).join("")}</tr></thead>
          <tbody>
            ${previewRows.map(r => `<tr>${target.fields.map(f => `<td>${escapeHtml(r[f.key] ?? "")}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="actions-bar" style="margin-top:14px;margin-bottom:0">
        <button class="btn btn-green" id="imp-confirm">Importa ${mappedRows.length} righe</button>
      </div>
      <div id="imp-progress" style="margin-top:10px;font-size:0.8rem;color:var(--text-muted)"></div>
    </div>`;

  document.getElementById("imp-edit-mapping").addEventListener("click", () => { step = "mapping"; renderMapping(); });

  document.getElementById("imp-confirm").addEventListener("click", async () => {
    const confirmBtn = document.getElementById("imp-confirm");
    confirmBtn.disabled = true;
    const progressEl = document.getElementById("imp-progress");
    const targetKey = currentTarget;
    const rowsToImport = mappedRows;
    const filename = currentFilename;
    try {
      const result = await runImport(targetKey, rowsToImport, filename, (done, total) => {
        const el = document.getElementById("imp-progress");
        if (el) el.textContent = `Importazione in corso: ${done} / ${total}...`;
      });
      lastResult = result;
      step = "summary";
      render();
    } catch (err) {
      toastError(err);
      if (progressEl) progressEl.textContent = "";
      confirmBtn.disabled = false;
    }
  });
}

function renderSummary() {
  const area = document.getElementById("imp-wizard-area");
  if (!area || !lastResult) return;
  const result = lastResult;

  area.innerHTML = `
    <div class="card">
      <h2>Importazione completata</h2>
      <div class="import-summary">
        <div><strong class="text-green">${result.ok}</strong> righe importate</div>
        <div><strong class="${result.errori ? "text-red" : ""}">${result.errori}</strong> righe con errori</div>
        <div><strong>${result.totale}</strong> righe totali nel file</div>
      </div>
      ${result.dettagliWarning.length ? `
        <div style="margin-top:14px">
          <p class="hint">Note (creazioni automatiche):</p>
          <div class="empty-state" style="text-align:left;padding:10px;font-size:0.75rem">${result.dettagliWarning.slice(0, 30).map(escapeHtml).join("<br>")}${result.dettagliWarning.length > 30 ? `<br>… e altre ${result.dettagliWarning.length - 30}` : ""}</div>
        </div>` : ""}
      ${result.dettagliErrori.length ? `
        <div style="margin-top:14px">
          <p class="hint text-red">Righe non importate:</p>
          <div class="empty-state" style="text-align:left;padding:10px;font-size:0.75rem;color:var(--accent-red)">${result.dettagliErrori.slice(0, 30).map(escapeHtml).join("<br>")}${result.dettagliErrori.length > 30 ? `<br>… e altre ${result.dettagliErrori.length - 30}` : ""}</div>
        </div>` : ""}
      <div class="actions-bar" style="margin-top:14px;margin-bottom:0">
        <button class="btn" id="imp-new">Nuovo import</button>
      </div>
    </div>`;
  document.getElementById("imp-new").addEventListener("click", () => { resetWizard(); render(); });
}
