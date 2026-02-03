import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { isoNow } from "./utils.js";

export function ensureSupabaseLoaded() {
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("Supabase no está cargado. Verificá el orden de scripts (CDN antes que administrador.js)");
    alert("Error: Supabase no está cargado. Revisá el orden de scripts.");
    throw new Error("Supabase no está cargado");
  }
}

export function createSupabaseClient() {
  ensureSupabaseLoaded();
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export async function getSessionOrNull(sb) {
  const { data: { session }, error } = await sb.auth.getSession();
  if (error || !session?.access_token) return null;
  return session;
}

// PATCH id=1; si no existe, intentamos INSERT id=1
export async function patchOrInsertStore({ table, payload, session }) {
  const urlPatch = `${SUPABASE_URL}/rest/v1/${table}?id=eq.1`;
  const body = JSON.stringify({ payload, updated_at: isoNow() });

  const doPatch = async () => fetch(urlPatch, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation",
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + session.access_token,
    },
    body,
  });

  let resp = await doPatch();

  if (!resp.ok) {
    const txt = await resp.text();
    const maybeMissingRow =
      resp.status === 404 ||
      resp.status === 406 ||
      /0 rows/i.test(txt) ||
      /not found/i.test(txt);

    if (maybeMissingRow) {
      const urlInsert = `${SUPABASE_URL}/rest/v1/${table}`;
      resp = await fetch(urlInsert, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Prefer: "return=representation",
          apikey: SUPABASE_ANON_KEY,
          Authorization: "Bearer " + session.access_token,
        },
        body: JSON.stringify([{ id: 1, payload, updated_at: isoNow() }]),
      });
    } else {
      return { ok: false, status: resp.status, text: txt };
    }
  }

  if (!resp.ok) {
    const txt2 = await resp.text();
    return { ok: false, status: resp.status, text: txt2 };
  }

  let data = null;
  try { data = await resp.json(); } catch { }
  return { ok: true, data };
}
