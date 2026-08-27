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

export async function listRows(table, { orderBy, ascending = true } = {}) {
  let query = supabase.from(table).select("*");
  if (orderBy) query = query.order(orderBy, { ascending });
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
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
