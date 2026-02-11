// administrador/js/libroMemorandum.js
// Tabla: public.libro_memorandum_store (id int PK, payload jsonb, updated_at timestamptz)
// Guarda un único JSON (id=1).
//
// ✅ Cambios pedidos:
// 1) Hora visible pero NO editable: se setea sola con la hora del sistema cuando apretás "Agregar".
// 2) Importación automática de NOVEDADES desde Guardia, pero SOLO cuando abrís la solapa "Libro memorándum":
//    - Lee guardia_estado.id=1
//    - Toma logs (Ingreso/Retiro/Presente/Franco/Constancia/Novedad, etc.)
//    - Genera asientos en Libro Memorándum SOLO por novedades nuevas (dedupe por key estable)
//    - Si un móvil tiene tildes Libro/TVF, se reflejan en el texto.
// 3) Importa solo si hay cambios nuevos (dedupe por key estable).

import { invLabelFromValue } from "./inventario.js";

const TABLE = "libro_memorandum_store";
const ROW_ID = 1;

const GUARDIA_TABLE = "guardia_estado";
const GUARDIA_ROW_ID = 1;

export function initLibroMemorandum({ sb }) {
  // ===== DOM getters (no rompen si el tab no existe) =====
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
  //   imported: { guardia_log_keys: [] }
  // }
  // Compat: si existía imported.guardia_retiro_ids (versiones anteriores), se migra a guardia_log_keys.
  let state = { entries: [], imported: { guardia_log_keys: [] } };

  function nowIso() {
    return new Date().toISOString();
  }

  function hhmmArNow() {
    // Argentina / Córdoba (-03). Evita depender de utils.js.
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
    // ✅ Nuevo esquema: guardia_log_keys (dedupe de cualquier acción)
    if (!Array.isArray(state.imported.guardia_log_keys)) state.imported.guardia_log_keys = [];

    // ✅ Compat hacia atrás: si existía guardia_retiro_ids, lo migramos una sola vez
    if (Array.isArray(state.imported.guardia_retiro_ids) && state.imported.guardia_retiro_ids.length) {
      const merged = new Set([
        ...state.imported.guardia_log_keys.map(String),
        ...state.imported.guardia_retiro_ids.map(String),
      ]);
      state.imported.guardia_log_keys = Array.from(merged);
      delete state.imported.guardia_retiro_ids;
    }
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
          <div>${novedad}</div>
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
    const { data, error } = await sb.from(TABLE).select("payload").eq("id", ROW_ID).limit(1);

    if (error) {
      console.warn("[LIBRO] load error:", error);
      state = { entries: [], imported: { guardia_log_keys: [] } };
      return;
    }

    const payload = data?.[0]?.payload;
    state = payload && typeof payload === "object" ? payload : { entries: [], imported: { guardia_log_keys: [] } };
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

    // Bloqueo real (visible):
    // - readonly evita edición
    // - bloqueo de teclado/pegar para que no cambie “ni de casualidad”
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

    // siempre mostramos algo
    if (!String(h.value || "").trim()) h.value = hhmmArNow();
  }

  function limpiarForm({ keepHora = true } = {}) {
    if (elCausa()) elCausa().value = "";
    if (elNovedad()) elNovedad().value = "";

    if (elHora()) {
      elHora().value = keepHora ? hhmmArNow() : "";
    }
  }

  // ===== IMPORT RETIROS DESDE GUARDIA =====

  function normalizeAccion(accion) {
    return String(accion || "").trim();
  }

  // Importamos cualquier acción no vacía (Ingreso/Retiro/Presente/Franco/Constancia/Novedad, etc.)
  function isImportableAccion(accion) {
    return normalizeAccion(accion).length > 0;
  }

  function safeArr(x) {
    return Array.isArray(x) ? x : [];
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

  function fmtCartuchosQty(map) {
    const m = map && typeof map === "object" && !Array.isArray(map) ? map : {};
    const parts = [];
    // keys esperadas: at_12_70, pg_12_70
    if (m.at_12_70 !== undefined) parts.push(`AT 12/70: ${m.at_12_70}`);
    if (m.pg_12_70 !== undefined) parts.push(`PG 12/70: ${m.pg_12_70}`);
    return parts.length ? parts.join(" | ") : "";
  }

  function buildNovedadFromLog(log) {
    const accion = normalizeAccion(log?.accion) || "Acción";
    const p = String(log?.patrulla || "").trim();
    const snap = log?.snapshot || {};

    const lugar = String(snap?.lugar || "").trim() || "-";
    const obs = String(snap?.obs || "").trim();

    const personal = fmtPersonal(snap?.personal_ids);
    const moviles = fmtMoviles(snap?.moviles);
    const elementos = fmtElementos(snap?.elementos_ids);

    const obsTxt = obs ? ` · Obs: ${obs}` : "";
    const cartTxt = fmtCartuchosQty(snap?.cartuchos_qty_map);
    const cartLine = cartTxt ? `\nCartuchos: ${cartTxt}` : "";

    // 🔥 acá impactan Libro/TVF porque fmtMovil los agrega.
    return `${accion.toUpperCase()}${p ? " " + p : ""} · Lugar: ${lugar}${obsTxt}\nPersonal: ${personal}\nMóviles: ${moviles}\nElementos: ${elementos}${cartLine}`;
  }

  async function loadGuardiaPayload() {
    const { data, error } = await sb.from(GUARDIA_TABLE).select("payload").eq("id", GUARDIA_ROW_ID).limit(1);
    if (error) throw error;
    const payload = data?.[0]?.payload;
    return payload && typeof payload === "object" ? payload : null;
  }

  // ✅ Devuelve true si importó algo nuevo; false si no había novedades
  async function importLogsFromGuardiaIfNeeded() {
    try {
      ensureStateShape();

      const guardia = await loadGuardiaPayload();
      const logs = safeArr(guardia?.log);

      if (!logs.length) return false;

      const imported = new Set(state.imported.guardia_log_keys.map(String));
      const nuevos = [];

      logs.forEach((l) => {
        const accionRaw = normalizeAccion(l?.accion);
        if (!isImportableAccion(accionRaw)) return;

        // key estable (preferimos ts; fallback a hora+patrulla+accion+resumen)
        const key = String(l?.ts || `${l?.hora || ""}|${l?.patrulla || ""}|${accionRaw}|${l?.resumen || ""}`).trim();
        if (!key) return;
        if (imported.has(key)) return;

        const hora = String(l?.hora || "").trim() || hhmmArNow();
        const causa = `${accionRaw}${l?.patrulla ? " " + String(l.patrulla).trim() : ""}`.trim();
        const novedad = buildNovedadFromLog(l);

        nuevos.push({ key, hora, causa, novedad, accion: accionRaw });
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
          tipo: String(x.accion || "").trim().toLowerCase(),
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

  // ✅ Gatillo: cuando el usuario entra a la solapa Libro Memorándum
  function bindImportOnTabOpen() {
    // Botón tab (tu HTML: <button class="tab-btn" data-tab="libro">Libro memorándum</button>)
    const tabBtn = document.querySelector('.tab-btn[data-tab="libro"]');

    // Panel (por si algún día cambias tabs.js)
    const tabPanel = document.getElementById("tab-libro");

    const handler = async () => {
      // Importa SOLO novedades (dedupe por imported.guardia_log_keys)
      const changed = await importLogsFromGuardiaIfNeeded();

      // Si no hubo cambios, igual renderizamos (por si el usuario borró asientos, etc.)
      render();

      // Mantener hora visible siempre
      bloquearHora();

      // (Opcional) podés mostrar un estado, pero no alertamos para no molestar.
      // console.log("[LIBRO] import trigger, changed:", changed);
      return changed;
    };

    if (tabBtn && !tabBtn.__libroImportBound) {
      tabBtn.__libroImportBound = true;
      tabBtn.addEventListener("click", () => handler().catch(() => {}));
    }

    // Fallback: si por algún motivo tabs.js no dispara click del botón,
    // igual intentamos importar cuando el panel se vuelve visible (poll liviano).
    if (tabPanel && !tabPanel.__libroVisWatcher) {
      tabPanel.__libroVisWatcher = true;

      let lastVisible = false;

      const isVisible = () => {
        // is-active o display != none
        const active = tabPanel.classList.contains("is-active");
        const styleOk = window.getComputedStyle(tabPanel).display !== "none";
        return active || styleOk;
      };

      setInterval(() => {
        const vis = isVisible();
        if (vis && !lastVisible) {
          handler().catch(() => {});
        }
        lastVisible = vis;
      }, 600);
    }
  }

  // ===== Acciones manuales del libro =====

  async function onAgregar() {
    // Hora se fija SIEMPRE al presionar el botón
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

      // Asegura que Hora quede bloqueada incluso si el tab se re-renderiza.
      bloquearHora();

      // ✅ gatillo de importación al abrir solapa (sin tocar otros archivos)
      bindImportOnTabOpen();
    },

    async init() {
      await loadFromServer();
      ensureStateShape();

      // NO importamos acá: el gatillo es entrar a la solapa "Libro memorándum"
      bloquearHora();
      render();
    },

    // Por si después querés llamar esto manualmente desde otro lado.
    async importLogsNow() {
      const changed = await importLogsFromGuardiaIfNeeded();
      render();
      return changed;
    },

    // Compat con versiones anteriores que llamaban a "importRetirosNow".
    async importRetirosNow() {
      return this.importLogsNow();
    },
  };
}
