import { openModal, closeModal } from "./modal.js";

// Sostituisce window.confirm(): in alcuni browser "embedded"/automatizzati i
// dialog nativi (confirm/alert) vengono auto-dismissi senza mai comparire, e
// il bottone "Elimina" sembra non fare nulla. Questo e' un modale vero,
// coerente con lo stile dell'app e affidabile ovunque.

let resolveCurrent = null;

export function confirmDialog(message, { title = "Conferma" } = {}) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-message").textContent = message;
  openModal("confirmModal");
  return new Promise(resolve => {
    resolveCurrent = resolve;
  });
}

function settle(value) {
  closeModal("confirmModal");
  const resolve = resolveCurrent;
  resolveCurrent = null;
  resolve?.(value);
}

export function initConfirm() {
  document.getElementById("confirm-ok").addEventListener("click", () => settle(true));
  document.getElementById("confirm-cancel").addEventListener("click", () => settle(false));
  document.getElementById("confirmModal").addEventListener("click", event => {
    if (event.target.id === "confirmModal") settle(false);
  });
}
