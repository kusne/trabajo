// administrador/js/libroMemorandum.js
// Tabla: public.libro_memorandum_store (id int PK, payload jsonb, updated_at timestamptz)

import { state as appState } from "./state.js";

const TABLE = "libro_memorandum_store";
const ROW_ID = 1;

function hhmmNowLocal() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

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

function validarHora(h) {
  // <input type="time"> => "HH:MM"
  const m = String(h || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23) return null;
  if (mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function initLibroMemorandum({ sb }) {
  // ===== DOM getters =====
  const elCausa = () => document.getElementById("libroCausa");
  const elHora = () => document.getElementById("libroHora");
  const elNovedad = () => document.getElementById("libroNovedad");

  const tbody = () => document.getElementById("libroTbody");
  const elPreview = () => document.getElementById("libroJsonPreview");

  const btnAgregar = () => document.getElementById("btnLibroAgregar");
  const btnLimpiar = () => document.getElementById("btnLibroLimpiar");
  const btnImportar = () => document.getElementById("btnLibroImportarGuardia");

  let state = { entries: [] };

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
      state = { entries: [] };
      return;
    }

    const payload = data?.[0]?.payload;
    state = payload && typeof payload === "object" ? payload : { entries: [] };
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
    if (elNovedad()) elNovedad().value = "";
    // la hora la dejamos auto
    setHoraAuto();
  }

  // ✅ NUEVO: setear hora automática en el input
  function setHoraAuto() {
    const h = elHora();
    if (!h) return;
    h.value = hhmmNowLocal();
  }

  // ✅ OPCIONAL: bloquear edición manual (si querés)
  function lockHoraReadonly() {
    const h = elHora();
    if (!h) return;
    // input type="time" no soporta readonly real en todos los navegadores,
    // así que lo mejor es disabled=false y "pisa" al agregar.
    // Si querés bloquear sí o sí: descomentá esto:
    // h.disabled = true;
  }

  async function onAgregar() {
    const causa = (elCausa()?.value || "").trim();
    const novedad = (elNovedad()?.value || "").trim();

    if (!causa) return alert("Seleccioná una causa.");
    if (!novedad) return alert("Escribí la novedad / referencia.");

    // ✅ clave: la hora se toma del MOMENTO del click, no de un valor escrito
    const horaAuto = hhmmNowLocal();
    const hora = validarHora(horaAuto);
    if (!hora) return alert("No se pudo obtener hora válida.");

    // reflejamos en UI para que se vea qué se guardó
    if (elHora()) elHora().value = hora;

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

  function onLimpiar() {
    limpiarForm();
  }

  async function onImportarDesdeGuardia() {
    const log = appState?.guardiaState?.log || appState?.guardia?.log || [];
    if (!Array.isArray(log) || !log.length) {
      alert("No hay acciones registradas en Guardia para importar.");
      return;
    }

    const existingKeys = new Set((state.entries || []).map((e) => String(e?.from_guardia_key || "")));
    const user = await getUserEmail();

    const nuevos = [];
    log.forEach((x) => {
      const key = `${x?.ts || ""}|${x?.accion || ""}|${x?.patrulla || ""}`;
      if (!x?.ts || !x?.hora || !x?.accion || !x?.patrulla) return;
      if (existingKeys.has(key)) return;

      nuevos.push({
        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        ts: nowIso(),
        user,
        causa: String(x.accion),
        hora: String(x.hora), // mantiene la hora real del evento guardia
        novedad: `${String(x.patrulla)} — ${String(x.resumen || "").trim()}`,
        from_guardia_key: key,
      });
    });

    if (!nuevos.length) {
      alert("No hay nuevas acciones para importar (ya estaban importadas).");
      return;
    }

    const entries = Array.isArray(state?.entries) ? state.entries : [];
    state = { ...state, entries: [...entries, ...nuevos] };

    render();
    await saveToServer();
    alert(`Importadas: ${nuevos.length} acciones desde Guardia.`);
  }

  return {
    bind() {
      const a = btnAgregar();
      const l = btnLimpiar();
      const i = btnImportar();

      if (a) a.addEventListener("click", onAgregar);
      if (l) l.addEventListener("click", onLimpiar);
      if (i) i.addEventListener("click", () => onImportarDesdeGuardia().catch(console.error));

      // ✅ seteo inicial de hora
      setHoraAuto();
      lockHoraReadonly();

      // ✅ si el usuario vuelve al tab o hace focus en novedad, actualizamos hora visible
      const n = elNovedad();
      if (n) n.addEventListener("focus", () => setHoraAuto());
    },
    async init() {
      await loadFromServer();
      render();

      // ✅ al cargar, muestra hora actual
      setHoraAuto();
    },
  };
}
