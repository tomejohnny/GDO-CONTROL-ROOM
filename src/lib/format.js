export function money(value) {
  const n = Number(value || 0);
  return (n < 0 ? "- " : "") + "€ " + Math.abs(n).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function number(value) {
  return Number(value || 0).toLocaleString("it-IT");
}

export function percent(value, digits = 1) {
  return Number(value || 0).toLocaleString("it-IT", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + "%";
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("it-IT");
}

export function formatMonth(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("it-IT", { month: "short", year: "numeric" });
}

// --- Stati e badge -----------------------------------------------------

export const STATO_GRUPPO = {
  attivo: { label: "Attivo", color: "var(--accent-green)" },
  target: { label: "Target", color: "var(--accent-amber)" },
  sospeso: { label: "Sospeso", color: "var(--accent-red)" },
};

export const STATO_PDV = {
  servito: { label: "Servito", color: "var(--accent-green)" },
  non_servito: { label: "Non servito", color: "var(--accent-red)" },
  target: { label: "Target", color: "var(--accent-amber)" },
  sospeso: { label: "Sospeso", color: "var(--text-muted)" },
};

export const STATO_ASSORTIMENTO = {
  attivo: { label: "Attivo", color: "var(--accent-green)" },
  proposto: { label: "Proposto", color: "var(--accent-blue)" },
  in_trattativa: { label: "In trattativa", color: "var(--accent-amber)" },
  rifiutato: { label: "Rifiutato", color: "var(--accent-red)" },
  sospeso: { label: "Sospeso", color: "var(--text-muted)" },
};

export const CATEGORIE_ARTICOLO = {
  formaggi: "Formaggi",
  salumi: "Salumi",
  congelato: "Congelato",
  carne_pesce: "Carne e pesce",
  scaffale: "Prodotti da scaffale",
};

export function badge(label, color) {
  return `<span class="badge" style="background:${color}">${escapeHtml(label)}</span>`;
}

export function statoBadge(map, value) {
  const entry = map[value] || { label: value || "—", color: "var(--text-muted)" };
  return badge(entry.label, entry.color);
}
