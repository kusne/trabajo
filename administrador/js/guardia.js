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
  { key: "ht", label: "Ht" }, // ✅ arriba de Escopetas
  { key: "escopetas", label: "Escopetas" },
  { key: "cartuchos", label: "Cartuchos" }, // sección propia (con cantidades)
];

const SUBGRUPO_KEY_TO_LABEL = new Map(SUBGRUPO_CANON.map((x) => [x.key, x.label]));
const SUBGRUPOS_ORDEN = SUBGRUPO_CANON.map((x) => x.label);

// Escopetas exigidas (2)
const ESCOPETAS_NUMS = ["650368", "650367"];

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

function groupElementosBySubgrupo(elementoValues = [], elemsMeta = []) {
  const map = new Map();
  elementoValues.forEach((val) => {
    const meta = elemsMeta.find((x) => x.value === val)?.meta || {};
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
   + Bloqueo cruzado (igual regla que el resto)
   ====================================================== */

function renderMoviles(container, items, selected = []) {
  if (!container) return;
  container.innerHTML = "";

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
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "10px";
    row.style.flexWrap = "nowrap";

    const id = `mov_${slugifyValue(it.value)}_${Math.random().toString(16).slice(2)}`;

    const saved = selectedMap.get(it.value) || { movil_id: it.value, obs: "", libro: false, tvf: false };
    const isSelected = selectedMap.has(it.value);

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.id = id;
    chk.checked = isSelected;
    chk.setAttribute("data-value", it.value);
    chk.style.width = "auto";
    chk.style.margin = "0";

    const name = document.createElement("span");
    name.className = "movil-name";
    name.textContent = it.label;
    name.style.display = "inline-flex";
    name.style.alignItems = "center";
    name.style.margin = "0";
    name.style.padding = "0";
    name.style.fontWeight = "800";
    name.style.whiteSpace = "nowrap";
    name.style.flex = "0 0 auto";
    name.style.minWidth = "72px";

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

    const obs = document.createElement("input");
    obs.type = "text";
    obs.placeholder = "Obs (opcional)";
    obs.className = "mini";
    obs.value = saved.obs || "";
    obs.disabled = !chk.checked;
    obs.style.marginLeft = "auto";

    const syncEnabled = () => {
      const enabled = chk.checked && chk.getAttribute("data-locked") !== "1";

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
    if (chk.getAttribute("data-locked") === "1") return; // ✅ no contar lock forzado

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
// CARTUCHOS (con inputs numerales)
// ======================================================

function aplicarReglaCartuchos(elementosContainer, cartuchosContainer, precomputedElementosIds = null) {
  if (!elementosContainer || !cartuchosContainer) return;

  const elementosIds = precomputedElementosIds || readCheckedValues(elementosContainer);
  const hayEscopeta = elementosIds.some((id) => {
    const label = invLabelFromValue("elemento", id).toLowerCase();
    return label.includes("650368") || label.includes("650367") || label.includes("escopeta");
  });

  cartuchosContainer.style.display = hayEscopeta ? "block" : "none";

  if (!hayEscopeta) {
    cartuchosContainer.querySelectorAll('input[type="checkbox"][data-key]').forEach((c) => (c.checked = false));
    cartuchosContainer.querySelectorAll('input[type="number"][data-key]').forEach((n) => (n.value = "0"));
  }
}

function renderCartuchos(container, saved = {}) {
  if (!container) return;
  container.innerHTML = "";

  const cartuchos_map = saved?.cartuchos_map && typeof saved.cartuchos_map === "object" ? saved.cartuchos_map : {};
  const cartuchos_qty_map =
    saved?.cartuchos_qty_map && typeof saved.cartuchos_qty_map === "object" ? saved.cartuchos_qty_map : {};

  const tipos = [
    { key: "at_12_70", label: "AT cal 12/70" },
    { key: "pg_12_70", label: "PG cal 12/70" },
  ];

  tipos.forEach((t) => {
    const id = `cart_${t.key}_${Math.random().toString(16).slice(2)}`;

    const wrap = document.createElement("div");
    wrap.className = "cart-row";

    const chip = document.createElement("label");
    chip.className = "chip";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.id = id;
    chk.setAttribute("data-key", t.key);
    chk.checked = !!cartuchos_map?.[t.key];

    const span = document.createElement("span");
    span.textContent = t.label;

    chip.appendChild(chk);
    chip.appendChild(span);

    const qty = document.createElement("input");
    qty.type = "number";
    qty.min = "0";
    qty.step = "1";
    qty.placeholder = "Cant.";
    qty.className = "cart-qty";
    qty.setAttribute("data-key", t.key);

    const qtyVal = Math.max(0, parseInt(cartuchos_qty_map?.[t.key], 10) || 0);
    qty.value = String(qtyVal);
    qty.disabled = !chk.checked;

    chk.addEventListener("change", () => {
      qty.disabled = !chk.checked;
      if (!chk.checked) qty.value = "0";
    });

    wrap.appendChild(chip);
    wrap.appendChild(qty);
    container.appendChild(wrap);
  });
}

function readCartuchos(container) {
  if (!container) return { cartuchos_map: {}, cartuchos_qty_map: {} };

  const cartuchos_map = {};
  const cartuchos_qty_map = {};

  const rows = Array.from(container.querySelectorAll(".cart-row"));
  rows.forEach((row) => {
    const chk = row.querySelector('input[type="checkbox"][data-key]');
    const qty = row.querySelector('input[type="number"][data-key]');
    const key = chk?.getAttribute("data-key") || qty?.getAttribute("data-key");
    if (!key) return;

    const on = !!chk?.checked;
    cartuchos_map[key] = on;

    if (on) {
      const num = Math.max(0, parseInt(String(qty?.value ?? "0"), 10) || 0);
      cartuchos_qty_map[key] = num;
    }
  });

  return { cartuchos_map, cartuchos_qty_map };
}

// ======================================================
// BLOQUEO CRUZADO (P1 <-> P2) - Personal / Moviles / Elementos
// Regla:
// - Si P1 usa un recurso, en P2 queda ROJO+TILDADO+BLOQUEADO
// - Si P1 destilda, en P2 queda DISPONIBLE (sin tilde)
// (y viceversa)
// Importante: el “bloqueo visual” NO se guarda para la patrulla “no dueña”.
// ======================================================

function applyChipLocks(container, mySelectedSet, otherSelectedSet) {
  if (!container) return;

  const inputs = Array.from(container.querySelectorAll('input[type="checkbox"][data-value]'));
  inputs.forEach((chk) => {
    const v = chk.getAttribute("data-value");
    const isMine = mySelectedSet.has(String(v));
    const lockedByOther = otherSelectedSet.has(String(v)) && !isMine;

    const chip = chk.closest(".chip");
    if (lockedByOther) {
      chk.checked = true; // rojo/tildado
      chk.disabled = true;
      chk.setAttribute("data-locked", "1");
      chip?.classList.add("is-locked");
    } else {
      const wasLocked = chk.getAttribute("data-locked") === "1";
      chk.disabled = false;
      chk.removeAttribute("data-locked");
      chip?.classList.remove("is-locked");

      // ✅ clave: si venía forzado por lock, al liberar vuelve a SU estado real
      if (wasLocked) chk.checked = isMine;
    }
  });
}

function applyMovilLocks(container, mySelectedSet, otherSelectedSet) {
  if (!container) return;
  const rows = Array.from(container.querySelectorAll(".row-inline"));

  rows.forEach((row) => {
    const chk = row.querySelector('input[type="checkbox"][data-value]');
    if (!chk) return;

    const v = String(chk.getAttribute("data-value") || "");
    const isMine = mySelectedSet.has(v);
    const lockedByOther = otherSelectedSet.has(v) && !isMine;

    const obs = row.querySelector('input[type="text"]');
    const flags = Array.from(row.querySelectorAll('input[type="checkbox"][data-flag]'));

    if (lockedByOther) {
      chk.checked = true;
      chk.disabled = true;
      chk.setAttribute("data-locked", "1");
      row.classList.add("is-locked");

      if (obs) {
        obs.value = "";
        obs.disabled = true;
      }
      flags.forEach((c) => {
        c.checked = false;
        c.disabled = true;
      });
    } else {
      const wasLocked = chk.getAttribute("data-locked") === "1";

      chk.disabled = false;
      chk.removeAttribute("data-locked");
      row.classList.remove("is-locked");

      // si estaba lock-forzado, al liberar lo dejamos como NO seleccionado (a menos que sea mío)
      if (wasLocked) chk.checked = isMine;

      const enabled = chk.checked;
      if (obs) {
        obs.disabled = !enabled;
        if (!enabled) obs.value = "";
      }
      flags.forEach((c) => {
        c.disabled = !enabled;
        if (!enabled) c.checked = false;
      });
    }
  });
}

function syncLocks({
  p1Personal,
  p2Personal,
  p1Elementos,
  p2Elementos,
  p1Moviles,
  p2Moviles,
  preP1Elem = null,
  preP2Elem = null,
} = {}) {
  // leemos selecciones reales desde UI (ignorando locks)
  const p1Per = new Set(readCheckedValues(p1Personal).map(String));
  const p2Per = new Set(readCheckedValues(p2Personal).map(String));

  const p1Elem = new Set((preP1Elem || readCheckedValues(p1Elementos)).map(String));
  const p2Elem = new Set((preP2Elem || readCheckedValues(p2Elementos)).map(String));

  const p1Mov = new Set(readMoviles(p1Moviles).map((m) => String(m.movil_id)));
  const p2Mov = new Set(readMoviles(p2Moviles).map((m) => String(m.movil_id)));

  // aplicar locks
  applyChipLocks(p1Personal, p1Per, p2Per);
  applyChipLocks(p2Personal, p2Per, p1Per);

  applyChipLocks(p1Elementos, p1Elem, p2Elem);
  applyChipLocks(p2Elementos, p2Elem, p1Elem);

  applyMovilLocks(p1Moviles, p1Mov, p2Mov);
  applyMovilLocks(p2Moviles, p2Mov, p1Mov);
}

// ======================================================
// Lugares
// ======================================================

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

// ======================================================
// Init
// ======================================================

export function initGuardia({ sb, subtabs } = {}) {
  const elEstadoTxt = () => document.getElementById("guardiaEstadoTxt");
  const elPreview = () => document.getElementById("guardiaJsonPreview");

  const btnGuardiaGuardar = document.getElementById("btnGuardiaGuardar");
  const btnGuardiaImportar = document.getElementById("btnGuardiaActualizar"); // texto "Importar"
  const btnGuardiaActualizarDatos = document.getElementById("btnGuardiaActualizarDatos");

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

  function ensureEscopetasItems(elems) {
    // Detecta por label o por value que contenga el número
    const found = [];
    ESCOPETAS_NUMS.forEach((num) => {
      const it = elems.find((e) => String(e.label || "").includes(num) || String(e.value || "").includes(num));
      if (it) found.push(it);
      else {
        // fallback (si no está en inventario)
        found.push({
          value: `escopeta_${num}`,
          label: `Escopeta N°${num}`,
          meta: { subgrupo: "escopetas" },
        });
      }
    });
    return found;
  }

  function renderGuardiaDesdeInventario() {
    const lugares = getLugaresSmart();
    fillSelectOptions(p1Lugar, lugares, guardiaState?.patrullas?.p1?.lugar || "");
    fillSelectOptions(p2Lugar, lugares, guardiaState?.patrullas?.p2?.lugar || "");

    const pers = invActivos("personal");
    const movs = invActivos("movil");
    const elems = invActivos("elemento");

    // Cartuchos: SOLO sección propia, no dentro de Elementos
    const elemsSinCartuchos = elems.filter((it) => {
      const sub = String(getSubgrupoLabel(it?.meta || "")).toLowerCase();
      const lbl = String(it?.label || "").toLowerCase();

      // ✅ Cartuchos fuera (sección propia)
      if (sub === "cartuchos" || lbl.includes("cartucho")) return false;

      // ✅ No mostrar "Escopeta 12/70" genérica (solo usamos las 2 N°650368 / N°650367)
      if (lbl.includes("escopeta 12/70") && !ESCOPETAS_NUMS.some((n) => lbl.includes(n))) return false;

      return true;
    });

    const p1 = guardiaState?.patrullas?.p1 || {};
    const p2 = guardiaState?.patrullas?.p2 || {};

    // PERSONAL
    renderChips(p1Personal, pers, p1.personal_ids || []);
    renderChips(p2Personal, pers, p2.personal_ids || []);

    // MOVILES
    renderMoviles(p1Moviles, movs, p1.moviles || []);
    renderMoviles(p2Moviles, movs, p2.moviles || []);

    // ELEMENTOS agrupados
    const p1Elems = Array.isArray(p1.elementos_ids) ? p1.elementos_ids : [];
    const p2Elems = Array.isArray(p2.elementos_ids) ? p2.elementos_ids : [];

    // Armamos agrupación en orden canónico, pero con Escopetas fijas (2)
    const escopetasItems = ensureEscopetasItems(elemsSinCartuchos);
    const escopetasValues = escopetasItems.map((x) => x.value);

    const elemsUIValues = elemsSinCartuchos
      .filter((it) => {
        const sub = String(getSubgrupoLabel(it?.meta || "")).toLowerCase();
        // sacamos escopetas del pool general para renderizar la sección "Escopetas" con las 2 fijas
        if (sub === "escopetas") return false;
        return true;
      })
      .map((x) => x.value);

    // incorporamos las escopetas fijas al universo de valores para que queden en su subgrupo
    const allValues = [...elemsUIValues, ...escopetasValues];
    const groups = groupElementosBySubgrupo(allValues, [...elemsSinCartuchos, ...escopetasItems]);

    const renderElementosGrouped = (container, checked, groupsArr) => {
      if (!container) return;
      container.innerHTML = "";

      groupsArr.forEach(([label, vals]) => {
        // forzar sección Escopetas a EXACTAMENTE las 2
        let items;
        if (String(label).toLowerCase() === "escopetas") {
          items = escopetasItems;
        } else {
          items = vals.map((v) => {
            const it = elemsSinCartuchos.find((x) => x.value === v) || escopetasItems.find((x) => x.value === v);
            return it || { label: v, value: v };
          });
        }

        const h = document.createElement("div");
        h.className = "subhead";
        h.textContent = label;
        container.appendChild(h);

        const row = document.createElement("div");
        row.className = "chip-grid";
        renderChips(row, items, checked);
        container.appendChild(row);
      });
    };

    renderElementosGrouped(p1Elementos, p1Elems, groups);
    renderElementosGrouped(p2Elementos, p2Elems, groups);

    // CARTUCHOS (una sola sección, con numerales)
    renderCartuchos(p1Cartuchos, { cartuchos_map: p1.cartuchos_map || {}, cartuchos_qty_map: p1.cartuchos_qty_map || {} });
    renderCartuchos(p2Cartuchos, { cartuchos_map: p2.cartuchos_map || {}, cartuchos_qty_map: p2.cartuchos_qty_map || {} });

    aplicarReglaCartuchos(p1Elementos, p1Cartuchos, p1Elems);
    aplicarReglaCartuchos(p2Elementos, p2Cartuchos, p2Elems);

    if (p1Obs) p1Obs.value = p1.obs || "";
    if (p2Obs) p2Obs.value = p2.obs || "";

    // ✅ al final del render, sincronizamos locks
    syncLocks({
      p1Personal,
      p2Personal,
      p1Elementos,
      p2Elementos,
      p1Moviles,
      p2Moviles,
      preP1Elem: p1Elems,
      preP2Elem: p2Elems,
    });
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

    const p1Cart = readCartuchos(p1Cartuchos);
    const p2Cart = readCartuchos(p2Cartuchos);

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
    next.patrullas.p1.cartuchos_map = p1Cart.cartuchos_map || {};
    next.patrullas.p1.cartuchos_qty_map = p1Cart.cartuchos_qty_map || {};

    next.patrullas.p2.lugar = normalizarLugar(p2Lugar?.value || "");
    next.patrullas.p2.obs = (p2Obs?.value || "").trim();
    next.patrullas.p2.personal_ids = p2PersonalIds;
    next.patrullas.p2.moviles = p2Mov;
    next.patrullas.p2.elementos_ids = p2Elem;
    next.patrullas.p2.cartuchos_map = p2Cart.cartuchos_map || {};
    next.patrullas.p2.cartuchos_qty_map = p2Cart.cartuchos_qty_map || {};

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

  // ======================================================
  // ✅ Actualizar datos (sin tocar timestamps de acciones)
  // - Guarda cambios de Lugar/Obs/Personal/Moviles/Elementos/Cartuchos
  // - NO modifica estado/estado_ts de cada patrulla
  // - NO agrega logs nuevos
  // - Actualiza snapshot/resumen del ÚLTIMO log por patrulla
  // ======================================================

  function actualizarResumenYSnapshotEnUltimoLog(next, pKey) {
    const up = String(pKey || "").toUpperCase();
    if (!Array.isArray(next?.log)) return;

    const idx = next.log.findIndex((e) => String(e?.patrulla || "").toUpperCase() === up);
    if (idx === -1) return;

    const pat = next?.patrullas?.[pKey] || {};
    const perTxt = (pat.personal_ids || []).map((id) => invLabelFromValue("personal", id)).join(", ");
    const movTxt = (pat.moviles || []).map((m) => invLabelFromValue("movil", m.movil_id)).join(", ");
    const elemTxt = (pat.elementos_ids || []).map((id) => invLabelFromValue("elemento", id)).join(", ");
    const resumen = `Personal: ${perTxt || "-"} | Movil(es): ${movTxt || "-"} | Elementos: ${elemTxt || "-"}`;

    const e = next.log[idx] || {};
    e.resumen = resumen;

    e.snapshot = e.snapshot || {};
    e.snapshot.lugar = pat.lugar || "";
    e.snapshot.obs = pat.obs || "";
    e.snapshot.personal_ids = Array.isArray(pat.personal_ids) ? [...pat.personal_ids] : [];
    e.snapshot.moviles = Array.isArray(pat.moviles) ? cloneDeep(pat.moviles) : [];
    e.snapshot.elementos_ids = Array.isArray(pat.elementos_ids) ? [...pat.elementos_ids] : [];
    e.snapshot.cartuchos_map = pat.cartuchos_map ? cloneDeep(pat.cartuchos_map) : {};
    e.snapshot.cartuchos_qty_map = pat.cartuchos_qty_map ? cloneDeep(pat.cartuchos_qty_map) : {};
  }

  async function onActualizarDatosGuardia() {
    const base = cloneDeep(guardiaState || {});
    const ui = buildStateFromUI();

    base.patrullas = base.patrullas || {};
    base.patrullas.p1 = base.patrullas.p1 || {};
    base.patrullas.p2 = base.patrullas.p2 || {};

    const p1Estado = { estado: base.patrullas.p1.estado, estado_ts: base.patrullas.p1.estado_ts };
    const p2Estado = { estado: base.patrullas.p2.estado, estado_ts: base.patrullas.p2.estado_ts };

    base.patrullas.p1.lugar = ui.patrullas?.p1?.lugar || "";
    base.patrullas.p1.obs = ui.patrullas?.p1?.obs || "";
    base.patrullas.p1.personal_ids = ui.patrullas?.p1?.personal_ids || [];
    base.patrullas.p1.moviles = ui.patrullas?.p1?.moviles || [];
    base.patrullas.p1.elementos_ids = ui.patrullas?.p1?.elementos_ids || [];
    base.patrullas.p1.cartuchos_map = ui.patrullas?.p1?.cartuchos_map || {};
    base.patrullas.p1.cartuchos_qty_map = ui.patrullas?.p1?.cartuchos_qty_map || {};

    base.patrullas.p2.lugar = ui.patrullas?.p2?.lugar || "";
    base.patrullas.p2.obs = ui.patrullas?.p2?.obs || "";
    base.patrullas.p2.personal_ids = ui.patrullas?.p2?.personal_ids || [];
    base.patrullas.p2.moviles = ui.patrullas?.p2?.moviles || [];
    base.patrullas.p2.elementos_ids = ui.patrullas?.p2?.elementos_ids || [];
    base.patrullas.p2.cartuchos_map = ui.patrullas?.p2?.cartuchos_map || {};
    base.patrullas.p2.cartuchos_qty_map = ui.patrullas?.p2?.cartuchos_qty_map || {};

    base.patrullas.p1.estado = p1Estado.estado;
    base.patrullas.p1.estado_ts = p1Estado.estado_ts;
    base.patrullas.p2.estado = p2Estado.estado;
    base.patrullas.p2.estado_ts = p2Estado.estado_ts;

    base.log = Array.isArray(base.log) ? base.log : [];
    actualizarResumenYSnapshotEnUltimoLog(base, "p1");
    actualizarResumenYSnapshotEnUltimoLog(base, "p2");

    base.updated_at_ts = isoNow();

    await guardarGuardiaEnServidor(base);
    aplicarStateAGuardiaUI();
    setEstado("Datos actualizados (sin cambiar horarios)");
  }

  async function onImportarGuardia({ invLoad } = {}) {
    const payload = await cargarGuardiaDesdeServidor();
    if (payload) setGuardiaState(payload);
    guardiaState = state?.guardia || payload || guardiaState;
    renderGuardiaDesdeInventario();
    renderGuardiaPreview();
    setEstado(payload ? "Importado" : "Sin datos");

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
            cartuchos_qty_map: pat.cartuchos_qty_map ? cloneDeep(pat.cartuchos_qty_map) : {},
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
      elContainer.addEventListener("change", () => {
        aplicarReglaCartuchos(elContainer, cartContainer);
        // cambios en escopetas afectan locks también
        syncLocks({ p1Personal, p2Personal, p1Elementos, p2Elementos, p1Moviles, p2Moviles });
      });
    };
    hook(p1Elementos, p1Cartuchos);
    hook(p2Elementos, p2Cartuchos);
  }

  function bindLocksLive() {
    // Personal/Elementos/Moviles: cualquier cambio => resync locks
    [p1Personal, p2Personal, p1Elementos, p2Elementos, p1Moviles, p2Moviles].forEach((c) => {
      if (!c) return;
      c.addEventListener("change", () => syncLocks({ p1Personal, p2Personal, p1Elementos, p2Elementos, p1Moviles, p2Moviles }));
    });
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
    if (btnGuardiaImportar) btnGuardiaImportar.addEventListener("click", () => onImportarGuardia({ invLoad: null }).catch(console.error));
    if (btnGuardiaActualizarDatos) btnGuardiaActualizarDatos.addEventListener("click", () => onActualizarDatosGuardia().catch(console.error));

    bindAccionesEstado();
    bindReglaCartuchosLive();
    bindLocksLive();
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

    await onImportarGuardia({ invLoad });
    renderGuardiaDesdeInventario();
    renderGuardiaPreview();
    setEstado("OK");
  }

  return { bind, init, refreshLugares };
}
