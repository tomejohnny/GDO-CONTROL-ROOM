import { supabase } from "../supabase.js";

let readOnly = true;

// Il ruolo vive in app_metadata (non modificabile dall'utente stesso, solo da
// un admin via SQL). Qui leggiamo solo per decidere cosa mostrare in UI — la
// vera barriera di sicurezza sono le policy RLS lato database.
export async function initPermissions() {
  const { data } = await supabase.auth.getUser();
  const role = data?.user?.app_metadata?.role;
  readOnly = role !== "admin";
  document.body.classList.toggle("readonly", readOnly);
}

export function isReadOnly() {
  return readOnly;
}
