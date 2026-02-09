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
  const map = new Map();
  elementoValues.forEach((val) => {
    const meta = invActivos("elemento").find((x) => x.value === val)?.meta || {};
    const label = getSubgrupoLabel(meta) || "Otros";
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(val);
  });

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
  // ✅ NO contar checkboxes "locked" (usados por la otra patrulla)
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
   ✅ MOVILES (con Libro/TVF por retiro + número a la izquierda)
   Guardado: { movil_id, obs, libro, tvf }
   ====================================================== */

function renderMoviles(container, items, selected = []) {
  if (!container) return;
  container.innerHTML = "";

  // normaliza selected (compat: viejos sin libro/tvf)
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
    // OJO: uso label para click fácil, pero lo “anulo” para que no lo pise tu CSS global de label
    const wrap = document.createElement("label");
    wrap.className = "mov-flag";
    // ✅ fuerza inline (mata display:block y márgenes globales)
    wrap.style.display = "inline-flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "6px";
    wrap.style.margin = "0";
    wrap.style.padding = "0";
    wrap.style.fontWeight = "600";
    wrap.style.cursor = "pointer";
    wrap.style.userSelect = "none";

    const c = document.createElement("input");
    c.type = "checkbox";
    c.checked = !!checked;
    c.disabled = !!disabled;
    c.setAttribute("data-flag", dataFlag);
    c.style.width = "auto";
    c.style.margin = "0";

    const t = document.createElement("span");
    t.textContent = labelTxt;

    wrap.appendChild(c);
    wrap.appendChild(t);
    return wrap;
  }

  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "row-inline";

    // ✅ fuerza layout SIEMPRE: [chk] [NUM] [Libro TVF] [Obs...]
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "10px";
    row.style.flexWrap = "nowrap";

    const id = `mov_${slugifyValue(it.value)}_${Math.random().toString(16).slice(2)}`;

    const saved = selectedMap.get(it.value) || { movil_id: it.value, obs: "", libro: false, tvf: false };
    const isSelected = selectedMap.has(it.value);

    // checkbox principal
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.id = id;
    chk.checked = isSelected;
    chk.setAttribute("data-value", it.value);
    chk.style.width = "auto";
    chk.style.margin = "0";

    // ✅ número/nombre del móvil (SPAN, NO label) para que tu CSS global no lo vuelva block
    const name = document.createElement("span");
    name.className = "movil-name";
    name.textContent = it.label;

    // ✅ forzado: queda pegado al checkbox, sin ocupar el centro
    name.style.display = "inline-flex";
    name.style.alignItems = "center";
    name.style.margin = "0";
    name.style.padding = "0";
    name.style.fontWeight = "800";
    name.style.whiteSpace = "nowrap";
    name.style.flex = "0 0 auto";
    name.style.minWidth = "72px"; // ajustable si querés

    // flags (Libro/TVF) a la derecha del número
    const flags = document.createElement("div");
    flags.className = "mov-flags";
    flags.style.display = "flex";
    flags.style.alignItems = "center";
    flags.style.gap = "10px";
    flags.style.flex = "0 0 auto";

    const flagLibro = mkFlag("Libro", "libro", saved.libro, !chk.checked);
    const flagTvf = mkFlag("TVF", "tvf", saved.tvf, !chk.checked);

    flags.appendChild(flagLibro);
    flags.appendChild(flagTvf);

    // obs a la derecha del todo
    const obs = document.createElement("input");
    obs.type = "text";
    obs.placeholder = "Obs (opcional)";
    obs.className = "mini";
    obs.value = saved.obs || "";
    obs.disabled = !chk.checked;
    obs.style.marginLeft = "auto"; // ✅ empuja Obs al extremo derecho

    const syncEnabled = () => {
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

    row.appendChild(chk);
    row.appendChild(name);
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
    if (chk.getAttribute("data-locked") === "1") return; // ✅ no guardar locks cruzados

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

function getLugaresFromFranjasTextarea() {
  const t = document.getElementById("franjas")?.value || "";
  const out = new Set();

  t.split("\n").forEach((line) => {
    const s = String(line || "").trim();
    if (!s) return;

    let parts = s.split(" - ").map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) {
      parts = s.split("-").map((x) => x.trim()).filter(Boolean);
    }
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


  // ======================================================
  // ✅ BLOQUEO CRUZADO P1 ↔ P2 (LIVE, sin guardar en la no-dueña)
  // - Si P1 usa X => en P2 se ve rojo (checked) y bloqueado
  // - Si P1 destilda X => en P2 se desbloquea automáticamente
  // ======================================================

  function applyCrossLocksLive() {
    const ownedSetFromChips = (container) =>
      new Set(
        Array.from(container?.querySelectorAll('input[type="checkbox"][data-value]') || [])
          .filter((c) => c.checked && c.getAttribute("data-locked") !== "1")
          .map((c) => c.getAttribute("data-value"))
          .filter(Boolean)
      );

    const ownedSetFromMoviles = (container) =>
      new Set(
        Array.from(container?.querySelectorAll('.row-inline input[type="checkbox"][data-value]') || [])
          .filter((c) => c.checked && c.getAttribute("data-locked") !== "1")
          .map((c) => c.getAttribute("data-value"))
          .filter(Boolean)
      );

    const ownedP1Personal = ownedSetFromChips(p1Personal);
    const ownedP2Personal = ownedSetFromChips(p2Personal);

    const ownedP1Elem = ownedSetFromChips(p1Elementos);
    const ownedP2Elem = ownedSetFromChips(p2Elementos);

    const ownedP1Mov = ownedSetFromMoviles(p1Moviles);
    const ownedP2Mov = ownedSetFromMoviles(p2Moviles);

    const lockChips = (dstContainer, lockSet, dstOwnedSet) => {
      if (!dstContainer) return;
      Array.from(dstContainer.querySelectorAll('input[type="checkbox"][data-value]')).forEach((c) => {
        const id = c.getAttribute("data-value");
        const isLocked = c.getAttribute("data-locked") === "1";
        const shouldLock = lockSet.has(id) && !dstOwnedSet.has(id);

        if (shouldLock) {
          c.checked = true;
          c.disabled = true;
          c.setAttribute("data-locked", "1");
        } else if (isLocked && !lockSet.has(id)) {
          c.checked = false;
          c.disabled = false;
          c.removeAttribute("data-locked");
        } else if (isLocked && dstOwnedSet.has(id)) {
          c.disabled = false;
          c.removeAttribute("data-locked");
        }
      });
    };

    const lockMoviles = (dstContainer, lockSet, dstOwnedSet) => {
      if (!dstContainer) return;
      const rows = Array.from(dstContainer.querySelectorAll(".row-inline"));
      rows.forEach((row) => {
        const chk = row.querySelector('input[type="checkbox"][data-value]');
        if (!chk) return;
        const id = chk.getAttribute("data-value");
        const isLocked = chk.getAttribute("data-locked") === "1";
        const shouldLock = lockSet.has(id) && !dstOwnedSet.has(id);

        const flags = row.querySelectorAll('input[type="checkbox"][data-flag]');
        const obs = row.querySelector('input[type="text"]');

        if (shouldLock) {
          chk.checked = true;
          chk.disabled = true;
          chk.setAttribute("data-locked", "1");

          flags.forEach((f) => {
            f.checked = false;
            f.disabled = true;
          });
          if (obs) {
            obs.value = "";
            obs.disabled = true;
          }
        } else if (isLocked && !lockSet.has(id)) {
          chk.checked = false;
          chk.disabled = false;
          chk.removeAttribute("data-locked");

          flags.forEach((f) => (f.disabled = !chk.checked));
          if (obs) obs.disabled = !chk.checked;
        } else if (isLocked && dstOwnedSet.has(id)) {
          chk.disabled = false;
          chk.removeAttribute("data-locked");
          flags.forEach((f) => (f.disabled = !chk.checked));
          if (obs) obs.disabled = !chk.checked;
        }
      });
    };

    lockChips(p2Personal, ownedP1Personal, ownedP2Personal);
    lockChips(p1Personal, ownedP2Personal, ownedP1Personal);

    lockChips(p2Elementos, ownedP1Elem, ownedP2Elem);
    lockChips(p1Elementos, ownedP2Elem, ownedP1Elem);

    lockMoviles(p2Moviles, ownedP1Mov, ownedP2Mov);
    lockMoviles(p1Moviles, ownedP2Mov, ownedP1Mov);
  }

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
    const lugares = getLugaresSmart();
    fillSelectOptions(p1Lugar, lugares, guardiaState?.patrullas?.p1?.lugar || "");
    fillSelectOptions(p2Lugar, lugares, guardiaState?.patrullas?.p2?.lugar || "");

    const pers = invActivos("personal");
    const movs = invActivos("movil");
    const elems = invActivos("elemento");

    const p1 = guardiaState?.patrullas?.p1 || {};
    const p2 = guardiaState?.patrullas?.p2 || {};

    renderChips(p1Personal, pers, p1.personal_ids || []);
    renderChips(p2Personal, pers, p2.personal_ids || []);

    renderMoviles(p1Moviles, movs, p1.moviles || []);
    renderMoviles(p2Moviles, movs, p2.moviles || []);

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

    renderCartuchos(p1Cartuchos, p1.cartuchos_map || {});
    renderCartuchos(p2Cartuchos, p2.cartuchos_map || {});

    aplicarReglaCartuchos(p1Elementos, p1Cartuchos, p1Elems);
    aplicarReglaCartuchos(p2Elementos, p2Cartuchos, p2Elems);

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

  function bindRefrescoPorGuardarOrden() {
    const btnGuardarOrden =
      document.querySelector('button[onclick*="agregarOrden"]') ||
      document.getElementById("btnGuardarOrden") ||
      null;

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
    if (btnGuardiaActualizar) {
      btnGuardiaActualizar.addEventListener("click", () => onActualizarGuardia({ invLoad: null }).catch(console.error));
    }

    bindAccionesEstado();
    bindReglaCartuchosLive();

    // ✅ Live cross-lock: cada cambio en P1/P2 recalcula disponibilidad
    const live = () => applyCrossLocksLive();
    [p1Personal, p2Personal, p1Elementos, p2Elementos, p1Moviles, p2Moviles].forEach((el) => {
      if (!el) return;
      el.addEventListener("change", () => live());
      el.addEventListener("input", () => live());
    });
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
