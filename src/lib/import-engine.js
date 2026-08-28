import { getState, loadAll } from "./store.js";
import { insertRow, updateRow } from "./db.js";
import { notifyDataChanged } from "./bus.js";

// ------------------------------------------------------------- utilità ---

const DIACRITICS_RANGE = new RegExp("[̀-ͯ]", "g");

export function normalizeKey(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS_RANGE, "")
    .replace(/[^a-z0-9]/g, "");
}

// Come normalizeKey, ma per i codici articolo: "01011018240" e "1011018240"
// sono lo stesso codice con zeri iniziali persi/aggiunti da export diversi
// (Excel in particolare li droppa se la colonna è numerica). Senza questo,
// resolveArticoloId li tratterebbe come due articoli distinti.
export function normalizeCodice(s) {
  return normalizeKey(s).replace(/^0+(?=.)/, "");
}

const SUBTOTAL_WORDS = ["totale", "totali", "totalecomplessivo", "subtotale", "somma", "riepilogo", "grandtotal", "total"];

// Molti export da gestionali aggiungono una riga di riepilogo/totale a fine
// blocco (es. "TOTALE" come nome punto vendita): se importata come se fosse
// un punto vendita vero, raddoppia i valori nei totali aggregati.
export function isSubtotalLabel(text) {
  const key = normalizeKey(text);
  return SUBTOTAL_WORDS.some(w => key === w);
}

const SYNONYMS = {
  nome: ["nome", "gruppo", "nomegruppo", "insegnagruppo", "catena"],
  gruppo: ["gruppo", "gruppogdo", "insegnagruppo", "catena", "nomegruppo"],
  area_geografica: ["area", "zona", "areageografica", "regione"],
  stato: ["stato", "status"],
  referente_buyer: ["buyer", "referente", "referentebuyer", "buyerreferente"],
  contatto_buyer: ["contatto", "contattobuyer", "emailbuyer", "telefonobuyer"],
  nome_insegna: ["insegna", "nomeinsegna", "puntovendita", "pdv", "nomepdv", "nomepuntovendita", "destinazione"],
  punto_vendita: ["puntovendita", "pdv", "insegna", "nomeinsegna", "nomepuntovendita", "destinazione"],
  indirizzo: ["indirizzo", "via", "address"],
  comune: ["comune", "citta", "city"],
  provincia: ["provincia", "prov"],
  cap: ["cap", "zip"],
  agente: ["agente", "commerciale", "venditore", "agenteassegnato"],
  data_attivazione: ["dataattivazione", "attivazione", "datainizio", "dataattivaz"],
  cognome: ["cognome", "surname"],
  telefono: ["telefono", "tel", "cellulare", "cell", "phone"],
  email: ["email", "mail", "posta"],
  attivo: ["attivo", "active"],
  articolo: ["articolo", "prodotto", "descrizionearticolo", "sku", "descrizione", "descr", "descrmag"],
  codice_articolo: ["codice", "codicearticolo", "sku", "codprod", "codmag"],
  categoria: ["categoria", "reparto", "categoriaarticolo"],
  periodo: ["periodo", "mese", "data", "annomese", "meseanno"],
  quantita: ["quantita", "qta", "quantity", "colli", "pezzi"],
  valore_euro: ["valore", "importo", "fatturato", "euro", "valoreeuro", "venduto", "ricavo", "importovendita"],
  costo_acquisto: ["costoacquisto", "importoacquisto", "costo", "acquisto"],
  margine_percentuale: ["mar", "margine", "margapercentuale", "margpercentuale"],
  margine_valore: ["utilel", "utile", "margvalore", "marvalore"],
  ricarico_percentuale: ["ric", "ricarico", "ricaricopercentuale"],
  prezzo_medio_vendita: ["pmv", "prezzomedio", "prezzomediovendita"],
  quantita_omaggio: ["omaggio", "omaggi", "quantitaomaggio"],
  note: ["note", "notes", "annotazioni"],
};

export function suggestColumn(fieldKey, headers) {
  const candidates = SYNONYMS[fieldKey] || [fieldKey];
  const normHeaders = headers.map(h => ({ h, n: normalizeKey(h) }));
  for (const cand of candidates) {
    const nc = normalizeKey(cand);
    const exact = normHeaders.find(x => x.n === nc);
    if (exact) return exact.h;
  }
  for (const cand of candidates) {
    const nc = normalizeKey(cand);
    const partial = normHeaders.find(x => x.n.includes(nc) || nc.includes(x.n));
    if (partial) return partial.h;
  }
  return "";
}

function s(value) {
  return value == null ? "" : String(value).trim();
}

function num(value) {
  if (value === "" || value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  // Ripulisce simboli di valuta, spazi e altri caratteri non numerici (es.
  // "€ 11.535,50" o "11,535.50 EUR"), poi capisce quale tra "," e "." e' il
  // separatore decimale in base a quale compare per ultimo nella stringa.
  let s = String(value).trim().replace(/[^\d,.\-]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma !== -1) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const MONTHS_IT = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };

export function parseDateLoose(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const str = String(value).trim();
  if (!str) return null;

  let m = str.match(/^(\d{4})-(\d{1,2})(-(\d{1,2}))?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${(m[4] || "01").padStart(2, "0")}`;

  m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;

  m = str.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}-01`;

  m = str.toLowerCase().match(/^([a-zà-ù]+)\s+(\d{4})$/);
  if (m && MONTHS_IT[m[1]]) return `${m[2]}-${String(MONTHS_IT[m[1]]).padStart(2, "0")}-01`;

  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// ---------------------------------------------------------- risoluzione ---

function buildContext() {
  const state = getState();
  const gruppiByName = new Map(state.gruppi.map(g => [normalizeKey(g.nome), g.id]));
  const agentiByFull = new Map(state.agenti.map(a => [normalizeKey(`${a.nome} ${a.cognome}`), a.id]));
  const agentiByCognome = new Map(state.agenti.map(a => [normalizeKey(a.cognome), a.id]));
  const articoliByDesc = new Map(state.articoli.map(a => [normalizeKey(a.descrizione), a.id]));
  const articoliByCodice = new Map(state.articoli.filter(a => a.codice).map(a => [normalizeCodice(a.codice), a.id]));
  const pdvByKey = new Map(state.puntiVendita.map(p => [`${p.gruppo_id}::${normalizeKey(p.nome_insegna)}`, p.id]));
  // Per l'import dell'anagrafica: alcune insegne (es. "Maxi Family") si
  // ripetono su decine di indirizzi diversi. Nome da solo le confonderebbe
  // tutte in un unico punto vendita: qui la chiave include anche comune e
  // indirizzo per distinguere le sedi fisiche reali.
  const pdvByKeyDetailed = new Map(state.puntiVendita.map(p => [`${p.gruppo_id}::${normalizeKey(p.nome_insegna)}::${normalizeKey(p.comune)}::${normalizeKey(p.indirizzo)}`, p.id]));
  const pdvStato = new Map(state.puntiVendita.map(p => [p.id, p.stato]));
  const assortByKey = new Map(state.assortimenti.map(r => [`${r.gruppo_id}::${r.articolo_id}`, r.id]));
  const venditeByKey = new Map(state.vendite.map(v => [`${v.gruppo_id}::${v.punto_vendita_id}::${v.articolo_id}::${v.periodo}`, v.id]));
  return { gruppiByName, agentiByFull, agentiByCognome, articoliByDesc, articoliByCodice, pdvByKey, pdvByKeyDetailed, pdvStato, assortByKey, venditeByKey };
}

// Un punto vendita con vendite vere importate e' per forza servito, anche
// se l'anagrafica di partenza non lo segnalava come tale.
async function markServitoSeNecessario(ctx, pdvId) {
  if (pdvId == null || ctx.pdvStato.get(pdvId) === "servito") return;
  await updateRow("punti_vendita", pdvId, { stato: "servito" });
  ctx.pdvStato.set(pdvId, "servito");
}

async function resolveGruppoId(ctx, nomeGruppo, warnings) {
  const key = normalizeKey(nomeGruppo);
  if (ctx.gruppiByName.has(key)) return ctx.gruppiByName.get(key);
  const created = await insertRow("gdo_groups", { nome: nomeGruppo, stato: "attivo" });
  ctx.gruppiByName.set(key, created.id);
  warnings.push(`gruppo "${nomeGruppo}" non trovato: creato automaticamente`);
  return created.id;
}

async function resolvePdvId(ctx, gruppoId, nomeInsegna, warnings) {
  const key = `${gruppoId}::${normalizeKey(nomeInsegna)}`;
  if (ctx.pdvByKey.has(key)) return ctx.pdvByKey.get(key);
  const created = await insertRow("punti_vendita", { gruppo_id: gruppoId, nome_insegna: nomeInsegna, stato: "non_servito" });
  ctx.pdvByKey.set(key, created.id);
  warnings.push(`punto vendita "${nomeInsegna}" non trovato: creato automaticamente (stato non servito)`);
  return created.id;
}

const CATEGORIA_KEYWORDS = [
  ["formaggi", ["form", "mozz", "ricotta", "casel", "stagion", "dop"]],
  ["salumi", ["salam", "sopress", "speck", "pancett", "coteching", "prosciutt", "affettat"]],
  ["congelato", ["congel", "surgel", "iqf"]],
  ["carne_pesce", ["carne", "pollo", "manzo", "pesce", "salmone", "trota", "bovis"]],
];

function guessCategoria(descrizione) {
  const key = normalizeKey(descrizione);
  const found = CATEGORIA_KEYWORDS.find(([, words]) => words.some(w => key.includes(w)));
  return found ? found[0] : "scaffale";
}

async function resolveArticoloId(ctx, descrizione, codice, categoria, warnings) {
  const codiceKey = codice ? normalizeCodice(codice) : null;
  if (codiceKey && ctx.articoliByCodice.has(codiceKey)) return ctx.articoliByCodice.get(codiceKey);

  const descKey = normalizeKey(descrizione);
  if (!codiceKey && ctx.articoliByDesc.has(descKey)) return ctx.articoliByDesc.get(descKey);

  const cat = ["formaggi", "salumi", "congelato", "carne_pesce", "scaffale"].includes(categoria) ? categoria : guessCategoria(descrizione);
  const created = await insertRow("articoli", { descrizione, codice: codice || null, categoria: cat });
  ctx.articoliByDesc.set(descKey, created.id);
  if (codiceKey) ctx.articoliByCodice.set(codiceKey, created.id);
  warnings.push(`articolo "${descrizione}" non trovato a catalogo: creato automaticamente (${cat})`);
  return created.id;
}

function resolveAgenteId(ctx, testo, warnings) {
  if (!testo) return null;
  const key = normalizeKey(testo);
  if (ctx.agentiByFull.has(key)) return ctx.agentiByFull.get(key);
  if (ctx.agentiByCognome.has(key)) return ctx.agentiByCognome.get(key);
  warnings.push(`agente "${testo}" non trovato: riga importata senza agente assegnato`);
  return null;
}

function normStato(value, allowed, fallback) {
  const v = normalizeKey(value);
  const match = allowed.find(a => normalizeKey(a) === v);
  return match || fallback;
}

// -------------------------------------------------------------- targets ---

export const TARGETS = {
  gruppi: {
    label: "Gruppi GDO",
    table: "gdo_groups",
    fields: [
      { key: "nome", label: "Nome gruppo", required: true },
      { key: "area_geografica", label: "Area geografica" },
      { key: "stato", label: "Stato (attivo/target/sospeso)" },
      { key: "referente_buyer", label: "Referente buyer" },
      { key: "contatto_buyer", label: "Contatto buyer" },
      { key: "note", label: "Note" },
    ],
    async importRow(row, ctx) {
      const nome = s(row.nome);
      if (!nome) return { ok: false, error: "nome gruppo mancante" };
      const warnings = [];
      const payload = {
        nome,
        area_geografica: s(row.area_geografica) || null,
        stato: normStato(row.stato, ["attivo", "target", "sospeso"], "attivo"),
        referente_buyer: s(row.referente_buyer) || null,
        contatto_buyer: s(row.contatto_buyer) || null,
        note: s(row.note) || null,
      };
      const key = normalizeKey(nome);
      const existingId = ctx.gruppiByName.get(key);
      if (existingId) await updateRow("gdo_groups", existingId, payload);
      else {
        const created = await insertRow("gdo_groups", payload);
        ctx.gruppiByName.set(key, created.id);
      }
      return { ok: true, warnings };
    },
  },

  punti_vendita: {
    label: "Punti vendita",
    table: "punti_vendita",
    fields: [
      { key: "gruppo", label: "Gruppo GDO", required: true },
      { key: "nome_insegna", label: "Nome insegna", required: true },
      { key: "indirizzo", label: "Indirizzo" },
      { key: "comune", label: "Comune" },
      { key: "provincia", label: "Provincia" },
      { key: "cap", label: "CAP" },
      { key: "stato", label: "Stato (servito/non_servito/target/sospeso)" },
      { key: "agente", label: "Agente assegnato (nome cognome)" },
      { key: "data_attivazione", label: "Data attivazione" },
      { key: "note", label: "Note" },
    ],
    async importRow(row, ctx) {
      const gruppoNome = s(row.gruppo);
      const nomeInsegna = s(row.nome_insegna);
      if (!gruppoNome) return { ok: false, error: "gruppo mancante" };
      if (!nomeInsegna) return { ok: false, error: "nome insegna mancante" };
      if (isSubtotalLabel(nomeInsegna)) return { ok: false, error: `riga di riepilogo/totale esclusa ("${nomeInsegna}" non è un punto vendita reale)` };
      const warnings = [];
      const gruppoId = await resolveGruppoId(ctx, gruppoNome, warnings);
      const comune = s(row.comune) || null;
      const indirizzo = s(row.indirizzo) || null;

      // Match preciso per nome+comune+indirizzo quando il file li fornisce.
      // Un file "parziale" (es. solo nome+agente, senza indirizzo) ricade
      // sul nome da solo, ma solo se univoco nel gruppo — altrimenti
      // rischierebbe di aggiornare il punto vendita sbagliato.
      let existingId = null;
      if (comune || indirizzo) {
        existingId = ctx.pdvByKeyDetailed.get(`${gruppoId}::${normalizeKey(nomeInsegna)}::${normalizeKey(comune)}::${normalizeKey(indirizzo)}`);
      }
      if (!existingId) {
        const prefix = `${gruppoId}::${normalizeKey(nomeInsegna)}::`;
        const matches = [...ctx.pdvByKeyDetailed.entries()].filter(([k]) => k.startsWith(prefix));
        if (matches.length === 1) existingId = matches[0][1];
        else if (matches.length > 1) {
          return { ok: false, error: `"${nomeInsegna}" corrisponde a ${matches.length} punti vendita diversi in questo gruppo: aggiungi comune/indirizzo nel file per distinguerli` };
        }
      }

      const agenteId = row.agente ? resolveAgenteId(ctx, s(row.agente), warnings) : null;

      if (existingId) {
        // Update parziale: tocca solo i campi che questa riga valorizza
        // davvero, cosi' un file con sole 2-3 colonne (es. solo l'agente)
        // non sovrascrive con vuoto/default gli altri campi gia' censiti.
        const patch = {};
        if (row.indirizzo) patch.indirizzo = indirizzo;
        if (row.comune) patch.comune = comune;
        if (row.provincia) patch.provincia = s(row.provincia).toUpperCase();
        if (row.cap) patch.cap = s(row.cap);
        if (row.stato) patch.stato = normStato(row.stato, ["servito", "non_servito", "target", "sospeso"], "non_servito");
        if (row.agente) patch.agente_id = agenteId;
        if (row.data_attivazione) patch.data_attivazione = parseDateLoose(row.data_attivazione);
        if (row.note) patch.note = s(row.note);
        if (Object.keys(patch).length) await updateRow("punti_vendita", existingId, patch);
      } else {
        const payload = {
          gruppo_id: gruppoId,
          nome_insegna: nomeInsegna,
          indirizzo,
          comune,
          provincia: s(row.provincia).toUpperCase() || null,
          cap: s(row.cap) || null,
          stato: normStato(row.stato, ["servito", "non_servito", "target", "sospeso"], "non_servito"),
          agente_id: agenteId,
          data_attivazione: parseDateLoose(row.data_attivazione),
          note: s(row.note) || null,
        };
        const created = await insertRow("punti_vendita", payload);
        ctx.pdvByKeyDetailed.set(`${gruppoId}::${normalizeKey(nomeInsegna)}::${normalizeKey(comune)}::${normalizeKey(indirizzo)}`, created.id);
        ctx.pdvByKey.set(`${gruppoId}::${normalizeKey(nomeInsegna)}`, created.id);
      }
      return { ok: true, warnings };
    },
  },

  agenti: {
    label: "Agenti",
    table: "agenti",
    fields: [
      { key: "nome", label: "Nome", required: true },
      { key: "cognome", label: "Cognome", required: true },
      { key: "zona", label: "Zona" },
      { key: "telefono", label: "Telefono" },
      { key: "email", label: "Email" },
      { key: "attivo", label: "Attivo (si/no)" },
    ],
    async importRow(row, ctx) {
      const nome = s(row.nome);
      const cognome = s(row.cognome);
      if (!nome || !cognome) return { ok: false, error: "nome o cognome mancante" };
      const attivoRaw = s(row.attivo).toLowerCase();
      const payload = {
        nome,
        cognome,
        zona: s(row.zona) || null,
        telefono: s(row.telefono) || null,
        email: s(row.email) || null,
        attivo: !["no", "false", "0", "non attivo", "inattivo"].includes(attivoRaw),
      };
      const key = normalizeKey(`${nome} ${cognome}`);
      const existingId = ctx.agentiByFull.get(key);
      if (existingId) await updateRow("agenti", existingId, payload);
      else {
        const created = await insertRow("agenti", payload);
        ctx.agentiByFull.set(key, created.id);
      }
      return { ok: true, warnings: [] };
    },
  },

  assortimenti: {
    label: "Assortimenti",
    table: "assortimenti",
    fields: [
      { key: "gruppo", label: "Gruppo GDO", required: true },
      { key: "articolo", label: "Articolo", required: true },
      { key: "codice_articolo", label: "Codice articolo (se disponibile, match più preciso)" },
      { key: "categoria", label: "Categoria articolo (se nuovo)" },
      { key: "stato", label: "Stato (attivo/proposto/in_trattativa/rifiutato/sospeso)" },
      { key: "data_inizio", label: "Data inizio" },
      { key: "note", label: "Note" },
    ],
    async importRow(row, ctx) {
      const gruppoNome = s(row.gruppo);
      const articoloDesc = s(row.articolo);
      if (!gruppoNome || !articoloDesc) return { ok: false, error: "gruppo o articolo mancante" };
      const warnings = [];
      const gruppoId = await resolveGruppoId(ctx, gruppoNome, warnings);
      const categoriaHint = normalizeKey(row.categoria) ? s(row.categoria).toLowerCase().replace(/\s+/g, "_") : "";
      const articoloId = await resolveArticoloId(ctx, articoloDesc, s(row.codice_articolo), categoriaHint, warnings);
      const payload = {
        gruppo_id: gruppoId,
        articolo_id: articoloId,
        stato: normStato(row.stato, ["attivo", "proposto", "in_trattativa", "rifiutato", "sospeso"], "proposto"),
        data_inizio: parseDateLoose(row.data_inizio),
        note: s(row.note) || null,
      };
      const key = `${gruppoId}::${articoloId}`;
      const existingId = ctx.assortByKey.get(key);
      if (existingId) await updateRow("assortimenti", existingId, payload);
      else {
        const created = await insertRow("assortimenti", payload);
        ctx.assortByKey.set(key, created.id);
      }
      return { ok: true, warnings };
    },
  },

  vendite: {
    label: "Statistiche venduto",
    table: "vendite",
    fields: [
      { key: "gruppo", label: "Gruppo GDO", required: true },
      { key: "punto_vendita", label: "Punto vendita (opzionale, se dato aggregato)" },
      { key: "articolo", label: "Articolo (opzionale, se dato aggregato)" },
      { key: "codice_articolo", label: "Codice articolo (se disponibile, match più preciso)" },
      { key: "periodo", label: "Periodo (mese/data)", required: true, type: "date" },
      { key: "quantita", label: "Quantità" },
      { key: "valore_euro", label: "Valore vendita (€)" },
      { key: "costo_acquisto", label: "Costo di acquisto (€)" },
      { key: "margine_percentuale", label: "Margine %" },
      { key: "margine_valore", label: "Margine (€)" },
      { key: "ricarico_percentuale", label: "Ricarico %" },
      { key: "prezzo_medio_vendita", label: "Prezzo medio di vendita" },
      { key: "quantita_omaggio", label: "Quantità omaggio" },
    ],
    async importRow(row, ctx, importBatchId) {
      const gruppoNome = s(row.gruppo);
      const periodo = parseDateLoose(row.periodo);
      if (!gruppoNome) return { ok: false, error: "gruppo mancante" };
      if (!periodo) return { ok: false, error: "periodo non riconosciuto" };
      const pdvNome = s(row.punto_vendita);
      if (isSubtotalLabel(pdvNome)) return { ok: false, error: `riga di riepilogo/totale esclusa ("${pdvNome}" non è un punto vendita reale)` };
      const warnings = [];
      const gruppoId = await resolveGruppoId(ctx, gruppoNome, warnings);
      const pdvId = pdvNome ? await resolvePdvId(ctx, gruppoId, pdvNome, warnings) : null;
      await markServitoSeNecessario(ctx, pdvId);
      const articoloDesc = s(row.articolo);
      const articoloId = articoloDesc ? await resolveArticoloId(ctx, articoloDesc, s(row.codice_articolo), "", warnings) : null;
      const payload = {
        gruppo_id: gruppoId,
        punto_vendita_id: pdvId,
        articolo_id: articoloId,
        periodo,
        quantita: num(row.quantita),
        valore_euro: num(row.valore_euro),
        costo_acquisto: num(row.costo_acquisto),
        margine_percentuale: num(row.margine_percentuale),
        margine_valore: num(row.margine_valore),
        ricarico_percentuale: num(row.ricarico_percentuale),
        prezzo_medio_vendita: num(row.prezzo_medio_vendita),
        quantita_omaggio: num(row.quantita_omaggio),
        import_batch_id: importBatchId,
      };
      // Chiave naturale gruppo+PdV+articolo+periodo: rieseguire lo stesso
      // import (es. dopo un'interruzione a meta') aggiorna le righe gia'
      // presenti invece di duplicarle.
      const key = `${gruppoId}::${pdvId}::${articoloId}::${periodo}`;
      const existingId = ctx.venditeByKey.get(key);
      if (existingId) await updateRow("vendite", existingId, payload);
      else {
        const created = await insertRow("vendite", payload);
        ctx.venditeByKey.set(key, created.id);
      }
      return { ok: true, warnings };
    },
  },
};

// -------------------------------------------------------------- runner ---

export async function runImport(targetKey, mappedRows, filename, onProgress) {
  const target = TARGETS[targetKey];
  const ctx = buildContext();

  let importBatchId = null;
  if (targetKey === "vendite") {
    const batch = await insertRow("import_batches", { tabella_target: target.table, filename, righe_totali: mappedRows.length });
    importBatchId = batch.id;
  }

  let ok = 0;
  let errori = 0;
  const dettagliErrori = [];
  const dettagliWarning = [];

  for (let i = 0; i < mappedRows.length; i++) {
    const row = mappedRows[i];
    try {
      const result = await target.importRow(row, ctx, importBatchId);
      if (result.ok) {
        ok++;
        (result.warnings || []).forEach(w => dettagliWarning.push(`Riga ${i + 2}: ${w}`));
      } else {
        errori++;
        dettagliErrori.push(`Riga ${i + 2}: ${result.error}`);
      }
    } catch (err) {
      errori++;
      dettagliErrori.push(`Riga ${i + 2}: ${err.message || "errore sconosciuto"}`);
    }
    onProgress?.(i + 1, mappedRows.length);
  }

  if (targetKey !== "vendite") {
    await insertRow("import_batches", {
      tabella_target: target.table,
      filename,
      righe_totali: mappedRows.length,
      righe_ok: ok,
      righe_errore: errori,
      dettagli_errori: dettagliErrori.length ? dettagliErrori : null,
    });
  } else {
    await updateRow("import_batches", importBatchId, {
      righe_ok: ok,
      righe_errore: errori,
      dettagli_errori: dettagliErrori.length ? dettagliErrori : null,
    });
  }

  await loadAll();
  notifyDataChanged();

  return { ok, errori, totale: mappedRows.length, dettagliErrori, dettagliWarning };
}
