// Esporta dati tabellari come CSV scaricabile. Delimitatore ";" perché in
// locale italiano Excel usa la virgola come separatore decimale e
// interpreterebbe male un CSV separato da virgole.
export function downloadCsv(filename, headers, rows) {
  const escapeCell = value => {
    const s = value == null ? "" : String(value);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers, ...rows].map(row => row.map(escapeCell).join(";"));
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
