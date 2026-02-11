// administrador/js/libroMemorandum.js
// Tabla: public.libro_memorandum_store (id int PK, payload jsonb, updated_at timestamptz)
// Guarda un único JSON (id=1).
//
// Objetivo:
// - Cuando entrás a la solapa "Libro memorándum", importar AUTOMÁTICAMENTE (solo nuevos) los logs de Guardia
//   (Ingreso / Retiro / Presente / Franco / Constancia) y agregarlos como asientos.
// - No tocar nada de Guardia: solo lee guardia_estado.id=1.
// - Importa SOLO si hay logs nuevos (dedupe por key estable).
//
// Nota: no depende de modificar tabs.js ni administrador.js. Se engancha a los clicks de .tab-btn[data-tab="libro"].

import { invLabelFromValue } from "./inventario.js";

const TABLE = "libro_memorandum_store";
const ROW_ID = 1;

const GUARDIA_TABLE = "guardia_estado";
const GUARDIA_ROW_ID = 1;

export function initLibroMemorandum({ sb }) {
  // ===== DOM getters =====
  const elCausa = () => document.getElementById("memoCausa");
  const elHora = () => document.getElementById("memoHora");
  const elNovedad = () => document.getElementById("memoNovedad");
  const tbody = () => document.getElementById("memoTbody");
  const elPreview = () => document.getElementById("libroJsonPreview");
  const btnAgregar = () => document.getElementById("btnLibroAgregar");
  const btnLimpiar = () => document.getElementById("btnLibroLimpiar");

  // payload persistido:
  // {
  //   entries: [{id, ts, user, causa, hora, novedad, meta?}],
  //   imported: { guardia_log_ids: string[] }
  // }
  let state = { entries: [], imported: { guardia_log_ids: [] } };
  let _loadedOnce = false;
  let _importInFlight = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function hhmmArNow() {
    try {
      const s = new Intl.DateTimeFormat("es-AR", {
        timeZone: "America/Argentina/Cordoba",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date());
      return String(s).trim();
    } catch {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    }
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function getUserEmail() {
    try {
      const { data } = await sb.auth.getUser();
      return data?.user?.email || null;
    } catch {
      return null;
    }
  }

  function ensureStateShape() {
    if (!state || typeof state !== "object") state = {};
    if (!Array.isArray(state.entries)) state.entries = [];
    if (!state.imported || typeof state.imported !== "object") state.imported = {};
    if (!Array.isArray(state.imported.guardia_log_ids)) state.imported.guardia_log_ids = [];
  }

  function setPreview() {
    const pre = elPreview();
    if (pre) pre.textContent = JSON.stringify(state || {}, null, 2);
  }

  function render() {
    ensureStateShape();
    setPreview();

    const tb = tbody();
    if (!tb) return;

    const entries = Array.isArray(state?.entries) ? state.entries : [];
    if (!entries.length) {
      tb.innerHTML = `<tr><td colspan="3" class="muted">Sin asientos todavía.</td></tr>`;
      return;
    }

    // últimos primero
    const rows = [...entries].reverse();

    tb.innerHTML = "";
    rows.forEach((e) => {
      const tr = document.createElement("tr");
      const causa = escapeHtml(e?.causa || "");
      const hora = escapeHtml(e?.hora || "");
      const novedad = escapeHtml(e?.novedad || "");

      tr.innerHTML = `
        <td>${causa}</td>
        <td>${hora}</td>
        <td>
          <div style="white-space:pre-wrap;">${novedad}</div>
          ${e?.user ? `<div class="muted" style="margin-top:6px;font-size:12px;">${escapeHtml(e.user)}</div>` : ""}
        </td>
      `;
      tb.appendChild(tr);
    });
  }

  async function loadFromServer() {
    const { data, error } = await sb.from(TABLE).select("payload").eq("id", ROW_ID).limit(1);
    if (error) {
      console.warn("[LIBRO] load error:", error);
      state = { entries: [], imported: { guardia_log_ids: [] } };
      ensureStateShape();
      return;
    }
    const payload = data?.[0]?.payload;
    state = payload && typeof payload === "object" ? payload : { entries: [], imported: { guardia_log_ids: [] } };
    ensureStateShape();
  }

  async function saveToServer() {
    ensureStateShape();
    const row = { id: ROW_ID, payload: state, updated_at: nowIso() };
    const { error } = await sb.from(TABLE).upsert(row, { onConflict: "id" });

    if (error) {
      console.error("[LIBRO] save error:", error);
      alert("Error guardando Libro Memorándum. Mirá Console (F12).");
      return false;
    }
    return true;
  }

  function bloquearHora() {
    const h = elHora();
    if (!h) return;

    h.readOnly = true;
    h.setAttribute("readonly", "");
    h.setAttribute("inputmode", "none");

    const hardBlock = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      return false;
    };

    h.addEventListener("keydown", hardBlock);
    h.addEventListener("paste", hardBlock);
    h.addEventListener("cut", hardBlock);
    h.addEventListener("drop", hardBlock);

    if (!String(h.value || "").trim()) h.value = hhmmArNow();
  }

  function limpiarForm({ keepHora = true } = {}) {
    if (elCausa()) elCausa().value = "";
    if (elNovedad()) elNovedad().value = "";
    if (elHora()) elHora().value = keepHora ? hhmmArNow() : "";
  }

  // ===== Import Guardia logs =====

  function safeArr(x) {
    return Array.isArray(x) ? x : [];
  }

  function normAction(a) {
    return String(a || "").trim().toLowerCase();
  }

  function isImportableAction(a) {
    const x = normAction(a);
    return x === "ingreso" || x === "retiro" || x === "presente" || x === "franco" || x === "constancia";
  }

  function fmtMovil(m) {
    const id = m?.movil_id || "";
    const label = invLabelFromValue("movil", id) || id;

    const flags = [];
    if (m?.libro) flags.push("Libro");
    if (m?.tvf) flags.push("TVF");

    const flagsTxt = flags.length ? ` (${flags.join(", ")})` : "";
    const obs = String(m?.obs || "").trim();
    const obsTxt = obs ? ` · Obs: ${obs}` : "";

    return `${label}${flagsTxt}${obsTxt}`.trim();
  }

  function fmtPersonal(ids) {
    const list = safeArr(ids).map((id) => invLabelFromValue("personal", id)).filter(Boolean);
    return list.length ? list.join(", ") : "-";
  }

  function fmtElementos(ids) {
    const list = safeArr(ids).map((id) => invLabelFromValue("elemento", id)).filter(Boolean);
    return list.length ? list.join(", ") : "-";
  }

  function fmtMoviles(movs) {
    const list = safeArr(movs).map(fmtMovil).filter(Boolean);
    return list.length ? list.join(" | ") : "-";
  }

  function fmtCartuchosQty(qtyMap) {
    if (!qtyMap || typeof qtyMap !== "object") return "";
    const pairs = Object.entries(qtyMap)
      .map(([k, v]) => {
        const n = Math.max(0, parseInt(v, 10) || 0);
        if (n <= 0) return null;
        // keys esperadas: at_12_70 / pg_12_70
        const label = String(k).toLowerCase().includes("at") ? "AT 12/70" : String(k).toLowerCase().includes("pg") ? "PG 12/70" : k;
        return `${label}: ${n}`;
      })
      .filter(Boolean);
    return pairs.length ? pairs.join(" | ") : "";
  }

  function buildNovedadFromLog(log) {
    const accion = String(log?.accion || "").trim().toUpperCase();
    const p = String(log?.patrulla || "").trim(); // "P1"/"P2" (ya viene así en guardia)
    const snap = log?.snapshot || {};

    const lugar = String(snap?.lugar || "").trim() || "-";
    const obs = String(snap?.obs || "").trim();
    const obsTxt = obs ? ` · Obs: ${obs}` : "";

    const personal = fmtPersonal(snap?.personal_ids);
    const moviles = fmtMoviles(snap?.moviles);
    const elementos = fmtElementos(snap?.elementos_ids);

    const cartQty = fmtCartuchosQty(snap?.cartuchos_qty_map);
    const cartTxt = cartQty ? `\nCartuchos: ${cartQty}` : "";

    return `${accion}${p ? " " + p : ""} · Lugar: ${lugar}${obsTxt}\nPersonal: ${personal}\nMóviles: ${moviles}\nElementos: ${elementos}${cartTxt}`;
  }

  async function loadGuardiaPayload() {
    const { data, error } = await sb.from(GUARDIA_TABLE).select("payload").eq("id", GUARDIA_ROW_ID).limit(1);
    if (error) throw error;
    const payload = data?.[0]?.payload;
    return payload && typeof payload === "object" ? payload : null;
  }

  async function importLogsFromGuardiaIfNeeded() {
    // mutex simple para evitar doble import por clicks rápidos / re-renders
    if (_importInFlight) return _importInFlight;

    _importInFlight = (async () => {
      try {
        ensureStateShape();

        // IMPORTA contra el estado más nuevo guardado
        const guardia = await loadGuardiaPayload();
        const logs = safeArr(guardia?.log);

        console.log("[LIBRO] Guardia logs:", logs.length);

        if (!logs.length) return false;

        const imported = new Set(state.imported.guardia_log_ids.map(String));
        const nuevos = [];

        logs.forEach((l) => {
          if (!isImportableAction(l?.accion)) return;

          // key estable: ts si existe (de guardia), sino fallback
          const key = String(l?.ts || `${l?.hora || ""}|${l?.patrulla || ""}|${l?.accion || ""}|${l?.resumen || ""}`).trim();
          if (!key) return;
          if (imported.has(key)) return;

          const hora = String(l?.hora || "").trim() || hhmmArNow();
          const causa = `${String(l?.accion || "").trim()}${l?.patrulla ? " " + String(l.patrulla).trim() : ""}`.trim();
          const novedad = buildNovedadFromLog(l);

          nuevos.push({ key, hora, causa, novedad });
        });

        if (!nuevos.length) return false;

        const user = await getUserEmail();
        const entriesNow = safeArr(state.entries);

        const toAppend = nuevos.map((x) => ({
          id: `g_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          ts: nowIso(),
          user,
          causa: x.causa,
          hora: x.hora,
          novedad: x.novedad,
          meta: { source: "guardia", guardia_key: x.key },
        }));

        state.entries = [...entriesNow, ...toAppend];
        state.imported.guardia_log_ids = [...state.imported.guardia_log_ids, ...nuevos.map((x) => x.key)];

        render();
        await saveToServer();
        return true;
      } catch (e) {
        console.warn("[LIBRO] importLogsFromGuardiaIfNeeded error:", e);
        return false;
      } finally {
        _importInFlight = null;
      }
    })();

    return _importInFlight;
  }

  async function ensureLoadedOnce() {
    if (_loadedOnce) return;
    await loadFromServer();
    _loadedOnce = true;
  }

  async function onTabLibroActivated() {
    try {
      await ensureLoadedOnce();
      bloquearHora();

      // Importa SOLO si hay novedades
      const changed = await importLogsFromGuardiaIfNeeded();
      if (changed) console.log("[LIBRO] Import OK (había nuevos logs).");
      render();
    } catch (e) {
      console.warn("[LIBRO] onTabLibroActivated error:", e);
    }
  }

  // ===== Acciones manuales del libro =====

  async function onAgregar() {
    const horaNow = hhmmArNow();
    if (elHora()) elHora().value = horaNow;

    const causa = (elCausa()?.value || "").trim();
    const novedad = (elNovedad()?.value || "").trim();

    if (!causa) return alert("Seleccioná una causa.");
    if (!novedad) return alert("Escribí la novedad / referencia.");

    await ensureLoadedOnce();

    const user = await getUserEmail();
    const entry = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      ts: nowIso(),
      user,
      causa,
      hora: horaNow,
      novedad,
    };

    ensureStateShape();
    state.entries = [...state.entries, entry];

    render();
    await saveToServer();
    limpiarForm({ keepHora: true });
  }

  function onLimpiar() {
    limpiarForm({ keepHora: true });
  }

  function bindTabHook() {
    // Nos enganchamos a los botones de tab del layout existente.
    document.querySelectorAll('.tab-btn[data-tab="libro"]').forEach((b) => {
      b.addEventListener("click", () => {
        // Espera un tick para que tabs.js marque el panel como activo.
        setTimeout(() => onTabLibroActivated(), 0);
      });
    });

    // fallback: si por alguna razón tabs.js no emite click (ej. activación programática),
    // al enfocar algún elemento del tab intentamos importar una vez.
    const panel = document.getElementById("tab-libro");
    if (panel) {
      panel.addEventListener("focusin", () => {
        // si el panel está visible/activo, importamos
        const active = panel.classList.contains("is-active") || panel.style.display !== "none";
        if (active) onTabLibroActivated();
      });
    }
  }

  return {
    bind() {
      const a = btnAgregar();
      const l = btnLimpiar();
      if (a) a.addEventListener("click", onAgregar);
      if (l) l.addEventListener("click", onLimpiar);

      bloquearHora();
      bindTabHook();
    },

    async init() {
      // Carga inicial del libro (sin importar aún)
      await ensureLoadedOnce();
      bloquearHora();
      render();
    },

    // por si querés llamarlo desde afuera (opcional)
    async importNow() {
      await onTabLibroActivated();
    },
  };
}
