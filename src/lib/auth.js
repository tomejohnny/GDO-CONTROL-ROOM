import { supabase } from "../supabase.js";

export function initAuth({ onSignedIn, onSignedOut }) {
  const overlay = document.getElementById("login-overlay");
  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error");
  const emailInput = document.getElementById("login-email");
  const passwordInput = document.getElementById("login-password");

  function showLogin() {
    overlay.classList.remove("hidden");
    document.getElementById("app-shell").classList.remove("visible");
  }

  function hideLogin() {
    overlay.classList.add("hidden");
    document.getElementById("app-shell").classList.add("visible");
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    errorEl.textContent = "";
    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    const { error } = await supabase.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value,
    });
    submitBtn.disabled = false;
    if (error) {
      errorEl.textContent = "Accesso non riuscito. Controlla email e password.";
      return;
    }
    passwordInput.value = "";
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      hideLogin();
      onSignedIn(session.user);
    } else {
      showLogin();
      onSignedOut?.();
    }
  });

  supabase.auth.getSession().then(({ data }) => {
    if (data?.session?.user) {
      hideLogin();
      onSignedIn(data.session.user);
    } else {
      showLogin();
    }
  });
}

export async function signOut() {
  await supabase.auth.signOut();
}
