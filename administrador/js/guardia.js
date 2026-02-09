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
  return Array.from(container.querySelectorAll('input[type="checkbox"][data-value]'))
    .filter((x) => x.checked && x.getAttribute("data-locked") !== "1")
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

/* ======================================================
   ✅ MOVILES (con Libro/TVF por retiro + label a la izquierda)
   Estructura guardada:
   { movil_id, obs, libro, tvf }
   ====================================================== */

function renderMoviles(container, items, selected = [], lockedMap = new Map()) {
  if (!container) return;
  container.innerHTML = "";

  // selectedMap: lo que está elegido EN ESTA patrulla
  const selectedMap = new Map(
    (Array.isArray(selected) ? selected : []).map((x) => [
      x?.movil_id,
      {
        movil_id: x?.movil_id,
        obs: (x?.obs || "").trim(),
        libro: !!x?.libro,
        tvf: !!x?.tvf,
      },
    ])
  );

  function mkFlag(labelTxt, dataFlag, checked, disabled) {
    const wrap = document.createElement("label");
    wrap.className = "mov-flag";

    const c = document.createElement("input");
    c.type = "checkbox";
    c.checked = !!checked;
    c.disabled = !!disabled;
    c.setAttribute("data-flag", dataFlag);

    const t = document.createElement("span");
    t.textContent = labelTxt;

    wrap.appendChild(c);
    wrap.appendChild(t);
    return wrap;
  }

  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "row-inline";

    const id = `mov_${slugifyValue(it.value)}_${Math.random().toString(16).slice(2)}`;

    const own = selectedMap.get(it.value) || { movil_id: it.value, obs: "", libro: false, tvf: false };
    const locked = lockedMap.get(it.value) || null;

    // si está bloqueado por otra patrulla, lo mostramos "tildado rojo" y no editable
    const isLockedByOther = !!locked && !selectedMap.has(it.value);
    const effective = isLockedByOther ? locked : own;
    const isSelected = selectedMap.has(it.value) || isLockedByOther;

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.id = id;
    chk.checked = isSelected;
    chk.setAttribute("data-value", it.value);

    if (isLockedByOther) {
      chk.disabled = true;
      chk.setAttribute("data-locked", "1");
      row.classList.add("is-locked");
    }

    const name = document.createElement("label");
    name.setAttribute("for", id);
    name.className = "movil-name";
    name.textContent = it.label;

    const flags = document.createElement("div");
    flags.className = "mov-flags";

    const flagLibro = mkFlag("Libro", "libro", effective.libro, !chk.checked || isLockedByOther);
    const flagTvf = mkFlag("TVF", "tvf", effective.tvf, !chk.checked || isLockedByOther);

    flags.appendChild(flagLibro);
    flags.appendChild(flagTvf);

    const obs = document.createElement("input");
    obs.type = "text";
    obs.placeholder = "Obs (opcional)";
    obs.className = "mini";
    obs.value = effective.obs || "";
    obs.disabled = !chk.checked || isLockedByOther;

    const syncEnabled = () => {
      if (isLockedByOther) return; // nunca habilitar

      const enabled = chk.checked;
      obs.disabled = !enabled;
      if (!enabled) obs.value = "";

      flags.querySelectorAll('input[type="checkbox"][data-flag]').forEach((c) => {
        c.disabled = !enabled;
        if (!enabled) c.checked = false;
      });
    };

    chk.addEventListener("change", syncEnabled);
    syncEnabled();

    // ✅ UI: el texto/número del móvil va a la IZQUIERDA del tilde principal
    // Orden visual: [NOMBRE] [chk] [Libro/TVF] [Obs]
    row.appendChild(name);
    row.appendChild(chk);
    row.appendChild(flags);
    row.appendChild(obs);

    container.appendChild(row);
  });
}

function readMoviles(container) {
  if (!container) return [];
  const rows = Array.from(container.querySelectorAll(".row-inline"));
  const out = [];

  rows.forEach((row) => {
    const chk = row.querySelector('input[type="checkbox"][data-value]');
    if (!chk?.checked) return;
    // ✅ si es bloqueo por otra patrulla, NO lo contamos para esta
    if (chk.getAttribute("data-locked") === "1") return;

    const movil_id = chk.getAttribute("data-value");

    const obs = row.querySelector('input[type="text"]');
    const libro = row.querySelector('input[type="checkbox"][data-flag="libro"]');
    const tvf = row.querySelector('input[type="checkbox"][data-flag="tvf"]');

    out.push({
      movil_id,
      obs: (obs?.value || "").trim(),
      libro: !!libro?.checked,
      tvf: !!tvf?.checked,
    });
  });

  return out;
}

// ======================================================
// BLOQUEO CRUZADO (P1 vs P2) - Personal / Elementos / Moviles
// ======================================================

function buildOwnerMapFromArrays(p1Arr = [], p2Arr = []) {
  const owner = new Map();
  (Array.isArray(p1Arr) ? p1Arr : []).forEach((v) => owner.set(String(v), "p1"));
  (Array.isArray(p2Arr) ? p2Arr : []).forEach((v) => {
    const k = String(v);
    if (!owner.has(k)) owner.set(k, "p2");
  });
  return owner;
}

function applyChipLocks(container, ownerMap, myKey) {
  if (!container) return;

  const inputs = Array.from(container.querySelectorAll('input[type="checkbox"][data-value]'));
  inputs.forEach((chk) => {
    const v = chk.getAttribute("data-value");
    const owner = ownerMap.get(String(v));

    // reset default
    chk.removeAttribute("data-locked");
    chk.disabled = false;
    chk.closest(".chip")?.classList.remove("is-locked");

    if (owner && owner !== myKey) {
      // bloqueado por otra patrulla:
      // - se ve rojo (checked)
      // - no se puede tocar
      chk.checked = true;
      chk.disabled = true;
      chk.setAttribute("data-locked", "1");
      chk.closest(".chip")?.classList.add("is-locked");
    }
  });
}

function buildLockedMovilMap(otherMoviles = []) {
  const m = new Map();
  (Array.isArray(otherMoviles) ? otherMoviles : []).forEach((x) => {
    if (!x?.movil_id) return;
    m.set(String(x.movil_id), {
      movil_id: String(x.movil_id),
      obs: (x?.obs || "").trim(),
      libro: !!x?.libro,
      tvf: !!x?.tvf,
    });
  });
  return m;
}

function aplicarReglaCartuchos(elementosContainer, cartuchosContainer, precomputedElementosIds = null) {
  if (!elementosContainer || !cartuchosContainer) return;

  const elementosIds = precomputedElementosIds || readCheckedValues(elementosContainer);
  const hayEscopeta = elementosIds.some((id) => {
    const label = invLabelFromValue("elemento", id).toLowerCase();
    return label.includes("escopeta");
  });

  cartuchosContainer.style.display = hayEscopeta ? "block" : "none";
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
  Array.from(container.querySelectorAll('input[type="checkbox"][data-key]')).forEach((c) => {
    map[c.getAttribute("data-key")] = c.checked;
  });
  return map;
}

function getLugaresFromFranjasTextarea() {
  const t = document.getElementById("franjas")?.value || "";
  const out = new Set();

  t.split("\n").forEach((line) => {
    const s = String(line || "").trim();
    if (!s) return;

    let parts = s.split(" - ").map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) parts = s.split("-").map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) return;

    const lugar = normalizarLugar(parts[1]);
    if (lugar) out.add(lugar);
  });

  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

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

function tryGetOrdenesFromStorageApp() {
  try {
    const sa = window.storageApp;
    if (sa) {
      if (typeof sa.getOrdenes === "function") return sa.getOrdenes() || [];
      if (typeof sa.listOrdenes === "function") return sa.listOrdenes() || [];
      if (typeof sa.getAllOrdenes === "function") return sa.getAllOrdenes() || [];
      if (Array.isArray(sa.ordenes)) return sa.ordenes || [];
    }

    const keys = ["ordenes_operacionales", "ordenesOperacionales", "ordenes", "orders", "ordenes_storage"];
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.ordenes)) return parsed.ordenes;
      if (Array.isArray(parsed?.items)) return parsed.items;
    }

    return [];
  } catch {
    return [];
  }
}

function extractLugaresFromOrdenesArray(ords) {
  const out = new Set();

  (Array.isArray(ords) ? ords : []).forEach((o) => {
    const franjas = Array.isArray(o?.franjas) ? o.franjas : [];
    franjas.forEach((f) => {
      const l = normalizarLugar(f?.lugar || "");
      if (l) out.add(l);
    });

    const franjasTxt = String(o?.franjasTexto || o?.franjas_texto || "").trim();
    if (franjasTxt) {
      franjasTxt.split("\n").forEach((line) => {
        const s = line.trim();
        if (!s) return;

        let parts = s.split(" - ").map((x) => x.trim()).filter(Boolean);
        if (parts.length < 2) parts = s.split("-").map((x) => x.trim()).filter(Boolean);
        if (parts.length < 2) return;

        const lugar = normalizarLugar(parts[1]);
        if (lugar) out.add(lugar);
      });
    }
  });

  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function getLugaresSmart() {
  const fromState = getLugaresFromOrdenes();
  if (fromState.length) return fromState;

  const ordsStored = tryGetOrdenesFromStorageApp();
  const fromStored = extractLugaresFromOrdenesArray(ordsStored);
  if (fromStored.length) return fromStored;

  const fromFranjas = getLugaresFromFranjasTextarea();
  if (fromFranjas.length) return fromFranjas;

  return [];
}

export function initGuardia({ sb, subtabs } = {}) {
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
    selectEl.innerHTML = `<option value="">Seleccionar</option>` + opts.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("");
    if (val) selectEl.value = val;
  }

  function renderGuardiaDesdeInventario() {
    // Lugares
    const lugares = getLugaresSmart();
    fillSelectOptions(p1Lugar, lugares, guardiaState?.patrullas?.p1?.lugar || "");
    fillSelectOptions(p2Lugar, lugares, guardiaState?.patrullas?.p2?.lugar || "");

    // Inventario
    const pers = invActivos("personal");
    const movs = invActivos("movil");
    const elems = invActivos("elemento");

    // Estado actual
    const p1 = guardiaState?.patrullas?.p1 || {};
    const p2 = guardiaState?.patrullas?.p2 || {};

    // ✅ Render base (según lo que usa cada patrulla)
    renderChips(p1Personal, pers, p1.personal_ids || []);
    renderChips(p2Personal, pers, p2.personal_ids || []);

    // ✅ Moviles con flags
    const p1LockedMov = buildLockedMovilMap(p2.moviles || []);
    const p2LockedMov = buildLockedMovilMap(p1.moviles || []);
    renderMoviles(p1Moviles, movs, p1.moviles || [], p1LockedMov);
    renderMoviles(p2Moviles, movs, p2.moviles || [], p2LockedMov);

    // Elementos agrupados
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

    // Cartuchos
    renderCartuchos(p1Cartuchos, p1.cartuchos_map || {});
    renderCartuchos(p2Cartuchos, p2.cartuchos_map || {});
    aplicarReglaCartuchos(p1Elementos, p1Cartuchos, p1Elems);
    aplicarReglaCartuchos(p2Elementos, p2Cartuchos, p2Elems);

    // Obs
    if (p1Obs) p1Obs.value = p1.obs || "";
    if (p2Obs) p2Obs.value = p2.obs || "";

    // ==================================================
    // ✅ BLOQUEO CRUZADO (lo último del render)
    // - Personal: si lo usa una patrulla, queda rojo + bloqueado en la otra
    // - Elementos: idem
    // - Moviles: ya se bloquean en renderMoviles con lockedMap
    // ==================================================
    const personalOwner = buildOwnerMapFromArrays(p1.personal_ids || [], p2.personal_ids || []);
    applyChipLocks(p1Personal, personalOwner, "p1");
    applyChipLocks(p2Personal, personalOwner, "p2");

    const elementosOwner = buildOwnerMapFromArrays(p1Elems, p2Elems);
    applyChipLocks(p1Elementos, elementosOwner, "p1");
    applyChipLocks(p2Elementos, elementosOwner, "p2");
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

  function bindRefrescoPorGuardarOrden() {
    const btnGuardarOrden = document.querySelector('button[onclick*="agregarOrden"]') || document.getElementById("btnGuardarOrden") || null;

    if (btnGuardarOrden) {
      btnGuardarOrden.addEventListener("click", () => {
        setTimeout(() => {
          refreshLugares();
          renderGuardiaPreview();
          setEstado("Lugares actualizados (guardar orden)");
        }, 50);
      });
    }

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

    const franjasEl = document.getElementById("franjas");
    if (franjasEl) {
      franjasEl.addEventListener("input", () => {
        refreshLugares();
      });
    }
  }

  function bind() {
    if (btnGuardiaGuardar) btnGuardiaGuardar.addEventListener("click", () => onGuardarGuardia().catch(console.error));
    if (btnGuardiaActualizar) btnGuardiaActualizar.addEventListener("click", () => onActualizarGuardia({ invLoad: null }).catch(console.error));

    bindAccionesEstado();
    bindReglaCartuchosLive();
    bindRefrescoPorGuardarOrden();

    subscribeInventario(() => {
      renderGuardiaDesdeInventario();
      renderGuardiaPreview();
    });
  }

  async function init({ invLoad } = {}) {
    try {
      if (subtabs?.boot) subtabs.boot();
    } catch {}

    await onActualizarGuardia({ invLoad });
    renderGuardiaDesdeInventario();
    renderGuardiaPreview();
    setEstado("OK");
  }

  return { bind, init, refreshLugares };
}
