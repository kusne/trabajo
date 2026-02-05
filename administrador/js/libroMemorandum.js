// administrador/js/libroMemorandum.js
// Guarda un JSON único (id=1) en Supabase, similar a guardia_store.
// Tabla sugerida: libro_memorandum_store (id int PK, payload jsonb, updated_at timestamptz)

const TABLE = "libro_memorandum_store";
const ROW_ID = 1;

export function initLibroMemorandum({ sb }) {
  const elTexto = () => document.getElementById("libroTexto");
  const elLista = () => document.getElementById("libroLista");
  const elPreview = () => document.getElementById("libroJsonPreview");
  const btnAgregar = () => document.getElementById("btnLibroAgregar");
  const btnLimpiar = () => document.getElementById("btnLibroLimpiar");

  let state = { entries: [] };

  function fmt(ts) {
    try {
      return new Date(ts).toLocaleString("es-AR");
    } catch {
      return ts;
    }
  }

  function render() {
    const list = elLista();
    const pre = elPreview();

    if (pre) pre.textContent = JSON.stringify(state || {}, null, 2);

    if (!list) return;
    list.innerHTML = "";

    const entries = Array.isArray(state?.entries) ? state.entries : [];
    const last = entries.slice(-10).reverse();

    if (!last.length) {
      list.innerHTML = `<div class="muted">Sin asientos todavía.</div>`;
      return;
    }

    last.forEach((e) => {
      const div = document.createElement("div");
      div.className = "list-item";
      div.innerHTML = `
        <div class="meta">${fmt(e.ts)}${e.user ? " — " + e.user : ""}</div>
        <div>${escapeHtml(e.text || "")}</div>
      `;
      list.appendChild(div);
    });
  }

  function escapeHtml(s) {
    return String(s)
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

  async function loadFromServer() {
    // Si no existe la tabla, esto va a devolver error; lo mostramos claro.
    const { data, error } = await sb
      .from(TABLE)
      .select("payload")
      .eq("id", ROW_ID)
      .limit(1);

    if (error) {
      console.warn("[LIBRO] load error:", error);
      // No alert automático para no molestar en cada carga.
      return;
    }

    const payload = data?.[0]?.payload;
    if (payload && typeof payload === "object") {
      state = payload;
    } else {
      state = { entries: [] };
    }
  }

  async function saveToServer() {
    const row = {
      id: ROW_ID,
      payload: state,
      updated_at: new Date().toISOString(),
    };

    const { error } = await sb
      .from(TABLE)
      .upsert(row, { onConflict: "id" });

    if (error) {
      console.error("[LIBRO] save error:", error);
      alert(
        "Error guardando Libro Memorándum. Mirá Console (F12).\n" +
        "Si dice que la tabla no existe, hay que crear: " + TABLE
      );
      return false;
    }

    return true;
  }

  async function onAgregar() {
    const t = elTexto();
    const text = (t?.value || "").trim();
    if (!text) return alert("Escribí un asiento primero.");

    const user = await getUserEmail();

    const entry = {
      ts: new Date().toISOString(),
      user,
      text,
    };

    const entries = Array.isArray(state?.entries) ? state.entries : [];
    state = { ...state, entries: [...entries, entry] };

    render();

    // Guardar en servidor (si la tabla existe)
    await saveToServer();

    // limpiar
    if (t) t.value = "";
  }

  function onLimpiar() {
    const t = elTexto();
    if (t) t.value = "";
  }

  return {
    bind() {
      const a = btnAgregar();
      const l = btnLimpiar();
      if (a) a.addEventListener("click", onAgregar);
      if (l) l.addEventListener("click", onLimpiar);
    },

    async init() {
      await loadFromServer();
      render();
    },
  };
}
