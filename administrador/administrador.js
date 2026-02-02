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

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
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

// Hora local AR (UTC-3) como HH:MM
function hhmmArNow() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function isoNow() {
  return new Date().toISOString();
}

async function getSessionOrNull() {
  const { data: { session }, error } = await supabaseClient.auth.getSession();
  if (error || !session?.access_token) return null;
  return session;
}

// PATCH id=1; si no existe, intentamos INSERT id=1
async function patchOrInsertStore({ table, payload, session }) {
  const urlPatch = `${SUPABASE_URL}/rest/v1/${table}?id=eq.1`;
  const body = JSON.stringify({ payload, updated_at: isoNow() });

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

  if (!resp.ok) {
    const txt = await resp.text();
    const maybeMissingRow =
      resp.status === 404 ||
      resp.status === 406 ||
      /0 rows/i.test(txt) ||
      /not found/i.test(txt);

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
        body: JSON.stringify([{ id: 1, payload, updated_at: isoNow() }]),
      });
    } else {
      return { ok: false, status: resp.status, text: txt };
    }
  }

  if (!resp.ok) {
    const txt2 = await resp.text();
    return { ok: false, status: resp.status, text: txt2 };
  }

  let data = null;
  try { data = await resp.json(); } catch { }
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

  // ======================================================
  // SUBSOLAPAS GUARDIA: Patrulla 1 / Patrulla 2 (REPARADO)
  // ======================================================
  const SubtabsPatrullas = (() => {
    let bound = false;
    let active = "p1";

    let btns = [];
    let panelP1 = null;
    let panelP2 = null;

    function scope() {
      return document.getElementById("tab-guardia") || document;
    }

    function refreshRefs() {
      const sc = scope();
      btns = Array.from(sc.querySelectorAll('.subtab-btn[data-subtab]'));
      panelP1 = document.getElementById("patrulla-p1");
      panelP2 = document.getElementById("patrulla-p2");
    }

    function sanitizeButtons() {
      // Asegura que P1 y P2 no estén disabled por accidente.
      btns.forEach((b) => {
        const k = b.getAttribute("data-subtab");
        if (k === "p1" || k === "p2") {
          b.disabled = false;
          b.removeAttribute("disabled");
          b.style.pointerEvents = "auto";
        }
        // p3 queda como venga desde HTML (generalmente disabled)
      });
    }

    function forceDisplay(el, show) {
      if (!el) return;

      el.classList.toggle("is-active", !!show);
      el.setAttribute("aria-hidden", show ? "false" : "true");

      // CLAVE: pisar inline/CSS con !important
      el.style.setProperty("display", show ? "block" : "none", "important");
    }

    function setActive(key, { save = true } = {}) {
      const k = (key === "p2") ? "p2" : "p1";
      active = k;

      btns.forEach((b) => {
        const isOn = b.getAttribute("data-subtab") === k;
        b.classList.toggle("is-active", isOn);
        b.setAttribute("aria-selected", isOn ? "true" : "false");
      });

      forceDisplay(panelP1, k === "p1");
      forceDisplay(panelP2, k === "p2");

      if (save) {
        try { localStorage.setItem("adm_patrulla_activa", k); } catch { }
      }
    }

    function ensureBound() {
      refreshRefs();

      if (!btns.length || (!panelP1 && !panelP2)) return;

      sanitizeButtons();

      if (!bound) {
        btns.forEach((b) => {
          b.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const k = b.getAttribute("data-subtab");
            setActive(k, { save: true });

            // re-aplica 1 frame después para evitar “ambos visibles”
            requestAnimationFrame(() => setActive(k, { save: false }));
          }, { passive: false });
        });
        bound = true;
      }

      // restaurar selección
      let last = "p1";
      try { last = localStorage.getItem("adm_patrulla_activa") || "p1"; } catch { }
      setActive(last, { save: false });

      // blindaje extra
      requestAnimationFrame(() => setActive(last, { save: false }));
    }

    function apply() {
      refreshRefs();
      if (!btns.length || (!panelP1 && !panelP2)) return;
      sanitizeButtons();
      setActive(active, { save: false });
      requestAnimationFrame(() => setActive(active, { save: false }));
    }

    function getActive() { return active; }

    return { ensureBound, apply, setActive, getActive };
  })();

  // ===== TABS =====
  const tabBtns = Array.from(document.querySelectorAll(".tab-btn"));
  const tabPanels = {
    ordenes: document.getElementById("tab-ordenes"),
    guardia: document.getElementById("tab-guardia"),
    inventario: document.getElementById("tab-inventario"),
  };

  function activarTab(nombre) {
    tabBtns.forEach((b) => b.classList.toggle("is-active", b.dataset.tab === nombre));
    Object.keys(tabPanels).forEach((k) => tabPanels[k]?.classList.toggle("is-active", k === nombre));

    // cuando entro a Guardia, aplico sí o sí subsolapas (y re-aplico 1 frame después)
    if (nombre === "guardia") {
      SubtabsPatrullas.ensureBound();
      SubtabsPatrullas.apply();
      requestAnimationFrame(() => SubtabsPatrullas.apply());
    }
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
  // ÓRDENES (sin tocar lógica actual)
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

    // lugares para Guardia
    cargarLugaresParaGuardia();

    alert("Orden guardada.");
  }

  window.__adm_agregarOrden = agregarOrden;

  if (typeof CaducidadFinalizar !== "undefined" && typeof CaducidadFinalizar.bindAFinalizar === "function") {
    CaducidadFinalizar.bindAFinalizar({
      checkboxEl: chkFinalizar,
      inputEl: fechaCaducidadInput,
    });
  }

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

      cargarLugaresParaGuardia();
    });
  }

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

    cargarLugaresParaGuardia();
    alert("Orden eliminada.");
  }

  window.eliminarOrden = eliminarOrden;

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
      body: JSON.stringify({ payload: payloadPublicar, updated_at: isoNow() }),
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
  // INVENTARIO (inventario_base) - tab Inventario
  // ======================================================
  const invTipo = document.getElementById("invTipo");
  const invLabel = document.getElementById("invLabel");
  const invValue = document.getElementById("invValue");
  const invOrden = document.getElementById("invOrden");
  const invSubgrupo = document.getElementById("invSubgrupo");
  const invMetaExtra = document.getElementById("invMetaExtra");
  const btnInvAgregar = document.getElementById("btnInvAgregar");
  const btnInvRefrescar = document.getElementById("btnInvRefrescar");
  const invLista = document.getElementById("invLista");
  const invEstado = document.getElementById("invEstado");

  let inventario = []; // [{id,tipo,label,value,orden,activo,meta}]

  function invActivos(tipo) {
    return inventario
      .filter((x) => x.tipo === tipo && x.activo)
      .sort((a, b) => (a.orden - b.orden) || a.label.localeCompare(b.label, "es"));
  }

  function invLabelFromValue(tipo, value) {
    const r = inventario.find((x) => x.tipo === tipo && x.value === value);
    return r ? r.label : value;
  }

  function safeParseJson(input) {
    const s = String(input || "").trim();
    if (!s) return null;
    try { return JSON.parse(s); } catch { return "__INVALID__"; }
  }

  async function invLoad() {
    if (invEstado) invEstado.textContent = "Cargando inventario…";

    const { data, error } = await supabaseClient
      .from("inventario_base")
      .select("id,tipo,label,value,orden,activo,meta")
      .order("tipo", { ascending: true })
      .order("orden", { ascending: true })
      .order("label", { ascending: true });

    if (error) {
      console.error("[ADM] inventario_base load error:", error);
      if (invEstado) invEstado.textContent = "Error cargando inventario (mirá Console).";
      inventario = [];
      renderInventarioLista();
      renderGuardiaDesdeInventario();
      return false;
    }

    inventario = Array.isArray(data) ? data : [];
    if (invEstado) invEstado.textContent = `Inventario: ${inventario.length} ítems`;
    renderInventarioLista();
    renderGuardiaDesdeInventario();
    return true;
  }

  async function invInsert() {
    const tipo = (invTipo?.value || "personal").trim();
    const label = (invLabel?.value || "").trim();
    let value = (invValue?.value || "").trim();
    const orden = Number(invOrden?.value || 0);

    if (!label) return alert("Label: obligatorio.");
    if (!value) value = slugifyValue(label);

    const meta = {};

    if (tipo === "elemento") {
      const sg = (invSubgrupo?.value || "").trim();
      if (sg) meta.subgrupo = sg;
    }

    const extra = safeParseJson(invMetaExtra?.value || "");
    if (extra === "__INVALID__") return alert("Meta extra inválido (JSON).");
    if (extra && typeof extra === "object" && !Array.isArray(extra)) Object.assign(meta, extra);

    const payload = {
      tipo,
      label,
      value,
      orden: isNaN(orden) ? 0 : orden,
      activo: true,
      meta: Object.keys(meta).length ? meta : null,
    };

    const { error } = await supabaseClient.from("inventario_base").insert([payload]);

    if (error) {
      console.error("[ADM] inventario_base insert error:", error);
      alert("Error agregando inventario. Mirá Console (F12).\n\nDetalle: " + (error.message || ""));
      return;
    }

    if (invLabel) invLabel.value = "";
    if (invValue) invValue.value = "";
    if (invOrden) invOrden.value = "0";
    if (invSubgrupo) invSubgrupo.value = "";
    if (invMetaExtra) invMetaExtra.value = "";

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

    const nMetaStr = prompt("Editar meta (JSON) — vacío para null:", item.meta ? JSON.stringify(item.meta) : "");
    if (nMetaStr === null) return;
    const parsed = safeParseJson(nMetaStr);
    if (parsed === "__INVALID__") return alert("Meta inválido (JSON).");

    const { error } = await supabaseClient
      .from("inventario_base")
      .update({ label: nLabel.trim(), value: nValue.trim(), orden: nOrden, meta: parsed || null })
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
      invLista.innerHTML = `<div class="muted">Sin ítems.</div>`;
      return;
    }

    invLista.innerHTML = rows.map((it) => {
      const badge = it.activo ? "ACTIVO" : "INACTIVO";
      const metaTxt = it.meta ? esc(JSON.stringify(it.meta)) : "—";
      return `
        <div style="border:1px solid #ddd; border-radius:10px; padding:10px; margin:8px 0; background:#fff;">
          <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
            <div>
              <div style="font-weight:700;">${esc(it.tipo)} — ${esc(it.label)} <span class="muted">(${esc(it.value)})</span></div>
              <div class="muted">Orden: ${esc(it.orden)} — Estado: ${badge}</div>
              <div class="muted">Meta: ${metaTxt}</div>
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
  // GUARDIA (guardia_estado.id=1)
  // ======================================================
  const guardiaEstadoTxt = document.getElementById("guardiaEstadoTxt");
  const btnGuardiaGuardar = document.getElementById("btnGuardiaGuardar");
  const btnGuardiaActualizar = document.getElementById("btnGuardiaActualizar");
  const preGuardia = document.getElementById("guardiaJsonPreview");

  const p1Lugar = document.getElementById("p1Lugar");
  const p1Obs = document.getElementById("p1Obs");
  const p1Personal = document.getElementById("p1Personal");
  const p1Moviles = document.getElementById("p1Moviles");
  const p1Elementos = document.getElementById("p1Elementos");
  const p1Cartuchos = document.getElementById("p1Cartuchos");

  const p2Lugar = document.getElementById("p2Lugar");
  const p2Obs = document.getElementById("p2Obs");
  const p2Personal = document.getElementById("p2Personal");
  const p2Moviles = document.getElementById("p2Moviles");
  const p2Elementos = document.getElementById("p2Elementos");
  const p2Cartuchos = document.getElementById("p2Cartuchos");

  // ======================================================
  // SUBGRUPOS (CANON + ORDEN FIJO)
  // ======================================================
  const SUBGRUPO_CANON = [
    { key: "alometros", label: "Alometros" },
    { key: "alcoholimetros", label: "Alcoholimetros" },
    { key: "pdas", label: "PDAs" },
    { key: "impresoras", label: "Impresoras" },
    { key: "ht", label: "Ht" },
    { key: "escopetas", label: "Escopetas" },
    { key: "cartuchos", label: "Cartuchos" },
  ];

  const SUBGRUPO_KEY_TO_LABEL = new Map(SUBGRUPO_CANON.map(x => [x.key, x.label]));
  const SUBGRUPOS_ORDEN = SUBGRUPO_CANON.map(x => x.label);

  function normalizeKey(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[áàäâ]/g, "a")
      .replace(/[éèëê]/g, "e")
      .replace(/[íìïî]/g, "i")
      .replace(/[óòöô]/g, "o")
      .replace(/[úùüû]/g, "u")
      .replace(/ñ/g, "n")
      .replace(/[^a-z0-9]+/g, "");
  }

  function canonSubgrupo(raw) {
    const k = normalizeKey(raw);
    if (!k) return "SinSubgrupo";

    if (k === "pda" || k === "pdas") return "PDAs";
    if (k === "alometro" || k === "alometros") return "Alometros";
    if (k === "alcoholimetro" || k === "alcoholimetros") return "Alcoholimetros";
    if (k === "impresora" || k === "impresoras") return "Impresoras";
    if (k === "ht" || k === "handy" || k === "handytalkie" || k === "handywalkie") return "Ht";
    if (k === "escopeta" || k === "escopetas") return "Escopetas";
    if (k === "cartucho" || k === "cartuchos") return "Cartuchos";

    if (SUBGRUPO_KEY_TO_LABEL.has(k)) return SUBGRUPO_KEY_TO_LABEL.get(k);

    const cleaned = String(raw || "").trim();
    return cleaned || "SinSubgrupo";
  }

  function isSubgrupo(item, labelCanon) {
    const sg = canonSubgrupo(item?.meta?.subgrupo);
    return sg === labelCanon;
  }

  let guardiaState = {
    version: 1,
    patrullas: {
      p1: { lugar: "", obs: "", estado: "", estado_ts: "", personal_ids: [], moviles: [], elementos_ids: [], cartuchos: { at: 0, pg: 0 } },
      p2: { lugar: "", obs: "", estado: "", estado_ts: "", personal_ids: [], moviles: [], elementos_ids: [], cartuchos: { at: 0, pg: 0 } },
    },
    log: [],
    updated_at_ts: "",
  };

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

  function fillLugarSelect(selectEl) {
    if (!selectEl) return;
    const lugares = lugaresDesdeOrdenes();
    const actual = selectEl.value || "";
    selectEl.innerHTML = `<option value="">Seleccionar lugar</option>`;
    lugares.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l;
      opt.textContent = l;
      selectEl.appendChild(opt);
    });
    if (actual && lugares.includes(actual)) selectEl.value = actual;
  }

  function cargarLugaresParaGuardia() {
    fillLugarSelect(p1Lugar);
    fillLugarSelect(p2Lugar);
  }

  function chipsCheckbox(container, items, { prefix }) {
    if (!container) return;
    if (!items.length) {
      container.innerHTML = `<div class="muted">Sin datos.</div>`;
      return;
    }

    container.innerHTML = items.map((it, idx) => {
      const id = `${prefix}_${idx}`;
      return `
        <label class="checkbox-container" style="display:flex; align-items:center; gap:8px; border:1px solid #ddd; padding:6px 10px; border-radius:999px;">
          <input type="checkbox" id="${esc(id)}" value="${esc(it.value)}">
          <span>${esc(it.label)}</span>
        </label>
      `;
    }).join("");
  }

  function renderMoviles(container, moviles, { prefix }) {
    if (!container) return;
    if (!moviles.length) {
      container.innerHTML = `<div class="muted">Sin móviles activos.</div>`;
      return;
    }

    container.innerHTML = moviles.map((m, idx) => {
      const baseId = `${prefix}_mov_${idx}`;
      return `
        <div style="display:flex; align-items:center; gap:10px; border:1px solid #ddd; border-radius:12px; padding:8px 10px; margin:6px 0; background:#fff;">
          <label style="display:flex; align-items:center; gap:8px; min-width:180px;">
            <input type="checkbox" data-movil-pick="1" data-movil-id="${esc(m.value)}" id="${esc(baseId)}">
            <span style="font-weight:700;">${esc(m.label)}</span>
          </label>

          <label class="muted" style="display:flex; align-items:center; gap:6px;">
            <input type="checkbox" data-movil-flag="libro" data-movil-id="${esc(m.value)}" disabled>
            libro
          </label>

          <label class="muted" style="display:flex; align-items:center; gap:6px;">
            <input type="checkbox" data-movil-flag="llave" data-movil-id="${esc(m.value)}" disabled>
            llave
          </label>

          <label class="muted" style="display:flex; align-items:center; gap:6px;">
            <input type="checkbox" data-movil-flag="tvf" data-movil-id="${esc(m.value)}" disabled>
            tvf
          </label>
        </div>
      `;
    }).join("");

    container.querySelectorAll('input[data-movil-pick="1"]').forEach((chk) => {
      chk.addEventListener("change", () => {
        const movilId = chk.getAttribute("data-movil-id");
        const enabled = chk.checked;
        const flags = container.querySelectorAll(`input[data-movil-flag][data-movil-id="${CSS.escape(movilId)}"]`);
        flags.forEach((f) => {
          f.disabled = !enabled;
          if (!enabled) f.checked = false;
        });
      });
    });
  }

  // ======================================================
  // ELEMENTOS: AGRUPAR POR meta.subgrupo (CANON) + TÍTULOS
  // ======================================================
  function groupElementos(elementosActivos) {
    const groups = new Map();

    (elementosActivos || []).forEach((e) => {
      const sgCanon = canonSubgrupo(e?.meta?.subgrupo);
      if (!groups.has(sgCanon)) groups.set(sgCanon, []);
      groups.get(sgCanon).push(e);
    });

    for (const [k, arr] of groups.entries()) {
      arr.sort((a, b) => (a.orden - b.orden) || String(a.label).localeCompare(String(b.label), "es"));
      groups.set(k, arr);
    }

    const ordered = [];
    SUBGRUPOS_ORDEN.forEach((sg) => {
      if (groups.has(sg)) ordered.push([sg, groups.get(sg)]);
    });

    Array.from(groups.keys())
      .filter((k) => !SUBGRUPOS_ORDEN.includes(k))
      .sort((a, b) => a.localeCompare(b, "es"))
      .forEach((k) => ordered.push([k, groups.get(k)]));

    return ordered;
  }

  function renderElementos(container, elementosActivos, { prefix }) {
    if (!container) return;
    if (!elementosActivos.length) {
      container.innerHTML = `<div class="muted">Sin elementos activos.</div>`;
      return;
    }

    const grouped = groupElementos(elementosActivos);

    container.innerHTML = grouped.map(([sg, items]) => {
      const listId = `${prefix}_sg_${slugifyValue(sg)}`;
      return `
        <div style="border:1px solid #e5e5e5; border-radius:14px; padding:10px; margin:10px 0; background:#fff;">
          <div style="font-weight:800; margin-bottom:8px;">${esc(sg)}</div>
          <div id="${esc(listId)}" style="display:flex; flex-wrap:wrap; gap:8px;"></div>
        </div>
      `;
    }).join("");

    grouped.forEach(([sg, items]) => {
      const listId = `${prefix}_sg_${slugifyValue(sg)}`;
      const holder = container.querySelector(`#${CSS.escape(listId)}`);
      if (!holder) return;
      chipsCheckbox(holder, items, { prefix: `${listId}_it` });
    });
  }

  function renderCartuchos(container, cartuchosItems, { prefix }) {
    if (!container) return;
    if (!cartuchosItems.length) {
      container.innerHTML = `<div class="muted">Sin cartuchos en inventario.</div>`;
      return;
    }

    container.innerHTML = cartuchosItems.map((c, idx) => {
      const id = `${prefix}_car_${idx}`;
      const tipo = String(c?.meta?.cartucho_tipo || "").toUpperCase();
      return `
        <div style="display:flex; align-items:center; gap:10px; border:1px solid #ddd; border-radius:12px; padding:8px 10px; margin:6px 0; background:#fff;">
          <label style="display:flex; align-items:center; gap:8px; min-width:260px;">
            <input type="checkbox" data-cartucho-pick="1" data-cartucho-id="${esc(c.value)}" id="${esc(id)}">
            <span style="font-weight:700;">${esc(c.label)}</span>
            <span class="muted">${tipo ? "(" + esc(tipo) + ")" : ""}</span>
          </label>

          <div style="width:140px;">
            <input type="number" min="0" step="1" class="full"
              data-cartucho-qty="1" data-cartucho-id="${esc(c.value)}" disabled
              placeholder="cantidad">
          </div>
        </div>
      `;
    }).join("");

    container.querySelectorAll('input[data-cartucho-pick="1"]').forEach((chk) => {
      chk.addEventListener("change", () => {
        const id = chk.getAttribute("data-cartucho-id");
        const qty = container.querySelector(`input[data-cartucho-qty="1"][data-cartucho-id="${CSS.escape(id)}"]`);
        if (!qty) return;
        qty.disabled = !chk.checked;
        if (!chk.checked) qty.value = "";
      });
    });
  }

  function renderGuardiaDesdeInventario() {
    const personal = invActivos("personal");
    const moviles = invActivos("movil");
    const elementos = invActivos("elemento");

    chipsCheckbox(p1Personal, personal, { prefix: "p1_per" });
    chipsCheckbox(p2Personal, personal, { prefix: "p2_per" });

    renderMoviles(p1Moviles, moviles, { prefix: "p1" });
    renderMoviles(p2Moviles, moviles, { prefix: "p2" });

    const elementosNoCart = elementos.filter((e) => !isSubgrupo(e, "Cartuchos"));
    renderElementos(p1Elementos, elementosNoCart, { prefix: "p1_el" });
    renderElementos(p2Elementos, elementosNoCart, { prefix: "p2_el" });

    const cartuchos = elementos.filter((e) => isSubgrupo(e, "Cartuchos"));
    renderCartuchos(p1Cartuchos, cartuchos, { prefix: "p1" });
    renderCartuchos(p2Cartuchos, cartuchos, { prefix: "p2" });

    aplicarStateAGuardiaUI();

    // Re-aplicar subsolapa activa
    SubtabsPatrullas.apply();
  }

  function readCheckedValues(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]'))
      .filter((x) => x.checked && x.value)
      .map((x) => x.value);
  }

  function readMoviles(container) {
    if (!container) return [];

    const picks = Array.from(container.querySelectorAll('input[data-movil-pick="1"]'));
    const out = [];

    picks.forEach((p) => {
      if (!p.checked) return;
      const movil_id = p.getAttribute("data-movil-id");

      const libro = !!container.querySelector(`input[data-movil-flag="libro"][data-movil-id="${CSS.escape(movil_id)}"]`)?.checked;
      const llave = !!container.querySelector(`input[data-movil-flag="llave"][data-movil-id="${CSS.escape(movil_id)}"]`)?.checked;
      const tvf = !!container.querySelector(`input[data-movil-flag="tvf"][data-movil-id="${CSS.escape(movil_id)}"]`)?.checked;

      out.push({ movil_id, libro, llave, tvf });
    });

    return out;
  }

  function readCartuchos(container) {
    if (!container) return {};
    const picks = Array.from(container.querySelectorAll('input[data-cartucho-pick="1"]'));
    const out = {};
    picks.forEach((p) => {
      if (!p.checked) return;
      const id = p.getAttribute("data-cartucho-id");
      const qtyEl = container.querySelector(`input[data-cartucho-qty="1"][data-cartucho-id="${CSS.escape(id)}"]`);
      const qty = Number(qtyEl?.value || 0);
      out[id] = isNaN(qty) ? 0 : qty;
    });
    return out;
  }

  function patrullaTieneEscopeta(elementos_ids) {
    const escopetas = invActivos("elemento").filter((e) => isSubgrupo(e, "Escopetas"));
    const escIds = new Set(escopetas.map((x) => x.value));
    return (elementos_ids || []).some((id) => escIds.has(id));
  }

  function aplicarStateAGuardiaUI() {
    const p1 = guardiaState?.patrullas?.p1 || {};
    const p2 = guardiaState?.patrullas?.p2 || {};

    if (p1Lugar) p1Lugar.value = p1.lugar || "";
    if (p1Obs) p1Obs.value = p1.obs || "";
    if (p2Lugar) p2Lugar.value = p2.lugar || "";
    if (p2Obs) p2Obs.value = p2.obs || "";

    (p1Personal?.querySelectorAll('input[type="checkbox"]') || []).forEach((x) => {
      x.checked = Array.isArray(p1.personal_ids) && p1.personal_ids.includes(x.value);
    });
    (p2Personal?.querySelectorAll('input[type="checkbox"]') || []).forEach((x) => {
      x.checked = Array.isArray(p2.personal_ids) && p2.personal_ids.includes(x.value);
    });

    function applyMov(container, movArr) {
      if (!container) return;
      const byId = new Map((movArr || []).map((m) => [String(m.movil_id), m]));
      container.querySelectorAll('input[data-movil-pick="1"]').forEach((chk) => {
        const id = chk.getAttribute("data-movil-id");
        const m = byId.get(String(id));
        chk.checked = !!m;

        chk.dispatchEvent(new Event("change"));

        if (m) {
          const libro = container.querySelector(`input[data-movil-flag="libro"][data-movil-id="${CSS.escape(id)}"]`);
          const llave = container.querySelector(`input[data-movil-flag="llave"][data-movil-id="${CSS.escape(id)}"]`);
          const tvf = container.querySelector(`input[data-movil-flag="tvf"][data-movil-id="${CSS.escape(id)}"]`);
          if (libro) libro.checked = !!m.libro;
          if (llave) llave.checked = !!m.llave;
          if (tvf) tvf.checked = !!m.tvf;
        }
      });
    }

    applyMov(p1Moviles, p1.moviles);
    applyMov(p2Moviles, p2.moviles);

    function applyElems(container, ids) {
      if (!container) return;
      container.querySelectorAll('input[type="checkbox"]').forEach((chk) => {
        if (!chk.value) return;
        chk.checked = Array.isArray(ids) && ids.includes(chk.value);
      });
    }

    applyElems(p1Elementos, p1.elementos_ids);
    applyElems(p2Elementos, p2.elementos_ids);

    function applyCart(container, map) {
      if (!container) return;
      const m = map || {};
      container.querySelectorAll('input[data-cartucho-pick="1"]').forEach((chk) => {
        const id = chk.getAttribute("data-cartucho-id");
        const qtyEl = container.querySelector(`input[data-cartucho-qty="1"][data-cartucho-id="${CSS.escape(id)}"]`);
        const has = Object.prototype.hasOwnProperty.call(m, id);
        chk.checked = has;
        chk.dispatchEvent(new Event("change"));
        if (qtyEl && has) qtyEl.value = String(m[id] ?? 0);
      });
    }

    applyCart(p1Cartuchos, p1.cartuchos_map);
    applyCart(p2Cartuchos, p2.cartuchos_map);

    aplicarReglaCartuchos(p1Elementos, p1Cartuchos, p1.elementos_ids);
    aplicarReglaCartuchos(p2Elementos, p2Cartuchos, p2.elementos_ids);

    renderGuardiaPreview();

    SubtabsPatrullas.apply();
  }

  function aplicarReglaCartuchos(elContainer, cartContainer, elementos_ids_override) {
    if (!cartContainer) return;

    const elementos_ids =
      Array.isArray(elementos_ids_override)
        ? elementos_ids_override
        : readCheckedValues(elContainer);

    const hayEscopeta = patrullaTieneEscopeta(elementos_ids);

    cartContainer.querySelectorAll('input[data-cartucho-pick="1"]').forEach((chk) => {
      chk.disabled = !hayEscopeta;
      if (!hayEscopeta) chk.checked = false;
    });
    cartContainer.querySelectorAll('input[data-cartucho-qty="1"]').forEach((inp) => {
      inp.disabled = true;
      if (!hayEscopeta) inp.value = "";
    });

    if (hayEscopeta) {
      cartContainer.querySelectorAll('input[data-cartucho-pick="1"]').forEach((chk) => {
        chk.disabled = false;
        chk.dispatchEvent(new Event("change"));
      });
    }
  }

  function renderGuardiaPreview() {
    if (preGuardia) preGuardia.textContent = JSON.stringify(guardiaState || {}, null, 2);
    if (guardiaEstadoTxt) guardiaEstadoTxt.textContent = `Última actualización: ${guardiaState.updated_at_ts || "—"}`;
  }

  function buildStateFromUI() {
    const p1PersonalIds = readCheckedValues(p1Personal);
    const p2PersonalIds = readCheckedValues(p2Personal);

    const p1Mov = readMoviles(p1Moviles);
    const p2Mov = readMoviles(p2Moviles);

    const p1Elem = readCheckedValues(p1Elementos);
    const p2Elem = readCheckedValues(p2Elementos);

    aplicarReglaCartuchos(p1Elementos, p1Cartuchos, p1Elem);
    aplicarReglaCartuchos(p2Elementos, p2Cartuchos, p2Elem);

    const p1CartMap = readCartuchos(p1Cartuchos);
    const p2CartMap = readCartuchos(p2Cartuchos);

    const next = structuredClone(guardiaState || {});
    next.version = 1;
    next.updated_at_ts = isoNow();

    next.patrullas = next.patrullas || {};
    next.patrullas.p1 = next.patrullas.p1 || {};
    next.patrullas.p2 = next.patrullas.p2 || {};

    next.patrullas.p1.lugar = normalizarLugar(p1Lugar?.value || "");
    next.patrullas.p1.obs = (p1Obs?.value || "").trim();
    next.patrullas.p1.personal_ids = p1PersonalIds;
    next.patrullas.p1.moviles = p1Mov;
    next.patrullas.p1.elementos_ids = p1Elem;
    next.patrullas.p1.cartuchos_map = p1CartMap;

    next.patrullas.p2.lugar = normalizarLugar(p2Lugar?.value || "");
    next.patrullas.p2.obs = (p2Obs?.value || "").trim();
    next.patrullas.p2.personal_ids = p2PersonalIds;
    next.patrullas.p2.moviles = p2Mov;
    next.patrullas.p2.elementos_ids = p2Elem;
    next.patrullas.p2.cartuchos_map = p2CartMap;

    return next;
  }

  async function cargarGuardiaDesdeServidor() {
    const session = await getSessionOrNull();
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Accept: "application/json",
    };
    if (session?.access_token) headers.Authorization = "Bearer " + session.access_token;

    const r = await fetch(`${SUPABASE_URL}/rest/v1/guardia_estado?select=payload&id=eq.1&limit=1`, { headers });

    if (!r.ok) {
      const txt = await r.text();
      console.warn("[ADM] No se pudo leer guardia_estado:", r.status, txt);
      renderGuardiaPreview();
      return;
    }

    const data = await r.json();
    const payload = data?.[0]?.payload || null;

    if (payload && typeof payload === "object") {
      guardiaState = payload;
      guardiaState.version = guardiaState.version || 1;
      guardiaState.patrullas = guardiaState.patrullas || {
        p1: { lugar: "", obs: "", estado: "", estado_ts: "", personal_ids: [], moviles: [], elementos_ids: [], cartuchos: {} },
        p2: { lugar: "", obs: "", estado: "", estado_ts: "", personal_ids: [], moviles: [], elementos_ids: [], cartuchos: {} },
      };
      guardiaState.log = Array.isArray(guardiaState.log) ? guardiaState.log : [];
      guardiaState.updated_at_ts = guardiaState.updated_at_ts || "";
    }

    aplicarStateAGuardiaUI();
  }

  async function guardarGuardiaEnServidor(nextPayload) {
    const session = await getSessionOrNull();
    if (!session) {
      alert("No hay sesión iniciada. Inicie sesión antes de guardar Guardia.");
      return false;
    }

    const res = await patchOrInsertStore({ table: "guardia_estado", payload: nextPayload, session });
    if (!res.ok) {
      console.error("[ADM] Error guardando guardia_estado:", res.status, res.text);
      alert("Error guardando Guardia. Mirá Console (F12). Status: " + res.status);
      return false;
    }

    const p = res.data?.[0]?.payload ?? res.data?.payload ?? null;
    guardiaState = p && typeof p === "object" ? p : nextPayload;

    renderGuardiaPreview();
    return true;
  }

  async function onGuardarGuardia() {
    const next = buildStateFromUI();
    const ok = await guardarGuardiaEnServidor(next);
    if (ok) alert("Guardia guardada (defaults publicados).");
  }

  async function onActualizarGuardia() {
    await invLoad();
    cargarLugaresParaGuardia();
    await cargarGuardiaDesdeServidor();

    SubtabsPatrullas.apply();
  }

  function bindAccionesEstado() {
    document.querySelectorAll("[data-accion][data-p]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const accion = btn.getAttribute("data-accion");
        const p = btn.getAttribute("data-p");
        if (!accion || !p) return;

        const next = buildStateFromUI();

        const ts = isoNow();
        const hora = hhmmArNow();

        next.patrullas[p] = next.patrullas[p] || {};
        next.patrullas[p].estado = accion;
        next.patrullas[p].estado_ts = ts;

        const pat = next.patrullas[p];
        const perTxt = (pat.personal_ids || []).map((id) => invLabelFromValue("personal", id)).join(", ");
        const movTxt = (pat.moviles || []).map((m) => invLabelFromValue("movil", m.movil_id)).join(", ");
        const elemTxt = (pat.elementos_ids || []).map((id) => invLabelFromValue("elemento", id)).join(", ");

        const resumen = `Personal: ${perTxt || "-"} | Movil(es): ${movTxt || "-"} | Elementos: ${elemTxt || "-"}`;

        next.log = Array.isArray(next.log) ? next.log : [];
        next.log.unshift({ patrulla: p.toUpperCase(), accion, hora, ts, resumen });

        await guardarGuardiaEnServidor(next);
        aplicarStateAGuardiaUI();
      });
    });
  }

  if (btnGuardiaGuardar) btnGuardiaGuardar.addEventListener("click", () => onGuardarGuardia().catch(console.error));
  if (btnGuardiaActualizar) btnGuardiaActualizar.addEventListener("click", () => onActualizarGuardia().catch(console.error));

  function bindReglaCartuchosLive() {
    const hook = (elContainer, cartContainer) => {
      if (!elContainer || !cartContainer) return;
      elContainer.addEventListener("change", () => aplicarReglaCartuchos(elContainer, cartContainer));
    };
    hook(p1Elementos, p1Cartuchos);
    hook(p2Elementos, p2Cartuchos);
  }

  // ======================================================
  // INIT
  // ======================================================
  async function initAdm() {
    limpiarOrdenesCaducadas();
    actualizarSelector();
    cambiosId = 0;
    ultimoPublicadoId = 0;
    actualizarEstadoPublicar();

    cargarLugaresParaGuardia();

    // Subsolapas: bind una sola vez si existen
    SubtabsPatrullas.ensureBound();

    await invLoad();
    await cargarGuardiaDesdeServidor();

    bindAccionesEstado();
    bindReglaCartuchosLive();

    renderGuardiaPreview();

    // aplicar visibilidad final
    SubtabsPatrullas.apply();
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
