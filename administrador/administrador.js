// ===== PUENTE GLOBAL (NO SE ROMPE CON DOMContentLoaded NI CON PISADAS) =====
window.agregarOrden = function () {
  if (typeof window.__adm_agregarOrden === "function") return window.__adm_agregarOrden();
  alert("ADM no inicializó agregarOrden. Hacé Ctrl+F5.");
};

window.publicarOrdenes = function () {
  if (typeof window.__adm_publicarOrdenes === "function") return window.__adm_publicarOrdenes();
  alert("ADM no inicializó publicarOrdenes. Hacé Ctrl+F5.");
};

window.eliminarOrden = function () {
  if (typeof window.__adm_eliminarOrden === "function") return window.__adm_eliminarOrden();
  alert("ADM no inicializó eliminarOrden. Hacé Ctrl+F5.");
};

console.log("ADM/administrador.js cargado OK - puente global activo");

// ===== CONFIG SUPABASE (SOLO ADM) =====
const SUPABASE_URL = "https://ugeydxozfewzhldjbkat.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ZeLC2rOxhhUXlQdvJ28JkA_qf802-pX";

// Guard REAL: si el HTML no cargó el CDN de supabase antes, CORTAMOS para evitar crash
if (!window.supabase || typeof window.supabase.createClient !== "function") {
  console.error(
    "Supabase no está cargado. Verificá en el HTML: <script src='https://unpkg.com/@supabase/supabase-js@2'></script> antes de administrador.js"
  );
  alert("Error: Supabase no está cargado. Revisá el orden de scripts.");
  throw new Error("Supabase no está cargado");
}

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function isoToLatam(iso) {
  // "2026-01-20" -> "20/01/2026"
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

// ======================================================
// TODO EL CÓDIGO DEPENDIENTE DEL DOM VA ACÁ
// ======================================================
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

  // ===== LOGOUT =====
  const btnLogout = document.getElementById("btnLogout");
  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      if (admContainer) admContainer.style.display = "none";
      if (loginContainer) loginContainer.style.display = "block";
    });
  }

  // ===== TABS =====
  const tabBtns = Array.from(document.querySelectorAll(".tab-btn"));
  const tabOrdenes = document.getElementById("tabOrdenes");
  const tabGuardia = document.getElementById("tabGuardia");

  function setTab(name) {
    tabBtns.forEach((b) => {
      const is = b.dataset.tab === name;
      b.classList.toggle("is-active", is);
      b.setAttribute("aria-selected", is ? "true" : "false");
    });
    if (tabOrdenes) tabOrdenes.classList.toggle("is-active", name === "ordenes");
    if (tabGuardia) tabGuardia.classList.toggle("is-active", name === "guardia");
  }

  tabBtns.forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  // ======================================================
  // ÓRDENES: DOM
  // ======================================================
  const chkFinalizar = document.getElementById("aFinalizarCheckbox");
  const fechaCaducidadInput = document.getElementById("fechaCaducidad");
  const numOrdenEl = document.getElementById("numOrden");
  const textoRefEl = document.getElementById("textoRef");
  const franjasEl = document.getElementById("franjas");
  const fechaVigenciaEl = document.getElementById("fechaVigencia");
  const selectOrdenExistente = document.getElementById("ordenExistente");
  const btnPublicar = document.getElementById("btnPublicarOrdenes");

  // ======================================================
  // GUARDIA: DOM
  // ======================================================
  const selGuardiaLugar = document.getElementById("guardiaLugar");
  const elGuardiaEstado = document.getElementById("guardiaEstado");
  const elGuardiaFechas = document.getElementById("guardiaFechas");
  const elGuardiaJson = document.getElementById("guardiaJsonPreview");
  const btnGuardiaIngreso = document.getElementById("btnGuardiaIngreso");
  const btnGuardiaRetiro = document.getElementById("btnGuardiaRetiro");

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
  // SELECTOR: ACTUALIZAR LISTA DE ÓRDENES
  // ======================================================
  function actualizarSelectorOrdenes() {
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

  // ======================================================
  // LIMPIAR CAMPOS (ÓRDENES)
  // ======================================================
  function limpiarCamposOrdenes() {
    if (numOrdenEl) numOrdenEl.value = "";
    if (textoRefEl) textoRefEl.value = "";
    if (franjasEl) franjasEl.value = "";
    if (fechaVigenciaEl) fechaVigenciaEl.value = "";
    if (fechaCaducidadInput) fechaCaducidadInput.value = "";
    if (chkFinalizar) chkFinalizar.checked = false;
    ordenSeleccionadaIdx = null;
    if (selectOrdenExistente) selectOrdenExistente.value = "";
  }

  // ======================================================
  // LIMPIAR ÓRDENES CADUCADAS
  // ======================================================
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

    actualizarSelectorOrdenes();
    limpiarCamposOrdenes();
    marcarCambio();

    // refrescar lugares para guardia
    cargarLugaresDesdeOrdenes();

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
        limpiarCamposOrdenes();
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
    });
  }

  // ======================================================
  // ELIMINAR ORDEN (con confirmación)
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
      actualizarSelectorOrdenes();
      limpiarCamposOrdenes();
      return;
    }

    const ok = confirm(`¿Está seguro de eliminar la orden "${o.num}"?`);
    if (!ok) return;

    ordenes.splice(ordenSeleccionadaIdx, 1);
    StorageApp.guardarOrdenes(ordenes);

    ordenSeleccionadaIdx = null;
    limpiarCamposOrdenes();
    actualizarSelectorOrdenes();
    marcarCambio();

    // refrescar lugares para guardia
    cargarLugaresDesdeOrdenes();

    alert("Orden eliminada.");
  }
  window.__adm_eliminarOrden = eliminarOrden;

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

    const { data: { session }, error: sessionErr } = await supabaseClient.auth.getSession();
    if (sessionErr || !session?.access_token) {
      console.error("[ADM] No hay sesión válida:", sessionErr);
      alert("No hay sesión iniciada. Inicie sesión antes de publicar.");
      return;
    }

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/ordenes_store?id=eq.1&select=id,updated_at`, {
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

    const txt = await resp.text();
    console.log("[ADM] PATCH status:", resp.status);
    console.log("[ADM] PATCH body:", txt);

    if (!resp.ok) {
      alert("Error publicando. Mirá Console (F12). Status: " + resp.status);
      return;
    }

    ultimoPublicadoId = cambiosId;
    actualizarEstadoPublicar();
    alert("Órdenes publicadas.");
  }
  window.__adm_publicarOrdenes = publicarOrdenes;

  // ======================================================
  // GUARDIA: LUGARES DESDE ÓRDENES
  // ======================================================
  function normalizarLugarTexto(s) {
    return String(s || "").trim().replace(/\s+/g, " ");
  }

  function cargarLugaresDesdeOrdenes() {
    if (!selGuardiaLugar) return;

    let ordenes = [];
    try {
      ordenes = StorageApp?.cargarOrdenes?.() || [];
    } catch (e) {
      ordenes = [];
    }

    const set = new Set();

    ordenes.forEach((o) => {
      (o?.franjas || []).forEach((f) => {
        const lug = normalizarLugarTexto(f?.lugar);
        if (lug) set.add(lug);
      });
    });

    const lugares = Array.from(set).sort((a, b) => a.localeCompare(b, "es"));

    const actual = selGuardiaLugar.value || "";

    selGuardiaLugar.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Seleccionar lugar";
    selGuardiaLugar.appendChild(opt0);

    lugares.forEach((l) => {
      const op = document.createElement("option");
      op.value = l;
      op.textContent = l;
      selGuardiaLugar.appendChild(op);
    });

    // intentar mantener selección
    if (actual && lugares.includes(actual)) selGuardiaLugar.value = actual;
  }

  // ======================================================
  // GUARDIA: STORAGE EN SUPABASE (tabla guardia_store id=1)
  // ======================================================
  let guardiaActual = null; // { active, lugar, ingreso_ts, retiro_ts, patrullas:[] }

  function renderGuardia() {
    if (!elGuardiaEstado || !btnGuardiaIngreso || !btnGuardiaRetiro || !elGuardiaJson) return;

    const g = guardiaActual;

    if (!g || !g.active) {
      elGuardiaEstado.textContent = "Sin guardia activa";
      if (elGuardiaFechas) elGuardiaFechas.textContent = "";
      btnGuardiaIngreso.disabled = false;
      btnGuardiaRetiro.disabled = true;
      elGuardiaJson.textContent = JSON.stringify(g || {}, null, 2);
      return;
    }

    elGuardiaEstado.textContent = `Guardia activa en: ${g.lugar || "(sin lugar)"}`;

    const inTxt = g.ingreso_ts ? new Date(g.ingreso_ts).toLocaleString("es-AR") : "-";
    const outTxt = g.retiro_ts ? new Date(g.retiro_ts).toLocaleString("es-AR") : "-";
    if (elGuardiaFechas) elGuardiaFechas.textContent = `Ingreso: ${inTxt}  |  Retiro: ${outTxt}`;

    btnGuardiaIngreso.disabled = true;
    btnGuardiaRetiro.disabled = false;

    elGuardiaJson.textContent = JSON.stringify(g, null, 2);
  }

  async function leerGuardiaServidor() {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/guardia_store?select=payload,updated_at&id=eq.1&limit=1`, {
        headers: { apikey: SUPABASE_ANON_KEY, Accept: "application/json" },
      });

      if (!r.ok) {
        console.warn("[ADM] leerGuardiaServidor status:", r.status, await r.text());
        guardiaActual = null;
        renderGuardia();
        return;
      }

      const data = await r.json();
      const payload = data?.[0]?.payload || null;
      guardiaActual = payload;
      renderGuardia();
    } catch (e) {
      console.warn("[ADM] Error leyendo guardia_store:", e);
      guardiaActual = null;
      renderGuardia();
    }
  }

  async function guardarGuardiaServidor(payload) {
    const { data: { session }, error: sessionErr } = await supabaseClient.auth.getSession();
    if (sessionErr || !session?.access_token) {
      alert("No hay sesión iniciada. Inicie sesión antes de guardar Guardia.");
      return false;
    }

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/guardia_store?id=eq.1&select=id,updated_at`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({ payload, updated_at: new Date().toISOString() }),
    });

    const txt = await resp.text();
    console.log("[ADM] Guardia PATCH status:", resp.status);
    console.log("[ADM] Guardia PATCH body:", txt);

    if (!resp.ok) {
      alert("Error guardando Guardia. Mirá Console (F12). Status: " + resp.status);
      return false;
    }

    return true;
  }

  async function ingresoGuardia() {
    const lugar = normalizarLugarTexto(selGuardiaLugar?.value || "");
    if (!lugar) return alert("Seleccioná un lugar para Ingreso.");

    if (guardiaActual?.active) {
      return alert(`Ya hay una guardia activa en: ${guardiaActual.lugar || "(sin lugar)"}`);
    }

    const now = new Date().toISOString();
    const payload = {
      active: true,
      lugar,
      ingreso_ts: now,
      retiro_ts: null,
      patrullas: [], // (próximo paso)
    };

    const ok = await guardarGuardiaServidor(payload);
    if (!ok) return;

    guardiaActual = payload;
    renderGuardia();
    alert("Ingreso de guardia registrado.");
  }

  async function retiroGuardia() {
    if (!guardiaActual?.active) return alert("No hay guardia activa para retirar.");

    const now = new Date().toISOString();
    const payload = {
      ...guardiaActual,
      active: false,
      retiro_ts: now,
    };

    const ok = await guardarGuardiaServidor(payload);
    if (!ok) return;

    guardiaActual = payload;
    renderGuardia();
    alert("Retiro de guardia registrado.");
  }

  if (btnGuardiaIngreso) btnGuardiaIngreso.addEventListener("click", ingresoGuardia);
  if (btnGuardiaRetiro) btnGuardiaRetiro.addEventListener("click", retiroGuardia);

  // ======================================================
  // CONTROL DE SESIÓN + INIT
  // ======================================================
  function initAdm() {
    limpiarOrdenesCaducadas();
    actualizarSelectorOrdenes();
    cambiosId = 0;
    ultimoPublicadoId = 0;
    actualizarEstadoPublicar();

    // Guardia
    cargarLugaresDesdeOrdenes();
    leerGuardiaServidor();
    renderGuardia();
  }

  const { data: { session }, error } = await supabaseClient.auth.getSession();

  if (error || !session) {
    if (loginContainer) loginContainer.style.display = "block";
    if (admContainer) admContainer.style.display = "none";
  } else {
    if (loginContainer) loginContainer.style.display = "none";
    if (admContainer) admContainer.style.display = "block";
    initAdm();
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
      initAdm();
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
      const redirectTo = repoName
        ? `${location.origin}/${repoName}/reset.html`
        : `${location.origin}/reset.html`;

      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });

      if (error) return alert("Error enviando mail: " + error.message);
      alert("Te enviamos un correo para restablecer la contraseña.");
    });
  }
});
