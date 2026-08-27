import { escapeHtml } from "./format.js";

// Grafici SVG fatti a mano, zero dipendenze esterne. Usano le variabili CSS
// del tema cosi' seguono automaticamente la palette.

export function barChartVertical({ labels, series, width = 600, height = 220 }) {
  if (!labels.length) return `<div class="empty-state">Nessun dato da mostrare.</div>`;

  const padding = { top: 10, right: 10, bottom: 26, left: 10 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const groupW = chartW / labels.length;
  const barGap = 4;
  const barW = Math.max(3, (groupW - barGap * (series.length + 1)) / series.length);
  const max = Math.max(1, ...series.flatMap(s => s.values.map(v => Math.abs(v || 0))));

  let bars = "";
  labels.forEach((label, i) => {
    const groupX = padding.left + i * groupW;
    series.forEach((s, si) => {
      const value = Math.abs(s.values[i] || 0);
      const barH = (value / max) * chartH;
      const x = groupX + barGap + si * (barW + barGap);
      const y = padding.top + (chartH - barH);
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, barH).toFixed(1)}" fill="${s.color}" rx="2"/>`;
    });
    bars += `<text x="${(groupX + groupW / 2).toFixed(1)}" y="${height - 8}" font-size="10" fill="var(--text-muted)" text-anchor="middle">${escapeHtml(label)}</text>`;
  });

  const legend = series.length > 1 ? series.map(s =>
    `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:14px">
      <span style="width:10px;height:10px;border-radius:2px;background:${s.color};display:inline-block"></span>${escapeHtml(s.label)}
    </span>`
  ).join("") : "";

  return `<div>
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMidYMid meet">${bars}</svg>
    ${legend ? `<div style="display:flex;flex-wrap:wrap;font-size:0.7rem;color:var(--text-muted);margin-top:6px">${legend}</div>` : ""}
  </div>`;
}

// Barre orizzontali: ideale per confronti tra gruppi (es. copertura %).
export function barChartHorizontal({ items, width = 600, max: maxOverride, unit = "" }) {
  if (!items.length) return `<div class="empty-state">Nessun dato da mostrare.</div>`;

  const rowH = 26;
  const gap = 8;
  const labelW = 150;
  const height = items.length * (rowH + gap);
  const chartW = width - labelW - 60;
  const max = maxOverride || Math.max(1, ...items.map(it => it.value || 0));

  let rows = "";
  items.forEach((it, i) => {
    const y = i * (rowH + gap);
    const barW = Math.max(0, (Math.min(it.value, max) / max) * chartW);
    rows += `
      <text x="${labelW - 8}" y="${(y + rowH / 2 + 4).toFixed(1)}" font-size="11" fill="var(--text-main)" text-anchor="end">${escapeHtml(it.label)}</text>
      <rect x="${labelW}" y="${y}" width="${chartW}" height="${rowH}" fill="var(--bg-card)" rx="5"/>
      <rect x="${labelW}" y="${y}" width="${barW.toFixed(1)}" height="${rowH}" fill="${it.color || "var(--accent-blue)"}" rx="5"/>
      <text x="${(labelW + chartW + 8).toFixed(1)}" y="${(y + rowH / 2 + 4).toFixed(1)}" font-size="11" fill="var(--text-muted)">${it.value != null ? it.value.toFixed ? it.value.toFixed(1) : it.value : ""}${unit}</text>`;
  });

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMidYMid meet">${rows}</svg>`;
}

export function lineChart({ points, width = 600, height = 180, color = "var(--accent-blue)", fill = "var(--accent-green-soft)" }) {
  if (!points || points.length === 0) return `<div class="empty-state">Nessun dato storico ancora.</div>`;

  const padding = { top: 16, right: 10, bottom: 20, left: 10 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxY = Math.max(1, ...points.map(p => p.y));

  if (points.length === 1) {
    const cx = padding.left + chartW / 2;
    const cy = padding.top + chartH - (points[0].y / maxY) * chartH;
    return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMidYMid meet">
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="${color}"/>
      <text x="${cx.toFixed(1)}" y="${(cy - 10).toFixed(1)}" font-size="10" fill="var(--text-muted)" text-anchor="middle">${escapeHtml(points[0].label || "")}</text>
    </svg>`;
  }

  const stepX = chartW / (points.length - 1);
  const coords = points.map((p, i) => [padding.left + i * stepX, padding.top + chartH - (p.y / maxY) * chartH]);

  const linePath = coords.map((c, i) => (i === 0 ? "M" : "L") + c[0].toFixed(1) + "," + c[1].toFixed(1)).join(" ");
  const areaPath = `${linePath} L${(padding.left + chartW).toFixed(1)},${(padding.top + chartH).toFixed(1)} L${padding.left.toFixed(1)},${(padding.top + chartH).toFixed(1)} Z`;

  const labels = points.map((p, i) =>
    `<text x="${coords[i][0].toFixed(1)}" y="${height - 4}" font-size="9" fill="var(--text-muted)" text-anchor="middle">${escapeHtml(p.label || "")}</text>`
  ).join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMidYMid meet">
    <path d="${areaPath}" fill="${fill}" stroke="none"/>
    <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2"/>
    ${labels}
  </svg>`;
}

// Anello/gauge per una singola percentuale (es. copertura complessiva).
export function donut({ percent, size = 120, color = "var(--accent-blue)", label = "" }) {
  const r = size / 2 - 10;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent || 0));
  const dash = (clamped / 100) * circumference;

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--bg-card)" stroke-width="10"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="10"
      stroke-dasharray="${dash.toFixed(1)} ${circumference.toFixed(1)}" stroke-linecap="round"
      transform="rotate(-90 ${c} ${c})"/>
    <text x="${c}" y="${c - 2}" font-size="20" font-weight="700" fill="var(--text-main)" text-anchor="middle">${clamped.toFixed(0)}%</text>
    ${label ? `<text x="${c}" y="${c + 16}" font-size="9" fill="var(--text-muted)" text-anchor="middle">${escapeHtml(label)}</text>` : ""}
  </svg>`;
}
