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
  { key: "ht", label: "HT" },
  { key: "escopetas", label: "Escopetas" },
  { key: "cartuchos", label: "Cartuchos" },
];

const SUBGRUPO_KEY_TO_LABEL = new Map(SUBGRUPO_CANON.map((x) => [x.key, x.label]));
const SUBGRUPOS_ORDEN = SUBGRUPO_CANON.map((x) => x.label);

// ======================================================
// ESCOPETAS FIJAS (SIEMPRE 2 OPCIONES EN UI)
// ======================================================
const ESCOPETAS_FIXED = [
  { nro: "650368", label: "Escopeta N°650368", value: "escopeta_650368", meta: { subgrupo: "escopetas" } },
  { nro: "650367", label: "Escopeta N°650367", value: "escopeta_650367", meta: { subgrupo: "escopetas" } },
];

function ensureFixedEscopetas(items = []) {
  const out = Array.isArray(items) ? [...items] : [];
  const hasNro = (nro) =>
    out.some((it) => String(it?.label || "").includes(nro) || String(it?.value || "") === `escopeta_${nro}`);
  ESCOPETAS_FIXED.forEach((e) => {
    if (!hasNro(e.nro)) out.push({ ...e });
  });
  return out;
}


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

function groupElementosBySubgrupo(elementos = []) {
  // Acepta: array de values (string) o array de items {value,label,meta}
  const items = (Array.isArray(elementos) ? elementos : []).map((x) => {
    if (x && typeof x === "object" && x.value) return x;
    const val = String(x || "");
    const it = invActivos("elemento").find((e) => e.value === val);
    return it ? it : { value: val, label: val, meta: {} };
  });

  const map = new Map();
  items.forEach((it) => {
    const meta = it?.meta || {};
    const label = getSubgrupoLabel(meta) || "Otros";
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(it.value);
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
    chk.setAttribute("data-base-checked", chk.checked ? "1" : "0");

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

function renderMoviles(container, items, selected = [], lockedMap = new Map()) {
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

        const own = selectedMap.get(it.value) || { movil_id: it.value, obs: "", libro: false, tvf: false };
    const locked = lockedMap instanceof Map ? (lockedMap.get(String(it.value)) || null) : null;
    const isLockedByOther = !!locked && !selectedMap.has(it.value);
    const saved = isLockedByOther ? locked : own;
    const isSelected = selectedMap.has(it.value) || isLockedByOther;

    // checkbox principal
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.id = id;
    chk.checked = isSelected;
    chk.setAttribute("data-value", it.value);
    chk.style.width = "auto";
    chk.style.margin = "0";

    if (isLockedByOther) {
      chk.disabled = true;
      chk.setAttribute("data-locked", "1");
      row.classList.add("is-locked");
    }

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
      if (isLockedByOther) {
        // nunca habilitar edición en patrulla no dueña
        obs.disabled = true;
        flags.querySelectorAll('input[type="checkbox"][data-flag]').forEach((c) => (c.disabled = true));
        return;
      }

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

    // reset
    chk.removeAttribute("data-locked");
    chk.disabled = false;
    chk.closest(".chip")?.classList.remove("is-locked");

    if (owner && owner !== myKey) {
      // bloqueado por otra patrulla: se ve rojo (checked) y no editable
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

function applyMovilLocks(container, ownerMap, myKey) {
  if (!container) return;
  const rows = Array.from(container.querySelectorAll(".row-inline"));
  rows.forEach((row) => {
    const chk = row.querySelector('input[type="checkbox"][data-value]');
    if (!chk) return;

    const v = chk.getAttribute("data-value");
    const owner = ownerMap.get(String(v));

    // reset base
    const wasLocked = chk.getAttribute("data-locked") === "1";
    chk.removeAttribute("data-locked");
    chk.disabled = false;
    row.classList.remove("is-locked");

    if (owner && owner !== myKey) {
      // bloquear (forzar checked)
      chk.checked = true;
      chk.disabled = true;
      chk.setAttribute("data-locked", "1");
      row.classList.add("is-locked");

      row.querySelectorAll('input,textarea,select').forEach((el) => {
        if (el === chk) return;
        el.disabled = true;
      });
    } else {
      // desbloquear: si era lock forzado, liberar selección
      if (wasLocked) chk.checked = false;

      // habilitar/inhabilitar internos según selección propia
      const enabled = chk.checked;
      const obs = row.querySelector('input[type="text"]');
      if (obs) obs.disabled = !enabled;
      row.querySelectorAll('input[type="checkbox"][data-flag]').forEach((c) => {
        c.disabled = !enabled;
      });
    }
  });
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

  // Si no hay escopeta: limpiar cantidades
  if (!hayEscopeta) {
    cartuchosContainer.querySelectorAll('input[type="number"][data-key]').forEach((n) => (n.value = ""));
  }
}

function renderCartuchos(container, checkedMap = {}, qtyMap = {}) {
  if (!container) return;
  container.innerHTML = "";

  // Cartuchos cal. 12/70 (solo visibles si hay Escopeta)
  const tipos = [
    { key: "at_12_70", label: "AT cal 12/70" },
    { key: "pg_12_70", label: "PG cal 12/70" },
  ];

  tipos.forEach((t) => {
    const id = `cart_${t.key}_${Math.random().toString(16).slice(2)}`;

    const wrap = document.createElement("div");
    wrap.className = "cart-row"; // (css opcional)

    const chip = document.createElement("label");
    chip.className = "chip";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.id = id;
    chk.setAttribute("data-key", t.key);
    chk.checked = Boolean(checkedMap?.[t.key]);

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
    qty.value = String(qtyMap?.[t.key] ?? 0);
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
  if (!container) return {};
  const map = {};
  Array.from(container.querySelectorAll('input[type="number"][data-key]')).forEach((n) => {
    const key = n.getAttribute("data-key");
    const raw = String(n.value || "").trim();
    if (!key) return;

    // Guardamos número entero >= 0 (si vacío => no se guarda)
    if (raw === "") return;
    const num = Math.max(0, parseInt(raw, 10) || 0);
    map[key] = num;
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


  // ======================================================
  // BLOQUEO CRUZADO (SOLO ESCOPETAS)
  // - lo seleccionado en Patrulla 1 NO se puede seleccionar en Patrulla 2 y viceversa
  // ======================================================
  let __elementosNoCartCache = [];

  function __escopetaValuesFrom(list) {
    const s = new Set();
    (Array.isArray(list) ? list : []).forEach((it) => {
      const lbl = String(it?.label || "").toLowerCase();
      const sub = String(getSubgrupoLabel(it?.meta || {})).toLowerCase();
      if (sub === "escopetas" || lbl.includes("escopeta")) {
        if (lbl.includes("650368") || String(it?.value) === "escopeta_650368") s.add(String(it.value));
        if (lbl.includes("650367") || String(it?.value) === "escopeta_650367") s.add(String(it.value));
      }
    });
    // fallback por si no vienen del inventario
    s.add("escopeta_650368");
    s.add("escopeta_650367");
    return s;
  }

  function __applyEscopetaLocks(container, mySel, otherSel, escSet) {
    if (!container) return;
    const inputs = Array.from(container.querySelectorAll('input[type="checkbox"][data-value]'));
    inputs.forEach((chk) => {
      const v = String(chk.getAttribute("data-value") || "");
      if (!escSet.has(v)) return;

      const chip = chk.closest(".chip");
      const lock = otherSel.has(v) && !mySel.has(v);

      if (lock) {
        chk.checked = true;
        chk.disabled = true;
        chk.setAttribute("data-locked", "1");
        chip?.classList.add("is-locked");
      } else {
        if (chk.getAttribute("data-locked") === "1") chk.checked = false;
        chk.disabled = false;
        chk.removeAttribute("data-locked");
        chip?.classList.remove("is-locked");
      }
    });
  }

  function applyEscopetaCrossLock() {
    const escSet = __escopetaValuesFrom(__elementosNoCartCache);

    const p1Sel = new Set(readCheckedValues(p1Elementos).filter((v) => escSet.has(String(v))));
    const p2Sel = new Set(readCheckedValues(p2Elementos).filter((v) => escSet.has(String(v))));

    __applyEscopetaLocks(p1Elementos, p1Sel, p2Sel, escSet);
    __applyEscopetaLocks(p2Elementos, p2Sel, p1Sel, escSet);
  }

  function renderGuardiaDesdeInventario() {
    const lugares = getLugaresSmart();
    fillSelectOptions(p1Lugar, lugares, guardiaState?.patrullas?.p1?.lugar || "");
    fillSelectOptions(p2Lugar, lugares, guardiaState?.patrullas?.p2?.lugar || "");

    const pers = invActivos("personal");
    const movs = invActivos("movil");
    const elems = ensureFixedEscopetas(invActivos("elemento"));
    // ✅ Cartuchos se manejan en su sección propia (con cantidad). Los quitamos del listado de "Elementos"
    //    para evitar que aparezcan duplicados en la UI.
    const elemsUI = elems.filter((it) => {
      const sub = getSubgrupoLabel(it?.meta || {});
      const lbl = String(it?.label || "").toLowerCase();
      return String(sub).toLowerCase() !== "cartuchos" && !lbl.includes("cartucho") && !lbl.includes("escopeta 12/70");
    });

    const p1 = guardiaState?.patrullas?.p1 || {};
    const p2 = guardiaState?.patrullas?.p2 || {};

    renderChips(p1Personal, pers, p1.personal_ids || []);
    renderChips(p2Personal, pers, p2.personal_ids || []);

    const p1LockedMov = buildLockedMovilMap(p2.moviles || []);
    const p2LockedMov = buildLockedMovilMap(p1.moviles || []);
    renderMoviles(p1Moviles, movs, p1.moviles || [], p1LockedMov);
    renderMoviles(p2Moviles, movs, p2.moviles || [], p2LockedMov);

    const isCartuchoId = (id) => {
      const lbl = invLabelFromValue("elemento", id).toLowerCase();
      return lbl.includes("cartucho");
    };

    const p1ElemsRaw = p1.elementos_ids || [];
    const p2ElemsRaw = p2.elementos_ids || [];

    // ✅ por compatibilidad: si antes se guardaron cartuchos como "elementos", acá los ocultamos
    const p1Elems = p1ElemsRaw.filter((id) => !isCartuchoId(id));
    const p2Elems = p2ElemsRaw.filter((id) => !isCartuchoId(id));
    

    const groups1 = groupElementosBySubgrupo(elemsUI);
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
          const it = elemsUI.find((x) => x.value === v);
          return it || { label: v, value: v };
        });
        renderChips(row, items, checked);
        container.appendChild(row);
      });
    };

    renderElementosGrouped(p1Elementos, p1Elems, groups1);
    renderElementosGrouped(p2Elementos, p2Elems, groups2);

    renderCartuchos(p1Cartuchos, p1.cartuchos_map || {}, p1.cartuchos_qty_map || {});
    renderCartuchos(p2Cartuchos, p2.cartuchos_map || {}, p2.cartuchos_qty_map || {});

    aplicarReglaCartuchos(p1Elementos, p1Cartuchos, p1Elems);
    aplicarReglaCartuchos(p2Elementos, p2Cartuchos, p2Elems);


    // ==================================================
    // ✅ BLOQUEO CRUZADO (render desde estado)
    // - Personal: si lo usa una patrulla, queda rojo + bloqueado en la otra
    // - Elementos: idem (incluye Escopetas/HT/etc)
    // - Moviles: idem (con flags/obs visibles pero no editables)
    // ==================================================
    const personalOwner = buildOwnerMapFromArrays(p1.personal_ids || [], p2.personal_ids || []);
    applyChipLocks(p1Personal, personalOwner, "p1");
    applyChipLocks(p2Personal, personalOwner, "p2");

    const elementosOwner = buildOwnerMapFromArrays(p1Elems || [], p2Elems || []);
    applyChipLocks(p1Elementos, elementosOwner, "p1");
    applyChipLocks(p2Elementos, elementosOwner, "p2");

    const movOwner = buildOwnerMapFromArrays(
      (p1.moviles || []).map((m) => String(m.movil_id)),
      (p2.moviles || []).map((m) => String(m.movil_id))
    );
    applyMovilLocks(p1Moviles, movOwner, "p1");
    applyMovilLocks(p2Moviles, movOwner, "p2");

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

  
  // ======================================================
  // ✅ Preview en vivo: si cambiás Lugar/Obs/Selecciones,
  // el JSON se refresca sin necesidad de guardar.
  // (no escribe en servidor)
  // ======================================================
  function renderPreviewFromUI() {
    try {
      const next = buildStateFromUI();
      // NO tocamos guardiaState persistido; solo preview visual
      const pre = elPreview();
      if (pre) pre.textContent = JSON.stringify(next || {}, null, 2);
    } catch {}
  }

  function bindLivePreview() {
    // selects + obs
    [p1Lugar, p2Lugar].forEach((el) => el && el.addEventListener("change", renderPreviewFromUI));
    [p1Obs, p2Obs].forEach((el) => el && el.addEventListener("input", renderPreviewFromUI));

    // contenedores de checks (delegado)
    [p1Personal, p2Personal, p1Moviles, p2Moviles, p1Elementos, p2Elementos, p1Cartuchos, p2Cartuchos].forEach((c) => {
      if (!c) return;
      c.addEventListener("change", renderPreviewFromUI);
      c.addEventListener("input", renderPreviewFromUI);
    });
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
            cartuchos_qty_map: pat.cartuchos_qty_map ? cloneDeep(pat.cartuchos_qty_map) : {},
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
      elContainer.addEventListener("change", () => aplicarReglaCartuchos(elContainer, cartContainer));
    };
    hook(p1Elementos, p1Cartuchos);
    hook(p2Elementos, p2Cartuchos);
  }


  // ======================================================
  // ✅ BLOQUEO CRUZADO LIVE (sin guardar)
  // Si marcás / desmarcás en P1, automáticamente se bloquea/desbloquea en P2 y viceversa.
  // El bloqueo en la patrulla NO dueña se marca con data-locked="1" (no se guarda).
  // ======================================================
  function aplicarBloqueoCruzadoDesdeUI() {
    try {
      const p1PersonalIds = readCheckedValues(p1Personal);
      const p2PersonalIds = readCheckedValues(p2Personal);

      const p1Elem = readCheckedValues(p1Elementos);
      const p2Elem = readCheckedValues(p2Elementos);

      const p1MovIds = Array.from(p1Moviles?.querySelectorAll('input[type="checkbox"][data-value]') || [])
        .filter((c) => c.checked && c.getAttribute("data-locked") !== "1")
        .map((c) => String(c.getAttribute("data-value")));
      const p2MovIds = Array.from(p2Moviles?.querySelectorAll('input[type="checkbox"][data-value]') || [])
        .filter((c) => c.checked && c.getAttribute("data-locked") !== "1")
        .map((c) => String(c.getAttribute("data-value")));

      const personalOwner = buildOwnerMapFromArrays(p1PersonalIds, p2PersonalIds);
      applyChipLocks(p1Personal, personalOwner, "p1");
      applyChipLocks(p2Personal, personalOwner, "p2");

      const elementosOwner = buildOwnerMapFromArrays(p1Elem, p2Elem);
      applyChipLocks(p1Elementos, elementosOwner, "p1");
      applyChipLocks(p2Elementos, elementosOwner, "p2");

      const movOwner = buildOwnerMapFromArrays(p1MovIds, p2MovIds);
      applyMovilLocks(p1Moviles, movOwner, "p1");
      applyMovilLocks(p2Moviles, movOwner, "p2");
    } catch {}
  }

  function bindBloqueoCruzadoLive() {
    const hook = (container) => {
      if (!container) return;
      container.addEventListener("change", () => {
        aplicarBloqueoCruzadoDesdeUI();
      });
    };
    hook(p1Personal);
    hook(p2Personal);
    hook(p1Elementos);
    hook(p2Elementos);
    hook(p1Moviles);
    hook(p2Moviles);
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
    bindBloqueoCruzadoLive();

    if (p1Elementos) p1Elementos.addEventListener("change", () => applyEscopetaCrossLock());
    if (p2Elementos) p2Elementos.addEventListener("change", () => applyEscopetaCrossLock());
    bindRefrescoPorGuardarOrden();

    bindLivePreview();

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
