// administrador/js/libroMemorandum.js
// Tabla: public.libro_memorandum_store (id int PK, payload jsonb, updated_at timestamptz)
// Guarda un único JSON (id=1).
//
// ✅ Cambios:
// 1) Hora visible pero NO editable: se setea sola con la hora del sistema cuando apretás "Agregar".
// 2) Importación automática desde Guardia al abrir la solapa "Libro memorándum":
//    - Lee guardia_estado.id=1 (payload.log)
//    - Importa TODAS las acciones (Ingreso/Retiro/Presente/Franco/Constancia/Novedad)
//    - Deduplica por key estable
//    - Si un móvil tiene tildes Libro/TVF, se reflejan en el texto del asiento.

import { invLabelFromValue } from "./inventario.js";

const TABLE = "libro_memorandum_store";
const ROW_ID = 1;

const GUARDIA_TABLE = "guardia_estado";
const GUARDIA_ROW_ID = 1;

export function initLibroMemorandum({ sb } = {}) {
  // ===== DOM getters (no rompen si el tab no existe) =====
  const elCausa = () => document.getElementById("memoCausa");
  const elHora = () => document.getElementById("memoHora");
  const elNovedad = () => document.getElementById("memoNovedad");

  const tbody = () => document.getElementById("memoTbody");
  const elPreview = () => document.getElementById("libroJsonPreview");

  const btnAgregar = () => document.getElementById("btnLibroAgregar");
  const btnLimpiar = () => document.getElementById("btnLibroLimpiar");

  // Botón pestaña "Libro memorándum" (gatillo de import)
  const btnTabLibro = () => document.querySelector('.tab-btn[data-tab="libro"]');
  const panelLibro = () => document.getElementById("tab-libro");

  // payload persistido:
  // {
  //   entries: [{id, ts, user, causa, hora, novedad, meta?}],
  //   imported: { guardia_log_keys: [] }
  // }
  let state = { entries: [], imported: { guardia_log_keys: [] } };
  let isLoaded = false;

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
    if (!Array.isArray(state.imported.guardia_log_keys)) state.imported.guardia_log_keys = [];
  }

  function setPreview() {
    const pre = elPreview();
    if (pre) pre.textContent = JSON.stringify(state || {}, null, 2);
  }

  function render() {
    setPreview();

    const tb = tbody();
    if (!tb) return;

    const entries = Array.isArray(state?.entries) ? state.entries : [];

    if (!entries.length) {
      tb.innerHTML = `<tr><td colspan="4" class="muted">Sin asientos todavía.</td></tr>`;
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
      const id = escapeHtml(e?.id || "");

      tr.innerHTML = `
        <td>${causa}</td>
        <td>${hora}</td>
        <td>
          <div style="white-space:pre-wrap;">${novedad}</div>
          ${e?.user ? `<div class="muted" style="margin-top:6px;font-size:12px;">${escapeHtml(e.user)}</div>` : ""}
        </td>
        <td><button type="button" class="btn-danger" data-del="${id}">Borrar</button></td>
      `;
      tb.appendChild(tr);
    });

    tb.querySelectorAll("button[data-del]").forEach((b) => {
      b.addEventListener("click", async () => {
        const targetId = b.getAttribute("data-del");
        if (!targetId) return;

        if (!confirm("¿Eliminar este asiento del libro?")) return;

        const entriesNow = Array.isArray(state?.entries) ? state.entries : [];
        state = { ...state, entries: entriesNow.filter((x) => String(x.id) !== String(targetId)) };

        render();
        await saveToServer();
      });
    });
  }

  async function loadFromServer() {
    if (!sb) throw new Error("Libro Memorándum: falta sb (Supabase client).");

    const { data, error } = await sb.from(TABLE).select("payload").eq("id", ROW_ID).limit(1);

    if (error) {
      console.warn("[LIBRO] load error:", error);
      state = { entries: [], imported: { guardia_log_keys: [] } };
      ensureStateShape();
      isLoaded = true;
      return;
    }

    const payload = data?.[0]?.payload;
    state = payload && typeof payload === "object" ? payload : { entries: [], imported: { guardia_log_keys: [] } };
    ensureStateShape();
    isLoaded = true;
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

  // ===== IMPORT LOGS DESDE GUARDIA =====

  function safeArr(x) {
    return Array.isArray(x) ? x : [];
  }

  function guardiaLogKey(l) {
    const ts = String(l?.ts || "").trim();
    if (ts) return ts;
    const hora = String(l?.hora || "").trim();
    const patrulla = String(l?.patrulla || "").trim();
    const accion = String(l?.accion || "").trim();
    const resumen = String(l?.resumen || "").trim();
    return `${hora}|${patrulla}|${accion}|${resumen}`.trim();
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

  function fmtList(tipo, ids) {
    const list = safeArr(ids).map((id) => invLabelFromValue(tipo, id)).filter(Boolean);
    return list.length ? list.join(", ") : "-";
  }

  function fmtMoviles(movs) {
    const list = safeArr(movs).map(fmtMovil).filter(Boolean);
    return list.length ? list.join(" | ") : "-";
  }

  function fmtCartuchosQty(map) {
    if (!map || typeof map !== "object") return "";
    const pairs = Object.entries(map)
      .map(([k, v]) => [String(k), Math.max(0, parseInt(v, 10) || 0)])
      .filter(([, n]) => n > 0);

    if (!pairs.length) return "";

    const label = (k) => {
      if (k === "at_12_70") return "AT 12/70";
      if (k === "pg_12_70") return "PG 12/70";
      return k;
    };

    return pairs.map(([k, n]) => `${label(k)}: ${n}`).join(" · ");
  }

  function buildNovedadFromLog(log) {
    const accion = String(log?.accion || "").trim() || "Novedad";
    const p = String(log?.patrulla || "").trim();
    const snap = log?.snapshot || {};

    const lugar = String(snap?.lugar || "").trim() || "-";
    const obs = String(snap?.obs || "").trim();

    const personal = fmtList("personal", snap?.personal_ids);
    const moviles = fmtMoviles(snap?.moviles);
    const elementos = fmtList("elemento", snap?.elementos_ids);

    const cartTxt = fmtCartuchosQty(snap?.cartuchos_qty_map);
    const cartLine = cartTxt ? `
Cartuchos: ${cartTxt}` : "";

    const obsTxt = obs ? ` · Obs: ${obs}` : "";

    return `${accion}${p ? " " + p : ""} · Lugar: ${lugar}${obsTxt}
Personal: ${personal}
Móviles: ${moviles}
Elementos: ${elementos}${cartLine}`;
  }

  async function loadGuardiaPayload() {
    const { data, error } = await sb.from(GUARDIA_TABLE).select("payload").eq("id", GUARDIA_ROW_ID).limit(1);
    if (error) throw error;
    const payload = data?.[0]?.payload;
    return payload && typeof payload === "object" ? payload : null;
  }

  async function importLogsFromGuardiaIfNeeded() {
    try {
      ensureStateShape();

      const guardia = await loadGuardiaPayload();
      const logs = safeArr(guardia?.log);

      console.log('[LIBRO] Guardia logs:', logs.length);
      console.log("[LIBRO] Guardia logs:", logs.length);
      if (!logs.length) return false;

      const imported = new Set(state.imported.guardia_log_keys.map(String));
      const nuevos = [];

      logs.forEach((l) => {
        const key = guardiaLogKey(l);
        if (!key) return;
        if (imported.has(key)) return;

        const hora = String(l?.hora || "").trim() || hhmmArNow();
        const accion = String(l?.accion || "").trim() || "Novedad";
        const causa = `${accion}${l?.patrulla ? " " + String(l.patrulla).trim() : ""}`.trim();
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
        meta: {
          source: "guardia",
          guardia_key: x.key,
        },
      }));

      state.entries = [...entriesNow, ...toAppend];
      state.imported.guardia_log_keys = [...state.imported.guardia_log_keys, ...nuevos.map((x) => x.key)];

      render();
      await saveToServer();
      return true;
    } catch (e) {
      console.warn("[LIBRO] importLogsFromGuardiaIfNeeded error:", e);
      return false;
    }
  }

  async function ensureLoaded() {
    if (!isLoaded) await loadFromServer();
    ensureStateShape();
  }

  async function onTabLibroActivated() {
    // Gatillo: cada vez que abrís la solapa Libro, intenta importar cambios.
    await ensureLoaded();
    bloquearHora();
    const changed = await importLogsFromGuardiaIfNeeded();
    if (!changed) render();
  }

  // ===== Acciones manuales del libro =====

  async function onAgregar() {
    const horaNow = hhmmArNow();
    if (elHora()) elHora().value = horaNow;

    const causa = (elCausa()?.value || "").trim();
    const novedad = (elNovedad()?.value || "").trim();

    if (!causa) return alert("Seleccioná una causa.");
    if (!novedad) return alert("Escribí la novedad / referencia.");

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

  return {
    bind() {
      const a = btnAgregar();
      const l = btnLimpiar();
      if (a) a.addEventListener("click", onAgregar);
      if (l) l.addEventListener("click", onLimpiar);

      // Hora visible pero bloqueada
      bloquearHora();

      // ✅ Importación automática al ENTRAR a la solapa "Libro memorándum"
      // Ultra-robusta: click directo + delegación + observer + fallback.
      const fire = () => {
        onTabLibroActivated().catch((e) => console.warn("[LIBRO] onTabLibroActivated error:", e));
      };

      // 1) Click directo (si el botón existe y no se recrea)
      const btn = btnTabLibro();
      if (btn && !btn.__libroBound) {
        btn.__libroBound = true;
        btn.addEventListener("click", fire);
      }

      // 2) Delegación (por si tabs.js recrea botones)
      if (!document.__libroDelegated) {
        document.__libroDelegated = true;
        document.addEventListener("click", (ev) => {
          const b = ev.target?.closest?.(".tab-btn[data-tab='libro']");
          if (b) fire();
        });
      }

      // 3) MutationObserver sobre el panel (cuando pasa a is-active)
      const panel = panelLibro();
      if (panel && !panel.__libroObserved) {
        panel.__libroObserved = true;
        const mo = new MutationObserver(() => {
          if (panel.classList.contains("is-active")) fire();
        });
        mo.observe(panel, { attributes: true, attributeFilter: ["class"] });
      }

      // 4) Si ya está activo al bind (recarga), importamos una vez
      setTimeout(() => {
        const p = panelLibro();
        if (p && p.classList.contains("is-active")) fire();
      }, 50);

      // 5) Fallback suave: chequea cada 2s solo para esta pantalla
      if (!window.__libroPoll) {
        window.__libroPoll = true;
        setInterval(() => {
          const p = panelLibro();
          if (p && p.classList.contains("is-active")) fire();
        }, 2000);
      }
    },
    async init() {
      await ensureLoaded();
      bloquearHora();
      render();
    },

    async importGuardiaNow() {
      await ensureLoaded();
      const changed = await importLogsFromGuardiaIfNeeded();
      render();
      return changed;
    },
  };
}
