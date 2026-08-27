import { supabase } from "../supabase.js";

export async function getCurrentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

async function logAudit(action, table, recordId, details) {
  try {
    const userId = await getCurrentUserId();
    await supabase.from("audit_log").insert({
      user_id: userId,
      action,
      table_name: table,
      record_id: recordId != null ? String(recordId) : null,
      details: details ?? null,
    });
  } catch {
    // l'audit log non deve mai bloccare l'operazione principale
  }
}

const PAGE_SIZE = 1000;

// Supabase/PostgREST limita ogni richiesta a 1000 righe di default: senza
// paginare, una tabella che cresce oltre quel numero (es. vendite importate)
// viene troncata in silenzio. "id" come ordinamento secondario garantisce un
// ordine stabile tra una pagina e l'altra.
export async function listRows(table, { orderBy, ascending = true } = {}) {
  const rows = [];
  let from = 0;
  while (true) {
    let query = supabase.from(table).select("*").range(from, from + PAGE_SIZE - 1);
    if (orderBy) query = query.order(orderBy, { ascending });
    query = query.order("id", { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

export async function insertRow(table, payload) {
  const { data, error } = await supabase.from(table).insert(payload).select().single();
  if (error) throw error;
  await logAudit("insert", table, data?.id, payload);
  return data;
}

export async function insertRows(table, payloads) {
  if (!payloads.length) return [];
  const { data, error } = await supabase.from(table).insert(payloads).select();
  if (error) throw error;
  await logAudit("insert_bulk", table, null, { count: payloads.length });
  return data;
}

export async function updateRow(table, id, payload) {
  const { data, error } = await supabase.from(table).update(payload).eq("id", id).select().single();
  if (error) throw error;
  await logAudit("update", table, id, payload);
  return data;
}

export async function deleteRow(table, id) {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw error;
  await logAudit("delete", table, id, null);
}
