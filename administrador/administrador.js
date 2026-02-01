// ===== PUENTE GLOBAL (NO SE ROMPE CON DOMContentLoaded NI CON PISADAS) =====
window.agregarOrden = function () {
  if (typeof window.__adm_agregarOrden === "function") return window.__adm_agregarOrden();
  alert("ADM no inicializó agregarOrden. Hacé Ctrl+F5.");
};

window.publicarOrdenes = function () {
  if (typeof window.__adm_publicarOrdenes === "function") return window.__adm_publicarOrdenes();
  alert("ADM no inicializó publicarOrdenes. Hacé Ctrl+F5.");
};

console.log("ADM/administrador.js cargado OK - puente global activo");

// ===== CONFIG SUPABASE (SOLO ADM) =====
const SUPABASE_URL = "https://ugeydxozfewzhldjbkat.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ZeLC2rOxhhUXlQdvJ28JkA_qf802-pX";

// Guard REAL: si el HTML no cargó el CDN de supabase antes, CORTAMOS para evitar crash
if (!window.supabase || typeof window.supabase.createClient !== "function") {
  console.error("Supabase no está cargado. Verificá el orden de scripts (CDN antes que administrador.js)");
  alert("Error: Supabase no está cargado. Revisá el orden de scripts.");
  throw new Error("Supabase no está cargado");
}

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ======================================================
// Utils
// ======================================================
function isoToLatam(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function normalizarOrdenParaPublicar(o) {
  const out = { ...o };
  out.vigencia = isoToLatam(out.vigencia);
  if (Array.isArray(out.franjas)) out.franjas = out.franjas.map((f) => ({ ...f }));
  else out.franjas = [];
  return out;
}

function normalizarLugar(l) {
  return String(l || "").trim().replace(/\s+/g, " ");
}

function hhmmNow() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function ymdToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function makeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function slugifyValue(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[áàäâ]/g, "a")
    .replace(/[éèëê]/g, "e")
    .replace(/[íìïî]/g, "i")
    .replace(/[óòöô]/g, "o")
    .replace(/[úùüû]/g, "u")
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function getSessionOrNull() {
  const { data: { session }, error } = await supabaseClient.auth.getSession();
  if (error || !session?.access_token) return null;
  return session;
}

// PATCH id=1; si no existe, intentamos INSERT id=1
async function patchOrInsertStore({ table, payload, session }) {
  const urlPatch = `${SUPABASE_URL}/rest/v1/${table}?id=eq.1`;
  const body = JSON.stringify({ payload, updated_at: new Date().toISOString() });

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

  // Si no existe fila id=1 (404 / 406 según config), intentamos INSERT
  if (!resp.ok) {
    const txt = await resp.text();
    // Heurística: si fue “no rows” / 404-like, probamos insert
    const maybeMissingRow = resp.status === 404 || resp.status === 406 || /0 rows/i.test(txt) || /not found/i.test(txt);
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
        body: JSON.stringify([{ id: 1, payload, updated_at: new Date().toISOString() }]),
      });
    } else {
      // si no es missing row, devolvemos el error original
      return { ok: false, status: resp.status, text: txt };
    }
  }

  if (!resp.ok) {
    const txt2 = await resp.text();
    return { ok: false, status: resp.status, text: txt2 };
  }

  let data = null;
  try { data = await resp.json(); } catch {}
  return { ok: true, data };
}

document.addEventListener("DOMContentLoaded", async () => {
  // ===== CONTENEDORES LOGIN / ADM =====
  const loginContainer = document.getElementById("loginContainer");
  const admContainer = document.getElementById("admContainer");

  // ===== LOGIN ELEMENTS =====
  const btnLogin = document.getElementById("btnLogin");
  const btnForgot = document.getElementById("btnForgot");
  const loginEmail = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");
  const loginError = document.getElementById("loginError");

  // ===== TABS =====
  const tabBtns = Array.from(document.querySelectorAll(".tab-btn"));
  const tabPanels = {
    ordenes: document.getElementById("tab-ordenes"),
    guardia: document.getElementById("tab-guardia"),
  };

  function activarTab(nombre) {
    tabBtns.forEach((b) => b.classList.toggle("is-active", b.dataset.tab === nombre));
    Object.keys(tabPanels).forEach((k) => tabPanels[k]?.classList.toggle("is-active", k === nombre));
  }

  tabBtns.forEach((b) => b.addEventListener("click", () => activarTab(b.dataset.tab)));

  // ===== ADM ELEMENTS (ÓRDENES) =====
  const chkFinalizar = document.getElementById("aFinalizarCheckbox");
  const fechaCaducidadInput = document.getElementById("fechaCaducidad");
  const numOrdenEl = document.getElementById("numOrden");
  const textoRefEl = document.getElementById("textoRef");
  const franjasEl = document.getElementById("franjas");
  const fechaVigenciaEl = document.getElementById("fechaVigencia");
  const selectOrdenExistente = document.getElementById("ordenExistente");
  const btnPublicar = document.getElementById("btnPublicarOrdenes");

  // ===== INVENTARIO UI =====
  const invTipo = document.getElementById("invTipo");
  const invLabel = document.getElementById("invLabel");
  const invValue = document.getElementById("invValue");
  const invOrden = document.getElementById("invOrden");
  const btnInvAgregar = document.getElementById("btnInvAgregar");
  const btnInvRefrescar = document.getElementById("btnInvRefrescar");
  const invLista = document.getElementById("invLista");
  const invEstado = document.getElementById("invEstado");

  // ===== RETIROS UI =====
  const elBaseEstado = document.getElementById("baseEstado");
  const preBase = document.getElementById("baseJsonPreview");

  const selBaseLugar = document.getElementById("baseLugar");
  const inpHoraRetiro = document.getElementById("baseHoraRetiro");
  const inpHoraInicioPrev = document.getElementById("baseHoraInicioPrev");
  const inpMision = document.getElementById("baseMision");
  const inpObs = document.getElementById("baseObs");

  const boxPersonal = document.getElementById("basePersonalList");
  const boxMovil = document.getElementById("baseMovilList");
  const boxElementos = document.getElementById("baseElementosList");

  const btnRegistrarRetiro = document.getElementById("btnRegistrarRetiro");
  const btnCerrarRetiro = document.getElementById("btnCerrarRetiro");
  const btnRefrescarRetiros = document.getElementById("btnRefrescarRetiros");
  const contRetirosAbiertos = document.getElementById("retirosAbiertosList");

  // ===== LOGOUT =====
  const btnLogout = document.getElementById("btnLogout");
  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      if (admContainer) admContainer.style.display = "none";
      if (loginContainer) loginContainer.style.display = "block";
    });
  }

  // ======================================================
  // ESTADO DE CAMBIOS / PUBLICACIÓN (ÓRDENES)
  // ======================================================
  let cambiosId = 0;
  let ultimoPublicadoId = 0;
  let ordenSeleccionadaIdx = null;

  function marcarCambio() {
    cambiosId++;
    actualizarEstadoPublicar();
  }

  function puedePublicar() {
    return cambiosId > ultimoPublicadoId;
  }

  function actualizarEstadoPublicar() {
    if (!btnPublicar) return;
    const habilitado = puedePublicar();
    btnPublicar.dataset.canPublish = habilitado ? "1" : "0";
    btnPublicar.classList.toggle("disabled", !habilitado);
  }

  // ======================================================
  // PARSE FRANJAS (HORARIO - LUGAR - TÍTULO)
  // ======================================================
  function parseFranjas(raw) {
    const lines = String(raw || "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    const out = [];
    const re = /^(.*?)\s*[-–—]\s*(.*?)\s*[-–—]\s*(.*?)$/;

    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i]);
      if (!m) return { ok: false, error: `Error en franja ${i + 1}` };
      out.push({ horario: m[1].trim(), lugar: m[2].trim(), titulo: m[3].trim() });
    }

    return out.length ? { ok: true, franjas: out } : { ok: false, error: "Franjas vacías" };
  }

  // ======================================================
  // SELECTOR ÓRDENES
  // ======================================================
  function actualizarSelector() {
    if (!selectOrdenExistente) return;

    if (typeof StorageApp === "undefined" || !StorageApp.cargarOrdenes) {
      console.error("StorageApp no disponible. No se puede cargar selector.");
      return;
    }

    const ordenes = StorageApp.cargarOrdenes();
    selectOrdenExistente.innerHTML = "";

    const optVacio = document.createElement("option");
    optVacio.value = "";
    optVacio.text = "";
    selectOrdenExistente.appendChild(optVacio);

    ordenes.forEach((o, i) => {
      if (!o || !o.num) return;
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.text = `${o.num} ${o.textoRef || ""}`.trim();
      selectOrdenExistente.appendChild(opt);
    });

    selectOrdenExistente.value = "";
  }

  function limpiarCampos() {
    if (numOrdenEl) numOrdenEl.value = "";
    if (textoRefEl) textoRefEl.value = "";
    if (franjasEl) franjasEl.value = "";
    if (fechaVigenciaEl) fechaVigenciaEl.value = "";
    if (fechaCaducidadInput) fechaCaducidadInput.value = "";
    if (chkFinalizar) chkFinalizar.checked = false;
    ordenSeleccionadaIdx = null;
    if (selectOrdenExistente) selectOrdenExistente.value = "";
  }

  function limpiarOrdenesCaducadas() {
    if (typeof StorageApp === "undefined" || !StorageApp.cargarOrdenes || !StorageApp.guardarOrdenes) return;
    if (typeof OrdersSync === "undefined" || !OrdersSync.filtrarCaducadas) return;

    const ordenes = StorageApp.cargarOrdenes();
    const filtradas = OrdersSync.filtrarCaducadas(ordenes);
    StorageApp.guardarOrdenes(filtradas);
  }

  // ======================================================
  // AGREGAR / ACTUALIZAR ORDEN
  // ======================================================
  function agregarOrden() {
    if (typeof StorageApp === "undefined" || !StorageApp.cargarOrdenes || !StorageApp.guardarOrdenes) {
      alert("Error: StorageApp no está disponible.");
      return;
    }

    const num = (numOrdenEl?.value || "").trim();
    const textoRef = (textoRefEl?.value || "").trim();
    const vigencia = (fechaVigenciaEl?.value || "").trim();
    const caducidad = (fechaCaducidadInput?.value || "").trim();
    const rawFranjas = (franjasEl?.value || "").trim();

    if (!num) return alert("Número de Orden: obligatorio");
    if (!vigencia) return alert("Fecha de Vigencia: obligatoria");
    if (!caducidad) return alert("Fecha de Caducidad: obligatoria (o A FINALIZAR)");
    if (!rawFranjas) return alert("Franjas: obligatorias");

    const parsed = parseFranjas(rawFranjas);
    if (!parsed.ok) return alert(parsed.error || "Error en franjas");

    const nueva = { num, textoRef, vigencia, caducidad, franjas: parsed.franjas };

    const ordenes = StorageApp.cargarOrdenes();
    if (ordenSeleccionadaIdx !== null && ordenes[ordenSeleccionadaIdx]) {
      ordenes[ordenSeleccionadaIdx] = nueva;
    } else {
      ordenes.push(nueva);
    }

    StorageApp.guardarOrdenes(ordenes);

    actualizarSelector();
    limpiarCampos();
    marcarCambio();

    // refresca lugares base
    cargarLugaresBase();

    alert("Orden guardada.");
  }

  window.__adm_agregarOrden = agregarOrden;

  // ======================================================
  // FINALIZAR / CADUCIDAD
  // ======================================================
  if (typeof CaducidadFinalizar !== "undefined" && typeof CaducidadFinalizar.bindAFinalizar === "function") {
    CaducidadFinalizar.bindAFinalizar({
      checkboxEl: chkFinalizar,
      inputEl: fechaCaducidadInput,
    });
  }

  // ======================================================
  // SELECT ORDEN EXISTENTE
  // ======================================================
  if (selectOrdenExistente) {
    selectOrdenExistente.addEventListener("change", () => {
      const v = selectOrdenExistente.value;
      if (v === "") {
        limpiarCampos();
        return;
      }

      const idx = Number(v);
      if (isNaN(idx)) return;

      if (typeof StorageApp === "undefined" || !StorageApp.cargarOrdenes) return;

      const ordenes = StorageApp.cargarOrdenes();
      const o = ordenes[idx];
      if (!o) return;

      ordenSeleccionadaIdx = idx;

      if (numOrdenEl) numOrdenEl.value = o.num || "";
      if (textoRefEl) textoRefEl.value = o.textoRef || "";
      if (fechaVigenciaEl) fechaVigenciaEl.value = o.vigencia || "";
      if (fechaCaducidadInput) fechaCaducidadInput.value = o.caducidad || "";

      if (franjasEl) {
        franjasEl.value = (o.franjas || []).map((f) => `${f.horario} - ${f.lugar} - ${f.titulo}`).join("\n");
      }

      // refresca lugares base (por si cambió alguna franja/lugar)
      cargarLugaresBase();
    });
  }

  // ======================================================
  // ELIMINAR ORDEN
  // ======================================================
  function eliminarOrden() {
    if (ordenSeleccionadaIdx === null || ordenSeleccionadaIdx === undefined) {
      alert("Primero seleccioná una orden para eliminar.");
      return;
    }

    if (typeof StorageApp === "undefined" || !StorageApp.cargarOrdenes || !StorageApp.guardarOrdenes) {
      alert("Error: StorageApp no está disponible.");
      return;
    }

    const ordenes = StorageApp.cargarOrdenes();
    const o = ordenes[ordenSeleccionadaIdx];

    if (!o) {
      alert("La orden seleccionada no existe (puede haber cambiado).");
      ordenSeleccionadaIdx = null;
      actualizarSelector();
      limpiarCampos();
      return;
    }

    const ok = confirm(`¿Está seguro de eliminar la orden "${o.num}"?`);
    if (!ok) return;

    ordenes.splice(ordenSeleccionadaIdx, 1);
    StorageApp.guardarOrdenes(ordenes);

    ordenSeleccionadaIdx = null;
    limpiarCampos();
    actualizarSelector();
    marcarCambio();

    cargarLugaresBase();
    alert("Orden eliminada.");
  }

  window.eliminarOrden = eliminarOrden;

  // ======================================================
  // PUBLICAR ÓRDENES
  // ======================================================
  async function publicarOrdenes() {
    if (!puedePublicar()) {
      alert("Primero cargue una orden");
      return;
    }

    if (typeof StorageApp === "undefined" || !StorageApp.cargarOrdenes) {
      alert("Error: StorageApp no está disponible para publicar.");
      return;
    }

    const ordenes = StorageApp.cargarOrdenes();
    const payloadPublicar = Array.isArray(ordenes) ? ordenes.map(normalizarOrdenParaPublicar) : [];

    const session = await getSessionOrNull();
    if (!session) {
      alert("No hay sesión iniciada. Inicie sesión antes de publicar.");
      return;
    }

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/ordenes_store?id=eq.1`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({ payload: payloadPublicar, updated_at: new Date().toISOString() }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("[ADM] Publicar órdenes error:", resp.status, txt);
      alert("Error publicando. Mirá Console (F12). Status: " + resp.status);
      return;
    }

    ultimoPublicadoId = cambiosId;
    actualizarEstadoPublicar();
    alert("Órdenes publicadas.");
  }

  window.__adm_publicarOrdenes = publicarOrdenes;

  // ======================================================
  // INVENTARIO (Supabase: inventario_base)
  // ======================================================
  let inventario = [];

  function invActivos(tipo) {
    return inventario
      .filter((x) => x.tipo === tipo && x.activo)
      .sort((a, b) => (a.orden - b.orden) || a.label.localeCompare(b.label, "es"));
  }

  function invLabelFromValue(tipo, value) {
    const r = inventario.find((x) => x.tipo === tipo && x.value === value);
    return r ? r.label : value;
  }

  async function invLoad() {
    if (invEstado) invEstado.textContent = "Cargando inventario…";

    const { data, error } = await supabaseClient
      .from("inventario_base")
      .select("id,tipo,label,value,orden,activo")
      .order("tipo", { ascending: true })
      .order("orden", { ascending: true })
      .order("label", { ascending: true });

    if (error) {
      console.error("[ADM] inventario_base load error:", error);
      if (invEstado) invEstado.textContent = "Error cargando inventario (mirá Console).";
      inventario = [];
      renderInventarioLista();
      renderChipsDesdeInventario();
      return false;
    }

    inventario = Array.isArray(data) ? data : [];
    if (invEstado) invEstado.textContent = `Inventario: ${inventario.length} ítems`;
    renderInventarioLista();
    renderChipsDesdeInventario();
    return true;
  }

  async function invInsert() {
    const tipo = (invTipo?.value || "personal").trim();
    const label = (invLabel?.value || "").trim();
    let value = (invValue?.value || "").trim();
    const orden = Number(invOrden?.value || 0);

    if (!label) return alert("Label: obligatorio.");
    if (!value) value = slugifyValue(label);

    const { error } = await supabaseClient
      .from("inventario_base")
      .insert([{
        tipo,
        label,
        value,
        orden: isNaN(orden) ? 0 : orden,
        activo: true,
      }]);

    if (error) {
      console.error("[ADM] inventario_base insert error:", error);
      alert("Error agregando inventario. Mirá Console (F12).\n\nDetalle: " + (error.message || ""));
      return;
    }

    if (invLabel) invLabel.value = "";
    if (invValue) invValue.value = "";
    if (invOrden) invOrden.value = "0";

    await invLoad();
  }

  async function invToggleActivo(id, nextActivo) {
    const { error } = await supabaseClient
      .from("inventario_base")
      .update({ activo: !!nextActivo })
      .eq("id", id);

    if (error) {
      console.error("[ADM] inventario_base update activo error:", error);
      alert("Error actualizando activo. Mirá Console (F12).");
      return;
    }
    await invLoad();
  }

  async function invEditar(item) {
    const nLabel = prompt("Editar label:", item.label);
    if (nLabel === null) return;

    const nValue = prompt("Editar value:", item.value);
    if (nValue === null) return;

    const nOrdenStr = prompt("Editar orden (número):", String(item.orden ?? 0));
    if (nOrdenStr === null) return;

    const nOrden = Number(nOrdenStr);
    if (isNaN(nOrden)) return alert("Orden inválido.");

    const { error } = await supabaseClient
      .from("inventario_base")
      .update({ label: nLabel.trim(), value: nValue.trim(), orden: nOrden })
      .eq("id", item.id);

    if (error) {
      console.error("[ADM] inventario_base update error:", error);
      alert("Error editando inventario. Mirá Console (F12).");
      return;
    }

    await invLoad();
  }

  function renderInventarioLista() {
    if (!invLista) return;

    const rows = inventario
      .slice()
      .sort((a, b) =>
        (a.tipo.localeCompare(b.tipo, "es")) ||
        (a.orden - b.orden) ||
        a.label.localeCompare(b.label, "es")
      );

    if (!rows.length) {
      invLista.innerHTML = `<div class="muted">Sin ítems. Agregá personal/móviles/elementos arriba.</div>`;
      return;
    }

    invLista.innerHTML = rows.map((it) => {
      const badge = it.activo ? "ACTIVO" : "INACTIVO";
      return `
        <div style="border:1px solid #ddd; border-radius:10px; padding:10px; margin:8px 0; background:#fff;">
          <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
            <div>
              <div style="font-weight:700;">${esc(it.tipo)} — ${esc(it.label)} <span class="muted">(${esc(it.value)})</span></div>
              <div class="muted">Orden: ${esc(it.orden)} — Estado: ${badge}</div>
            </div>
            <div style="display:flex; gap:8px;">
              <button type="button" class="btn-ghost" data-inv-edit="${esc(it.id)}">Editar</button>
              <button type="button" class="${it.activo ? "btn-danger" : "btn-success"}" data-inv-toggle="${esc(it.id)}" data-next="${it.activo ? "0" : "1"}">
                ${it.activo ? "Desactivar" : "Activar"}
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    invLista.querySelectorAll("[data-inv-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-inv-toggle");
        const next = btn.getAttribute("data-next") === "1";
        invToggleActivo(id, next).catch((e) => console.error(e));
      });
    });

    invLista.querySelectorAll("[data-inv-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-inv-edit");
        const item = inventario.find((x) => x.id === id);
        if (!item) return;
        invEditar(item).catch((e) => console.error(e));
      });
    });
  }

  if (btnInvAgregar) btnInvAgregar.addEventListener("click", () => invInsert().catch((e) => console.error(e)));
  if (btnInvRefrescar) btnInvRefrescar.addEventListener("click", () => invLoad().catch((e) => console.error(e)));

  if (invLabel && invValue) {
    invLabel.addEventListener("input", () => {
      if ((invValue.value || "").trim()) return;
      invValue.value = slugifyValue(invLabel.value);
    });
  }

  // ======================================================
  // BASE / RETIROS (guardia_store.payload)
  // ======================================================
  let baseStore = { version: 1, retiros: [] };
  let retiroSeleccionadoId = null;

  function lugaresDesdeOrdenes() {
    if (typeof StorageApp === "undefined" || !StorageApp.cargarOrdenes) return [];
    const ordenes = StorageApp.cargarOrdenes();
    const set = new Set();

    (ordenes || []).forEach((o) => {
      (o?.franjas || []).forEach((f) => {
        const lug = normalizarLugar(f?.lugar);
        if (lug) set.add(lug);
      });
    });

    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }

  function cargarLugaresBase() {
    if (!selBaseLugar) return;
    const lugares = lugaresDesdeOrdenes();

    const actual = selBaseLugar.value || "";
    selBaseLugar.innerHTML = `<option value="">Seleccionar lugar</option>`;
    lugares.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l;
      opt.textContent = l;
      selBaseLugar.appendChild(opt);
    });

    if (actual && lugares.includes(actual)) selBaseLugar.value = actual;
  }

  function renderChips(container, items, { type, name, prefixId }) {
    if (!container) return;

    if (!items.length) {
      container.innerHTML = `<div class="muted">No hay ítems activos en inventario para este bloque.</div>`;
      return;
    }

    container.innerHTML = items.map((it, idx) => {
      const id = `${prefixId}_${idx}`;
      if (type === "radio") {
        return `
          <label class="checkbox-container" style="display:flex; align-items:center; gap:8px; border:1px solid #ddd; padding:6px 10px; border-radius:999px;">
            <input type="radio" name="${esc(name)}" id="${esc(id)}" value="${esc(it.value)}">
            <span>${esc(it.label)}</span>
          </label>
        `;
      }
      return `
        <label class="checkbox-container" style="display:flex; align-items:center; gap:8px; border:1px solid #ddd; padding:6px 10px; border-radius:999px;">
          <input type="checkbox" id="${esc(id)}" value="${esc(it.value)}">
          <span>${esc(it.label)}</span>
        </label>
      `;
    }).join("");
  }

  function renderChipsDesdeInventario() {
    renderChips(boxPersonal, invActivos("personal"), { type: "checkbox", prefixId: "per", name: "" });
    renderChips(boxMovil, invActivos("movil"), { type: "radio", name: "baseMovilRadio", prefixId: "mov" });
    renderChips(boxElementos, invActivos("elemento"), { type: "checkbox", prefixId: "elm", name: "" });
  }

  function leerSeleccionCheckbox(container) {
    if (!container) return [];
    const inputs = Array.from(container.querySelectorAll('input[type="checkbox"]'));
    return inputs.filter((i) => i.checked).map((i) => i.value);
  }

  function leerSeleccionRadio(container, name) {
    if (!container) return "";
    const el = container.querySelector(`input[type="radio"][name="${CSS.escape(name)}"]:checked`);
    return el ? el.value : "";
  }

  function renderBasePreview() {
    if (preBase) preBase.textContent = JSON.stringify(baseStore || {}, null, 2);

    const abiertos = (baseStore?.retiros || []).filter((r) => r?.estado === "ABIERTO");
    if (elBaseEstado) elBaseEstado.textContent = `Retiros abiertos: ${abiertos.length}`;

    if (contRetirosAbiertos) {
      if (!abiertos.length) {
        contRetirosAbiertos.innerHTML = `<div class="muted">No hay retiros abiertos.</div>`;
      } else {
        contRetirosAbiertos.innerHTML = abiertos.map((r) => {
          const isSel = retiroSeleccionadoId === r.id;
          const personalTxt = Array.isArray(r.personal) ? r.personal.join(", ") : String(r.personal || "");
          const elemsTxt = Array.isArray(r.elementos) ? r.elementos.join(", ") : String(r.elementos || "");
          return `
            <div data-retiro-id="${esc(r.id)}"
                 style="border:1px solid #ddd; border-radius:10px; padding:10px; margin:8px 0; cursor:pointer; background:${isSel ? "#f0f7ff" : "#fff"}">
              <div style="font-weight:700;">${esc(r.movil_label || r.movil_id || "SIN MÓVIL")} — ${esc(r.lugar || "SIN LUGAR")}</div>
              <div class="muted">Retiro: ${esc(r.hora_retiro || "")} — Fecha: ${esc(r.fecha || "")}</div>
              <div style="margin-top:6px;"><b>Personal:</b> ${esc(personalTxt || "-")}</div>
              <div><b>Elementos:</b> ${esc(elemsTxt || "-")}</div>
              <div class="muted" style="margin-top:6px;">(Click para seleccionar y poder cerrar)</div>
            </div>
          `;
        }).join("");

        contRetirosAbiertos.querySelectorAll("[data-retiro-id]").forEach((el) => {
          el.addEventListener("click", () => {
            retiroSeleccionadoId = el.getAttribute("data-retiro-id");
            renderBasePreview();
          });
        });
      }
    }

    if (btnCerrarRetiro) btnCerrarRetiro.disabled = !retiroSeleccionadoId;
  }

  async function cargarBaseDesdeServidor() {
    const session = await getSessionOrNull();
    if (!session) {
      baseStore = { version: 1, retiros: [] };
      renderBasePreview();
      return;
    }

    const r = await fetch(`${SUPABASE_URL}/rest/v1/guardia_store?select=payload&id=eq.1&limit=1`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Accept: "application/json",
        Authorization: "Bearer " + session.access_token,
      },
    });

    if (!r.ok) {
      const txt = await r.text();
      console.warn("[ADM] No se pudo leer guardia_store:", r.status, txt);
      baseStore = { version: 1, retiros: [] };
      renderBasePreview();
      return;
    }

    const data = await r.json();
    const payload = data?.[0]?.payload || null;

    if (payload && typeof payload === "object" && Array.isArray(payload.retiros)) baseStore = payload;
    else baseStore = { version: 1, retiros: [] };

    const abiertos = baseStore.retiros.filter((x) => x?.estado === "ABIERTO");
    if (retiroSeleccionadoId && !abiertos.some((x) => x.id === retiroSeleccionadoId)) retiroSeleccionadoId = null;

    renderBasePreview();
  }

  async function guardarBaseEnServidor(nextPayload) {
    const session = await getSessionOrNull();
    if (!session) {
      alert("No hay sesión iniciada. Inicie sesión antes de usar Guardia.");
      return false;
    }

    const res = await patchOrInsertStore({ table: "guardia_store", payload: nextPayload, session });
    if (!res.ok) {
      console.error("[ADM] Error guardando guardia_store:", res.status, res.text);
      alert("Error guardando retiros. Mirá Console (F12). Status: " + res.status);
      return false;
    }

    // Intento de leer payload devuelto
    const p = res.data?.[0]?.payload ?? res.data?.payload ?? null;
    baseStore = p && typeof p === "object" ? p : nextPayload;

    renderBasePreview();
    return true;
  }

  function limpiarSeleccionBase() {
    retiroSeleccionadoId = null;

    if (selBaseLugar) selBaseLugar.value = "";
    if (inpHoraRetiro) inpHoraRetiro.value = hhmmNow();
    if (inpHoraInicioPrev) inpHoraInicioPrev.value = "";
    if (inpMision) inpMision.value = "";
    if (inpObs) inpObs.value = "";

    if (boxPersonal) Array.from(boxPersonal.querySelectorAll('input[type="checkbox"]')).forEach((x) => x.checked = false);
    if (boxMovil) Array.from(boxMovil.querySelectorAll('input[type="radio"]')).forEach((x) => x.checked = false);
    if (boxElementos) Array.from(boxElementos.querySelectorAll('input[type="checkbox"]')).forEach((x) => x.checked = false);
  }

  async function onRegistrarRetiro() {
    await cargarBaseDesdeServidor(); // evita carreras

    const lugar = normalizarLugar(selBaseLugar?.value);
    const hora_retiro = (inpHoraRetiro?.value || "").trim() || hhmmNow();

    // ids desde inventario_base
    const personal_ids = leerSeleccionCheckbox(boxPersonal);
    const movil_id = leerSeleccionRadio(boxMovil, "baseMovilRadio");
    const elementos_ids = leerSeleccionCheckbox(boxElementos);

    const hora_inicio_prevista = (inpHoraInicioPrev?.value || "").trim() || null;
    const mision = (inpMision?.value || "").trim() || null;
    const obs = (inpObs?.value || "").trim() || null;

    if (!lugar) return alert("Seleccioná un lugar.");
    if (!personal_ids.length) return alert("Seleccioná al menos 1 personal.");
    if (!movil_id) return alert("Seleccioná 1 móvil.");

    // snapshots legibles (labels)
    const personal = personal_ids.map((v) => invLabelFromValue("personal", v));
    const elementos = elementos_ids.map((v) => invLabelFromValue("elemento", v));
    const movil_label = invLabelFromValue("movil", movil_id);

    // regla: 1 retiro ABIERTO por móvil
    const ya = (baseStore.retiros || []).find((r) => r?.estado === "ABIERTO" && String(r?.movil_id) === String(movil_id));
    if (ya) {
      const ok = confirm(`Ya existe un RETIRO ABIERTO para el móvil ${movil_label}.\n\n¿Querés CERRAR el anterior y abrir uno nuevo?`);
      if (!ok) return;

      ya.estado = "CERRADO";
      ya.hora_regreso = hhmmNow();
      ya.cierre_ts = new Date().toISOString();
    }

    const retiro = {
      id: makeId(),
      estado: "ABIERTO",
      fecha: ymdToday(),
      hora_retiro,
      lugar,

      // ids (para autocompletar WSP sin ambigüedad)
      personal_ids,
      movil_id,
      elementos_ids,

      // labels (para lectura humana)
      personal,
      movil_label,
      elementos,

      hora_inicio_prevista,
      mision_prevista: mision,
      observaciones: obs,

      retiro_ts: new Date().toISOString(),
      cierre_ts: null,
      hora_regreso: null,
    };

    const next = {
      ...baseStore,
      version: 1,
      retiros: [retiro, ...(baseStore.retiros || [])],
    };

    const okSave = await guardarBaseEnServidor(next);
    if (!okSave) return;

    limpiarSeleccionBase();
    await cargarBaseDesdeServidor();
    alert("RETIRO registrado (ABIERTO).");
  }

  async function onCerrarRetiro() {
    await cargarBaseDesdeServidor();

    if (!retiroSeleccionadoId) return alert("Seleccioná un retiro abierto primero.");
    const idx = (baseStore.retiros || []).findIndex((r) => r?.id === retiroSeleccionadoId && r?.estado === "ABIERTO");
    if (idx < 0) {
      retiroSeleccionadoId = null;
      renderBasePreview();
      return alert("Ese retiro ya no está ABIERTO.");
    }

    const r = baseStore.retiros[idx];
    r.estado = "CERRADO";
    r.hora_regreso = hhmmNow();
    r.cierre_ts = new Date().toISOString();

    const next = { ...baseStore, retiros: [...baseStore.retiros] };
    const okSave = await guardarBaseEnServidor(next);
    if (!okSave) return;

    retiroSeleccionadoId = null;
    await cargarBaseDesdeServidor();
    alert("RETIRO cerrado (ingreso de regreso).");
  }

  if (btnRegistrarRetiro) btnRegistrarRetiro.addEventListener("click", () => onRegistrarRetiro().catch((e) => console.error(e)));
  if (btnCerrarRetiro) btnCerrarRetiro.addEventListener("click", () => onCerrarRetiro().catch((e) => console.error(e)));
  if (btnRefrescarRetiros) btnRefrescarRetiros.addEventListener("click", () => cargarBaseDesdeServidor().catch((e) => console.error(e)));

  // ======================================================
  // INIT
  // ======================================================
  async function initAdm() {
    limpiarOrdenesCaducadas();
    actualizarSelector();
    cambiosId = 0;
    ultimoPublicadoId = 0;
    actualizarEstadoPublicar();

    // base / retiros
    if (inpHoraRetiro) inpHoraRetiro.value = hhmmNow();
    cargarLugaresBase();

    // preview base vacío, después carga real
    baseStore = { version: 1, retiros: [] };
    retiroSeleccionadoId = null;
    renderBasePreview();

    // inventario -> chips -> retiros
    await invLoad();
    await cargarBaseDesdeServidor();
  }

  // ======================================================
  // CONTROL DE SESIÓN + BOOT
  // ======================================================
  const session = await getSessionOrNull();

  if (!session) {
    if (loginContainer) loginContainer.style.display = "block";
    if (admContainer) admContainer.style.display = "none";
  } else {
    if (loginContainer) loginContainer.style.display = "none";
    if (admContainer) admContainer.style.display = "block";
    await initAdm();
  }

  // ======================================================
  // LOGIN
  // ======================================================
  if (btnLogin) {
    btnLogin.addEventListener("click", async () => {
      if (loginError) loginError.style.display = "none";

      const email = (loginEmail?.value || "").trim();
      const password = (loginPassword?.value || "").trim();

      if (!email || !password) {
        if (loginError) {
          loginError.textContent = "Complete email y contraseña";
          loginError.style.display = "block";
        }
        return;
      }

      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

      if (error) {
        if (loginError) {
          loginError.textContent = "Credenciales inválidas";
          loginError.style.display = "block";
        }
        return;
      }

      if (loginContainer) loginContainer.style.display = "none";
      if (admContainer) admContainer.style.display = "block";
      await initAdm();
    });
  }

  // ======================================================
  // OLVIDÉ MI CONTRASEÑA (robusto para cualquier repo)
  // ======================================================
  if (btnForgot) {
    btnForgot.addEventListener("click", async () => {
      const email = (loginEmail?.value || "").trim();
      if (!email) return alert("Escribí tu email primero.");

      const repoName = location.pathname.split("/")[1] || "";
      const redirectTo = repoName ? `${location.origin}/${repoName}/reset.html` : `${location.origin}/reset.html`;

      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });

      if (error) return alert("Error enviando mail: " + error.message);
      alert("Te enviamos un correo para restablecer la contraseña.");
    });
  }

  // Tab inicial
  activarTab("ordenes");
});
