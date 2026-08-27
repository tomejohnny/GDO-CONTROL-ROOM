let toastEl = null;
let toastTimer = null;

function getToastEl() {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    document.body.appendChild(toastEl);
  }
  return toastEl;
}

export function toast(message, type = "") {
  const el = getToastEl();
  el.textContent = message;
  el.className = "toast show" + (type ? " " + type : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

export function toastError(err) {
  console.error(err);
  toast(err?.message || "Errore imprevisto", "error");
}
