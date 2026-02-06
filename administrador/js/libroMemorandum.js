// administrador/js/libroMemorandum.js
// Guarda un JSON único (id=1) en Supabase.
// Tabla: public.libro_memorandum_store (id int PK, payload jsonb, updated_at timestamptz)

const TABLE = "libro_memorandum_store";
const ROW_ID = 1;

export function initLibroMemorandum({ sb }) {
  // ====== DOM (3 columnas) ======
  const elCausa = () => document.getElementById("memoCausa");     // select
  const elHora = () => document.getElementById("memoHora");       // input time o text HH:MM
  const elNovedad = () => document.getElementById("memoNovedad"); // textarea/input

  const elTbody = () => document.getElementById("memoTbody");     // tbody de la tabla/lista
  const elPreview = () => document.getElementById("libroJsonPreview");

  const btnAgregar = () => document.getElementById("btnLibroAgregar");
  const btnLimpiar = () => document.getElementById("btnLibroLimpiar");

  // payload único: { items: [ {id, causa, hora, novedad, ts, user} ] }
  let state = { items: [] };

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

  function nowHHMM() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  function render() {
    const pre = elPreview();
    if (pre) pre.textContent = JSON.stringify(state || {}, null, 2);

    const tb = elTbody();
    if (!tb) return;

    const items = Array.isArray(state?.items) ? state.items : [];
    if (!items.length) {
      tb.innerHTML = `<tr><td colspan="4" class="muted">Sin asientos todavía.</td></tr>`;
      return;
    }

    // Últimos arriba
    const rows = items.slice().reverse();

    tb.innerHTML = rows
      .map((it) => {
        const id = escapeHtml(it.id);
        const causa = escapeHtml(it.causa);
        const hora = escapeHtml(it.hora);
        const nov = escapeHtml(it.novedad);

        return `
          <tr data-id="${id}">
            <td>${causa}</td>
            <td>${hora}</td>
            <td>${nov}</td>
            <td style="white-space:nowrap;">
              <button type="button" class="btn-danger btnMemoDel" data-id="${id}">Eliminar</button>
            </td>
          </tr>
        `;
      })
      .join("");

    // bind eliminar
    tb.querySelectorAll(".btnMemoDel").forEach((b) => {
      b.addEventListener("click", async () => {
        const id = b.getAttribute("data-id");
        if (!id) return;
        const ok = confirm("¿Eliminar este asiento del Libro Memorandum?");
        if (!ok) return;
        await eliminarItem(id);
      });
    });
  }

  async function loadFromServer() {
    const { data, error } = await sb.from(TABLE).select("payload").eq("id", ROW_ID).limit(1);

    if (error) {
      console.warn("[LIBRO] load error:", error);
      // No alert acá para no molestar al cargar
      state = { items: [] };
      return;
    }

    const payload = data?.[0]?.payload;
    if (payload && typeof payload === "object") {
      state = payload;
      if (!Array.isArray(state.items)) state.items = [];
    } else {
      state = { items: [] };
    }
  }

  async function saveToServer() {
    const row = {
      id: ROW_ID,
      payload: state,
      updated_at: new Date().toISOString(),
    };

    const { error } = await sb.from(TABLE).upsert(row, { onConflict: "id" });

    if (error) {
      console.error("[LIBRO] save error:", error);
      alert(
        "Error guardando Libro Memorandum. Mirá Console (F12).\n" +
          "Si dice que la tabla no existe, hay que crear: " + TABLE
      );
      return false;
    }
    return true;
  }

  function validarHHMM(h) {
    const m = String(h || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    return !!m;
  }

  function generarId() {
    return (crypto?.randomUUID?.() || String(Date.now()));
  }

  async function onAgregar() {
    const causa = (elCausa()?.value || "").trim();
    const hora = (elHora()?.value || "").trim();
    const novedad = (elNovedad()?.value || "").trim();

    if (!causa) return alert("Seleccioná una causa.");
    if (!hora) return alert("Ingresá la hora.");
    if (!validarHHMM(hora)) return alert("Hora inválida. Usá formato HH:MM (ej: 20:15).");
    if (!novedad) return alert("Escribí la novedad/referencia.");

    const user = await getUserEmail();

    const item = {
      id: generarId(),
      ts: new Date().toISOString(),
      user,
      causa,
      hora,
      novedad,
    };

    const items = Array.isArray(state?.items) ? state.items : [];
    state = { ...state, items: [...items, item] };

    render();
    await saveToServer();

    // limpiar inputs (dejamos hora con “ahora” por comodidad)
    if (elCausa()) elCausa().value = "";
    if (elHora()) elHora().value = nowHHMM();
    if (elNovedad()) elNovedad().value = "";
  }

  function onLimpiar() {
    if (elCausa()) elCausa().value = "";
    if (elHora()) elHora().value = nowHHMM();
    if (elNovedad()) elNovedad().value = "";
  }

  async function eliminarItem(id) {
    const items = Array.isArray(state?.items) ? state.items : [];
    state = { ...state, items: items.filter((x) => String(x.id) !== String(id)) };
    render();
    await saveToServer();
  }

  return {
    bind() {
      const a = btnAgregar();
      const l = btnLimpiar();
      if (a) a.addEventListener("click", onAgregar);
      if (l) l.addEventListener("click", onLimpiar);

      // default hora
      if (elHora() && !elHora().value) elHora().value = nowHHMM();
    },

    async init() {
      await loadFromServer();
      render();
    },
  };
}
