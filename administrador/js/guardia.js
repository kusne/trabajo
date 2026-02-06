import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { esc, slugifyValue, normalizarLugar, cloneDeep, isoNow, hhmmArNow } from "./utils.js";
import { getSessionOrNull, patchOrInsertStore } from "./supabaseClient.js";
import { state, setGuardiaState, subscribeInventario } from "./state.js";
import { invActivos, invLabelFromValue } from "./inventario.js";

// ======================================================
// GUARDIA (guardia_estado.id=1)
// ======================================================

// SUBGRUPOS (CANON + ORDEN FIJO)
const SUBGRUPO_CANON = [
  { key: "alometros", label: "Alometros" },
  { key: "alcoholimetros", label: "Alcoholimetros" },
  { key: "pdas", label: "PDAs" },
  { key: "impresoras", label: "Impresoras" },
  { key: "ht", label: "Ht" },
  { key: "escopetas", label: "Escopetas" },
  { key: "cartuchos", label: "Cartuchos" },
];

const SUBGRUPO_KEY_TO_LABEL = new Map(SUBGRUPO_CANON.map((x) => [x.key, x.label]));
const SUBGRUPOS_ORDEN = SUBGRUPO_CANON.map((x) => x.label);

function normalizeKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[áàäâ]/g, "a")
    .replace(/[éèëê]/g, "e")
    .replace(/[íìïî]/g, "i")
    .replace(/[óòöô]/g, "o")
    .replace(/[úùüû]/g, "u")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getSubgrupoLabel(meta) {
  const raw = meta?.subgrupo || meta?.subGroup || meta?.grupo || meta?.group || "";
  const k = normalizeKey(raw);
  if (SUBGRUPO_KEY_TO_LABEL.has(k)) return SUBGRUPO_KEY_TO_LABEL.get(k);
  return raw ? String(raw).trim() : "";
}

function groupElementosBySubgrupo(elementoValues = []) {
  // agrupa por subgrupo canonical
  const map = new Map();
  elementoValues.forEach((val) => {
    const meta = invActivos("elemento").find((x) => x.value === val)?.meta || {};
    const label = getSubgrupoLabel(meta) || "Otros";
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(val);
  });

  // orden por SUBGRUPOS_ORDEN (lo que no está, al final)
  const keys = Array.from(map.keys());
  keys.sort((a, b) => {
    const ia = SUBGRUPOS_ORDEN.indexOf(a);
    const ib = SUBGRUPOS_ORDEN.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const ordered = [];
  keys.forEach((k) => ordered.push([k, map.get(k)]));
  return ordered;
}

function readCheckedValues(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll("input[type=checkbox][data-value]"))
    .filter((x) => x.checked)
    .map((x) => x.getAttribute("data-value"))
    .filter(Boolean);
}

function renderChips(container, items, checkedValues = []) {
  if (!container) return;
  container.innerHTML = "";
  items.forEach((it) => {
    const id = `chk_${slugifyValue(it.value)}_${Math.random().toString(16).slice(2)}`;
    const wrap = document.createElement("label");
    wrap.className = "chip";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.id = id;
    chk.setAttribute("data-value", it.value);
    chk.checked = checkedValues.includes(it.value);

    const span = document.createElement("span");
    span.textContent = it.label;

    wrap.appendChild(chk);
    wrap.appendChild(span);
    container.appendChild(wrap);
  });
}

function renderMoviles(container, items, selected = []) {
  if (!container) return;
  container.innerHTML = "";

  // un móvil seleccionado = { movil_id, obs }
  const selectedIds = new Set(selected.map((x) => x.movil_id));

  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "row-inline";

    const id = `mov_${slugifyValue(it.value)}_${Math.random().toString(16).slice(2)}`;

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.id = id;
    chk.checked = selectedIds.has(it.value);
    chk.setAttribute("data-value", it.value);

    const label = document.createElement("label");
    label.setAttribute("for", id);
    label.textContent = it.label;

    const obs = document.createElement("input");
    obs.type = "text";
    obs.placeholder = "Obs (opcional)";
    obs.className = "mini";
    const found = selected.find((x) => x.movil_id === it.value);
    obs.value = found?.obs || "";
    obs.disabled = !chk.checked;

    chk.addEventListener("change", () => {
      obs.disabled = !chk.checked;
      if (!chk.checked) obs.value = "";
    });

    row.appendChild(chk);
    row.appendChild(label);
    row.appendChild(obs);

    container.appendChild(row);
  });
}

function readMoviles(container) {
  if (!container) return [];
  const rows = Array.from(container.querySelectorAll(".row-inline"));
  const out = [];
  rows.forEach((row) => {
    const chk = row.querySelector("input[type=checkbox][data-value]");
    const obs = row.querySelector("input[type=text]");
    if (chk?.checked) {
      out.push({ movil_id: chk.getAttribute("data-value"), obs: (obs?.value || "").trim() });
    }
  });
  return out;
}

function aplicarReglaCartuchos(elementosContainer, cartuchosContainer, precomputedElementosIds = null) {
  if (!elementosContainer || !cartuchosContainer) return;

  // Si hay escopetas seleccionadas => habilitar cartuchos
  const elementosIds = precomputedElementosIds || readCheckedValues(elementosContainer);
  const hayEscopeta = elementosIds.some((id) => {
    const label = invLabelFromValue("elemento", id).toLowerCase();
    return label.includes("escopeta");
  });

  cartuchosContainer.style.display = hayEscopeta ? "block" : "none";
  // si no hay escopeta, desmarcar todo
  if (!hayEscopeta) {
    cartuchosContainer.querySelectorAll("input[type=checkbox]").forEach((c) => (c.checked = false));
  }
}

function renderCartuchos(container, checkedMap = {}) {
  if (!container) return;
  container.innerHTML = "";

  const tipos = [
    { key: "posta", label: "Posta" },
    { key: "antitumulto", label: "Antitumulto" },
    { key: "goma", label: "Goma" },
  ];

  tipos.forEach((t) => {
    const id = `cart_${t.key}_${Math.random().toString(16).slice(2)}`;
    const wrap = document.createElement("label");
    wrap.className = "chip";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.id = id;
    chk.setAttribute("data-key", t.key);
    chk.checked = Boolean(checkedMap?.[t.key]);

    const span = document.createElement("span");
    span.textContent = t.label;

    wrap.appendChild(chk);
    wrap.appendChild(span);
    container.appendChild(wrap);
  });
}

function readCartuchos(container) {
  if (!container) return {};
  const map = {};
  Array.from(container.querySelectorAll("input[type=checkbox][data-key]")).forEach((c) => {
    map[c.getAttribute("data-key")] = c.checked;
  });
  return map;
}

function formatLogEntry(e) {
  const ts = e?.hora || "";
  const p = e?.patrulla || "";
  const a = e?.accion || "";
  const r = e?.resumen || "";
  return `${ts} ${p} ${a}: ${r}`;
}

/**
 * ✅ NUEVO: parser de lugares desde el textarea #franjas (Órdenes)
 * Acepta líneas tipo:
 * "07 a 11 hs - RN168 km18 - Control vehicular"
 * y variantes con guiones.
 */
function getLugaresFromFranjasTextarea() {
  const t = document.getElementById("franjas")?.value || "";
  const out = new Set();

  t.split("\n").forEach((line) => {
    const s = String(line || "").trim();
    if (!s) return;

    // Intento 1: separador " - "
    let parts = s.split(" - ").map((x) => x.trim()).filter(Boolean);

    // Intento 2: si no hay " - ", probamos con "-"
    if (parts.length < 2) {
      parts = s.split("-").map((x) => x.trim()).filter(Boolean);
    }

    if (parts.length < 2) return;

    // Formato: HORARIO - LUGAR - TITULO => lugar en índice 1
    const lugar = normalizarLugar(parts[1]);
    if (lugar) out.add(lugar);
  });

  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

/**
 * Lugares desde state.ordenes (si existen)
 */
function getLugaresFromOrdenes() {
  const out = new Set();
  const ords = Array.isArray(state?.ordenes) ? state.ordenes : [];
  ords.forEach((o) => {
    const franjas = Array.isArray(o?.franjas) ? o.franjas : [];
    franjas.forEach((f) => {
      const l = normalizarLugar(f?.lugar || "");
      if (l) out.add(l);
    });
  });
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

/**
 * ✅ NUEVO: lugares SMART
 * 1) usa state.ordenes si tiene data
 * 2) si no, usa #franjas
 */
function getLugaresSmart() {
  const fromState = getLugaresFromOrdenes();
  if (fromState.length) return fromState;

  const fromFranjas = getLugaresFromFranjasTextarea();
  if (fromFranjas.length) return fromFranjas;

  return [];
}

export function initGuardia({ sb, subtabs } = {}) {
  // ===== DOM refs (tolerantes) =====
  const elEstadoTxt = () => document.getElementById("guardiaEstadoTxt");
  const elPreview = () => document.getElementById("guardiaJsonPreview");

  const btnGuardiaGuardar = document.getElementById("btnGuardiaGuardar");
  const btnGuardiaActualizar = document.getElementById("btnGuardiaActualizar");

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

  let guardiaState = state?.guardia || null;

  function setEstado(s) {
    const el = elEstadoTxt();
    if (el) el.textContent = s || "";
  }

  function renderGuardiaPreview() {
    const pre = elPreview();
    if (pre) pre.textContent = JSON.stringify(guardiaState || {}, null, 2);
  }

  function fillSelectOptions(selectEl, opts, currentVal = "") {
    if (!selectEl) return;
    const val = currentVal || "";
    selectEl.innerHTML =
      `<option value="">Seleccionar</option>` +
      opts.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("");
    if (val) selectEl.value = val;
  }

  function renderGuardiaDesdeInventario() {
    // ✅ Lugares SMART (state.ordenes o fallback #franjas)
    const lugares = getLugaresSmart();
    fillSelectOptions(p1Lugar, lugares, guardiaState?.patrullas?.p1?.lugar || "");
    fillSelectOptions(p2Lugar, lugares, guardiaState?.patrullas?.p2?.lugar || "");

    // Inventario activo
    const pers = invActivos("personal");
    const movs = invActivos("movil");
    const elems = invActivos("elemento");

    // Estado actual
    const p1 = guardiaState?.patrullas?.p1 || {};
    const p2 = guardiaState?.patrullas?.p2 || {};

    renderChips(p1Personal, pers, p1.personal_ids || []);
    renderChips(p2Personal, pers, p2.personal_ids || []);

    renderMoviles(p1Moviles, movs, p1.moviles || []);
    renderMoviles(p2Moviles, movs, p2.moviles || []);

    // Elementos con agrupación y orden fijo
    const p1Elems = p1.elementos_ids || [];
    const p2Elems = p2.elementos_ids || [];

    const groups1 = groupElementosBySubgrupo(elems.map((x) => x.value));
    const groups2 = groups1;

    const renderElementosGrouped = (container, checked, groups) => {
      if (!container) return;
      container.innerHTML = "";
      groups.forEach(([label, vals]) => {
        const h = document.createElement("div");
        h.className = "subhead";
        h.textContent = label;
        container.appendChild(h);

        const row = document.createElement("div");
        row.className = "chip-grid";

        const items = vals.map((v) => {
          const it = elems.find((x) => x.value === v);
          return it || { label: v, value: v };
        });
        renderChips(row, items, checked);
        container.appendChild(row);
      });
    };

    renderElementosGrouped(p1Elementos, p1Elems, groups1);
    renderElementosGrouped(p2Elementos, p2Elems, groups2);

    // Cartuchos (visible si hay escopeta)
    renderCartuchos(p1Cartuchos, p1.cartuchos_map || {});
    renderCartuchos(p2Cartuchos, p2.cartuchos_map || {});

    aplicarReglaCartuchos(p1Elementos, p1Cartuchos, p1Elems);
    aplicarReglaCartuchos(p2Elementos, p2Cartuchos, p2Elems);

    // Obs
    if (p1Obs) p1Obs.value = p1.obs || "";
    if (p2Obs) p2Obs.value = p2.obs || "";
  }

  function aplicarStateAGuardiaUI() {
    guardiaState = state?.guardia || guardiaState || null;
    renderGuardiaDesdeInventario();
    renderGuardiaPreview();

    const logLen = Array.isArray(guardiaState?.log) ? guardiaState.log.length : 0;
    setEstado(logLen ? `OK · Logs: ${logLen}` : "OK");
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

    const next = cloneDeep(guardiaState || {});
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
    const session = await getSessionOrNull(sb);
    if (!session) return null;

    const url = `${SUPABASE_URL}/rest/v1/guardia_estado?id=eq.1&select=payload`;
    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + session.access_token,
        Accept: "application/json",
      },
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    const payload = data?.[0]?.payload;
    return payload && typeof payload === "object" ? payload : null;
  }

  async function guardarGuardiaEnServidor(nextPayload) {
    const session = await getSessionOrNull(sb);
    if (!session) {
      alert("No hay sesión activa. Volvé a iniciar sesión.");
      return false;
    }

    const res = await patchOrInsertStore({ table: "guardia_estado", payload: nextPayload, session });
    if (!res.ok) {
      console.error("[ADMIN] Error guardando guardia_estado:", res.status, res.text);
      alert("Error guardando Guardia. Mirá Console (F12).");
      return false;
    }

    setGuardiaState(nextPayload);
    guardiaState = nextPayload;
    renderGuardiaPreview();
    return true;
  }

  async function onGuardarGuardia() {
    const next = buildStateFromUI();
    await guardarGuardiaEnServidor(next);
    aplicarStateAGuardiaUI();
  }

  async function onActualizarGuardia({ invLoad } = {}) {
    const payload = await cargarGuardiaDesdeServidor();
    if (payload) setGuardiaState(payload);
    guardiaState = state?.guardia || payload || guardiaState;
    renderGuardiaDesdeInventario();
    renderGuardiaPreview();
    setEstado(payload ? "Actualizado" : "Sin datos");

    if (typeof invLoad === "function") {
      try {
        await invLoad();
      } catch {}
    }
  }

  function refreshLugares() {
    renderGuardiaDesdeInventario();
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
        next.log.unshift({
          patrulla: String(p).toUpperCase(),
          accion,
          hora,
          ts,
          resumen,
          snapshot: {
            lugar: pat.lugar || "",
            obs: pat.obs || "",
            personal_ids: Array.isArray(pat.personal_ids) ? [...pat.personal_ids] : [],
            moviles: Array.isArray(pat.moviles) ? cloneDeep(pat.moviles) : [],
            elementos_ids: Array.isArray(pat.elementos_ids) ? [...pat.elementos_ids] : [],
            cartuchos_map: pat.cartuchos_map ? cloneDeep(pat.cartuchos_map) : {},
          },
        });

        await guardarGuardiaEnServidor(next);
        aplicarStateAGuardiaUI();
      });
    });
  }

  function bindReglaCartuchosLive() {
    const hook = (elContainer, cartContainer) => {
      if (!elContainer || !cartContainer) return;
      elContainer.addEventListener("change", () => aplicarReglaCartuchos(elContainer, cartContainer));
    };
    hook(p1Elementos, p1Cartuchos);
    hook(p2Elementos, p2Cartuchos);
  }

  /**
   * ✅ NUEVO: refrescar lugares cuando se GUARDA una orden (botón guardar órdenes)
   * - Caso 1: botón con onclick="agregarOrden()"
   * - Caso 2: hook al wrapper global window.agregarOrden (sin romper nada)
   */
  function bindRefrescoPorGuardarOrden() {
    // 1) listener directo al botón (si existe)
    const btnGuardarOrden =
      document.querySelector('button[onclick*="agregarOrden"]') ||
      document.getElementById("btnGuardarOrden") ||
      null;

    if (btnGuardarOrden) {
      btnGuardarOrden.addEventListener("click", () => {
        // esperamos un toque por si el código de órdenes toca el textarea/estado
        setTimeout(() => {
          refreshLugares();
          renderGuardiaPreview();
          setEstado("Lugares actualizados (guardar orden)");
        }, 50);
      });
    }

    // 2) hook al global agregarOrden (si existe y no está hookeado)
    if (typeof window !== "undefined" && typeof window.agregarOrden === "function") {
      if (!window.__guardia_hook_agregarOrden) {
        window.__guardia_hook_agregarOrden = true;

        const original = window.agregarOrden;
        window.agregarOrden = function (...args) {
          const ret = original.apply(this, args);

          setTimeout(() => {
            refreshLugares();
            renderGuardiaPreview();
            setEstado("Lugares actualizados (guardar orden)");
          }, 50);

          return ret;
        };
      }
    }

    // 3) si el usuario edita franjas, también refrescamos
    const franjasEl = document.getElementById("franjas");
    if (franjasEl) {
      franjasEl.addEventListener("input", () => {
        refreshLugares();
      });
    }
  }

  function bind() {
    if (btnGuardiaGuardar) btnGuardiaGuardar.addEventListener("click", () => onGuardarGuardia().catch(console.error));
    if (btnGuardiaActualizar) {
      btnGuardiaActualizar.addEventListener("click", () => onActualizarGuardia({ invLoad: null }).catch(console.error));
    }

    bindAccionesEstado();
    bindReglaCartuchosLive();

    // ✅ Nuevo: refresco automático al guardar una orden
    bindRefrescoPorGuardarOrden();

    // Re-render UI cuando cambia inventario
    subscribeInventario(() => {
      renderGuardiaDesdeInventario();
      renderGuardiaPreview();
    });
  }

  async function init({ invLoad } = {}) {
    // Subtabs (si están presentes)
    try {
      if (subtabs?.boot) subtabs.boot();
    } catch {}

    // cargar guardia y pintar UI
    await onActualizarGuardia({ invLoad });
    renderGuardiaDesdeInventario();
    renderGuardiaPreview();
    setEstado("OK");
  }

  return { bind, init, refreshLugares };
}
