// funciones/js/guardiaSync.js
(function () {
  const SUPABASE_URL = "https://ugeydxozfewzhldjbkat.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_ZeLC2rOxhhUXlQdvJ28JkA_qf802-pX";

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  async function fetchGuardia() {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/guardia_store?select=id,activo,inicio_ts,fin_ts,payload,updated_at&id=eq.1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Accept: "application/json" } }
    );
    if (!r.ok) throw new Error("Error leyendo guardia_store: " + r.status);
    const j = await r.json();
    return j?.[0] || null;
  }

  async function patchGuardia({ sessionAccessToken, activo, inicio_ts, fin_ts, payload }) {
    const body = {
      activo: !!activo,
      inicio_ts: inicio_ts ?? null,
      fin_ts: fin_ts ?? null,
      payload: payload ?? [],
      updated_at: new Date().toISOString(),
    };

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/guardia_store?id=eq.1`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Prefer: "return=representation",
          apikey: SUPABASE_ANON_KEY,
          Authorization: "Bearer " + sessionAccessToken,
        },
        body: JSON.stringify(body),
      }
    );
    const txt = await r.text();
    if (!r.ok) throw new Error("Error PATCH guardia_store " + r.status + " :: " + txt);
    return txt;
  }

  window.GuardiaSync = { norm, fetchGuardia, patchGuardia };
})();
