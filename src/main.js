import "./styles.css";
import { initAuth, signOut } from "./lib/auth.js";
import { wireModals } from "./lib/modal.js";
import { loadAll } from "./lib/store.js";
import { refreshKpis } from "./lib/kpis.js";
import { toastError } from "./lib/ui.js";
import { onDataChanged } from "./lib/bus.js";
import { initPdvShared } from "./lib/pdv-shared.js";
import { initConfirm } from "./lib/confirm.js";

import { render as renderDashboard } from "./tabs/dashboard.js";
import { render as renderGruppi, initGruppi } from "./tabs/gruppi.js";
import { render as renderPuntiVendita, initPuntiVendita } from "./tabs/punti-vendita.js";
import { render as renderAgenti, initAgenti } from "./tabs/agenti.js";
import { render as renderAssortimenti, initAssortimenti } from "./tabs/assortimenti.js";
import { render as renderStatistiche } from "./tabs/statistiche.js";
import { render as renderImport } from "./tabs/import.js";

let initialized = false;

const PAGE_TITLES = {
  dashboard: "Dashboard esecutiva",
  gruppi: "Gruppi GDO",
  "punti-vendita": "Punti vendita",
  agenti: "Agenti",
  assortimenti: "Assortimenti",
  statistiche: "Statistiche venduto",
  import: "Import dati",
};

function renderAll() {
  renderDashboard();
  renderGruppi();
  renderPuntiVendita();
  renderAgenti();
  renderAssortimenti();
  renderStatistiche();
  renderImport();
  refreshKpis();
}

export function switchToView(view) {
  document.querySelectorAll(".view-section").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-btn[data-view]").forEach(el => el.classList.remove("active"));
  document.getElementById("view-" + view)?.classList.add("active");
  document.querySelector(`.nav-btn[data-view="${view}"]`)?.classList.add("active");
  document.getElementById("page-title").textContent = PAGE_TITLES[view] || "";
}

function wireNav() {
  document.querySelectorAll(".nav-btn[data-view]").forEach(btn => {
    btn.addEventListener("click", () => switchToView(btn.dataset.view));
  });
}

function wireLogout() {
  document.getElementById("logout-btn").addEventListener("click", () => signOut());
}

async function bootstrap(user) {
  document.getElementById("header-user").textContent = user.email || "";
  try {
    await loadAll();
  } catch (err) {
    toastError(err);
    return;
  }

  if (!initialized) {
    initGruppi();
    initPuntiVendita();
    initAgenti();
    initAssortimenti();
    initPdvShared();
    initConfirm();
    wireModals();
    wireNav();
    wireLogout();
    onDataChanged(renderAll);
    initialized = true;
  }

  renderAll();
}

initAuth({ onSignedIn: bootstrap });
