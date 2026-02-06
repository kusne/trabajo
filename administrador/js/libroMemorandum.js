// administrador/js/libroMemorandum.js
// Tabla: public.libro_memorandum_store (id int PK, payload jsonb, updated_at timestamptz)
// Guarda un único JSON (id=1) similar a guardia.

const TABLE = "libro_memorandum_store";
const ROW_ID = 1;

export function initLibroMemorandum({ sb }) {
  // ===== DOM getters (no rompen si el tab no existe) =====
  const elCausa = () => document.getElementById("libroCausa");
  const elHora = () => document.getElementById("libroHora");
  const elNovedad = () => document.getElementById("libroNovedad");

  const tbody = () => document.getElementById("libroTbody");
  const elPreview = () => document.getElementById("libroJsonPreview");

  const btnAgregar = () => document.getElementById("btnLibroAgregar");
  const btnLimpiar = () => document.getElementById("btnLibroLimpiar");
  const btnImportarGuardia = () => document.getElementById("btnLibroImportarGuardia");

  let state = { entries: [], importedKeys: [] };

  function nowIso() {
    return new Date().toISOString();
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

    // borrar (delegación simple)
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
      state = { entries: [], importedKeys: [] };
      return;
    }

    const payload = data?.[0]?.payload;
    state = payload && typeof payload === "object" ? payload : { entries: [], importedKeys: [] };

    // normalización suave
    if (!Array.isArray(state.entries)) state.entries = [];
    if (!Array.isArray(state.importedKeys)) state.importedKeys = [];
  }

  async function saveToServer() {
    const row = { id: ROW_ID, payload: state, updated_at: nowIso() };
    const { error } = await sb.from(TABLE).upsert(row, { onConflict: "id" });

    if (error) {
      console.error("[LIBRO] save error:", error);
      alert("Error guardando Libro Memorándum. Mirá Console (F12).");
      return false;
    }
    return true;
  }

  function limpiarForm() {
    if (elCausa()) elCausa().value = "";
    if (elHora()) elHora().value = "";
    if (elNovedad()) elNovedad().value = "";
  }

  function validarHora(h) {
    const m = String(h || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh < 0 || hh > 23) return null;
    if (mm < 0 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  async function onAgregar() {
    const causa = (elCausa()?.value || "").trim();
    const hora = validarHora((elHora()?.value || "").trim());
    const novedad = (elNovedad()?.value || "").trim();

    if (!causa) return alert("Seleccioná una causa.");
    if (!hora) return alert("Hora inválida. Usá formato HH:MM (ej: 20:15).");
    if (!novedad) return alert("Escribí la novedad / referencia.");

    const user = await getUserEmail();
    const entry = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      ts: nowIso(),
      user,
      causa,
      hora,
      novedad,
    };

    const entries = Array.isArray(state?.entries) ? state.entries : [];
    state = { ...state, entries: [...entries, entry] };

    render();
    await saveToServer();
    limpiarForm();
  }

  function keyForImported(e) {
    // clave estable: ts + patrulla + accion
    const ts = String(e?.ts || "");
    const patrulla = String(e?.patrulla || "");
    const accion = String(e?.accion || "");
    return `${ts}__${patrulla}__${accion}`;
  }

  async function loadGuardiaPayload() {
    const { data, error } = await sb.from("guardia_estado").select("payload").eq("id", 1).limit(1);
    if (error) {
      console.warn("[LIBRO] no pude leer guardia_estado:", error);
      return null;
    }
    return data?.[0]?.payload || null;
  }

  function buildNovedadFromLogItem(item) {
    const snap = item?.snapshot || {};
    const lugar = String(snap?.lugar || "").trim();
    const obs = String(snap?.obs || "").trim();
    const encabezado = `${String(item?.patrulla || "")} ${String(item?.accion || "").toUpperCase()} ${String(item?.hora || "")}`.trim();

    const base = String(item?.resumen || "").trim();
    const parts = [];
    if (encabezado) parts.push(encabezado);
    if (lugar) parts.push(`Lugar: ${lugar}`);
    if (obs) parts.push(`Obs: ${obs}`);
    if (base) parts.push(base);

    return parts.join(" | ");
  }

  async function onImportarGuardia() {
    const payload = await loadGuardiaPayload();
    const log = Array.isArray(payload?.log) ? payload.log : [];

    if (!log.length) {
      alert("Guardia: no hay registros para importar.");
      return;
    }

    const entries = Array.isArray(state?.entries) ? state.entries : [];
    const importedKeys = new Set(Array.isArray(state?.importedKeys) ? state.importedKeys : []);

    let added = 0;
    const user = await getUserEmail();

    // importamos desde el más viejo al más nuevo para que el libro quede cronológico
    const ordered = [...log].reverse();

    ordered.forEach((item) => {
      const k = keyForImported(item);
      if (importedKeys.has(k)) return;

      const hora = validarHora(String(item?.hora || "").trim());
      if (!hora) return;

      const entry = {
        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        ts: String(item?.ts || nowIso()),
        user,
        causa: "GUARDIA",
        hora,
        novedad: buildNovedadFromLogItem(item),
        // guardamos el original por si luego querés rearmar texto
        source: {
          from: "guardia_estado",
          patrulla: item?.patrulla,
          accion: item?.accion,
          ts: item?.ts,
          snapshot: item?.snapshot || null,
        },
      };

      entries.push(entry);
      importedKeys.add(k);
      added += 1;
    });

    if (!added) {
      alert("No se importó nada (todo ya estaba importado o sin hora válida).");
      return;
    }

    state = { ...state, entries, importedKeys: Array.from(importedKeys) };
    render();
    await saveToServer();
    alert(`Importado(s): ${added} asiento(s) desde Guardia.`);
  }

  function onLimpiar() {
    limpiarForm();
  }

  return {
    bind() {
      const a = btnAgregar();
      const l = btnLimpiar();
      const ig = btnImportarGuardia();
      if (a) a.addEventListener("click", onAgregar);
      if (l) l.addEventListener("click", onLimpiar);
      if (ig) ig.addEventListener("click", () => onImportarGuardia().catch(console.error));
    },
    async init() {
      await loadFromServer();
      render();
    },
  };
}
