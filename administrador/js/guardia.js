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

export function cargarLugaresParaGuardia({ p1Lugar, p2Lugar } = {}) {
  fillLugarSelect(p1Lugar);
  fillLugarSelect(p2Lugar);
}

function chipsCheckbox(container, items, { prefix }) {
  if (!container) return;
  if (!items.length) {
    container.innerHTML = `<div class="muted">Sin datos.</div>`;
    return;
  }

  container.innerHTML = items
    .map((it, idx) => {
      const id = `${prefix}_${idx}`;
      return `
        <label class="checkbox-container" style="display:flex; align-items:center; gap:8px; border:1px solid #ddd; padding:6px 10px; border-radius:999px;">
          <input type="checkbox" id="${esc(id)}" value="${esc(it.value)}">
          <span>${esc(it.label)}</span>
        </label>
      `;
    })
    .join("");
}

function renderMoviles(container, moviles, { prefix }) {
  if (!container) return;
  if (!moviles.length) {
    container.innerHTML = `<div class="muted">Sin móviles activos.</div>`;
    return;
  }

  container.innerHTML = moviles
    .map((m, idx) => {
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
    })
    .join("");

  container.querySelectorAll('input[data-movil-pick="1"]').forEach((chk) => {
    chk.addEventListener("change", () => {
      const movilId = chk.getAttribute("data-movil-id");
      const enabled = chk.checked;
      const flags = container.querySelectorAll(
        `input[data-movil-flag][data-movil-id="${CSS.escape(movilId)}"]`
      );
      flags.forEach((f) => {
        f.disabled = !enabled;
        if (!enabled) f.checked = false;
      });
    });
  });
}

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

  container.innerHTML = grouped
    .map(([sg, items]) => {
      const listId = `${prefix}_sg_${slugifyValue(sg)}`;
      return `
        <div style="border:1px solid #e5e5e5; border-radius:14px; padding:10px; margin:10px 0; background:#fff;">
          <div style="font-weight:800; margin-bottom:8px;">${esc(sg)}</div>
          <div id="${esc(listId)}" style="display:flex; flex-wrap:wrap; gap:8px;"></div>
        </div>
      `;
    })
    .join("");

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

  container.innerHTML = cartuchosItems
    .map((c, idx) => {
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
    })
    .join("");

  container.querySelectorAll('input[data-cartucho-pick="1"]').forEach((chk) => {
    chk.addEventListener("change", () => {
      const id = chk.getAttribute("data-cartucho-id");
      const qty = container.querySelector(
        `input[data-cartucho-qty="1"][data-cartucho-id="${CSS.escape(id)}"]`
      );
      if (!qty) return;
      qty.disabled = !chk.checked;
      if (!chk.checked) qty.value = "";
    });
  });
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

    const libro = !!container.querySelector(
      `input[data-movil-flag="libro"][data-movil-id="${CSS.escape(movil_id)}"]`
    )?.checked;
    const llave = !!container.querySelector(
      `input[data-movil-flag="llave"][data-movil-id="${CSS.escape(movil_id)}"]`
    )?.checked;
    const tvf = !!container.querySelector(
      `input[data-movil-flag="tvf"][data-movil-id="${CSS.escape(movil_id)}"]`
    )?.checked;

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
    const qtyEl = container.querySelector(
      `input[data-cartucho-qty="1"][data-cartucho-id="${CSS.escape(id)}"]`
    );
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

function aplicarReglaCartuchos(elContainer, cartContainer, elementos_ids_override) {
  if (!cartContainer) return;

  const elementos_ids =
    Array.isArray(elementos_ids_override) ? elementos_ids_override : readCheckedValues(elContainer);

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

export function initGuardia({ sb, subtabs } = {}) {
  const guardiaEstadoTxt = document.getElementById("guardiaEstadoTxt");
  const btnGuardiaGuardar = document.getElementById("btnGuardiaGuardar");
  const btnGuardiaActualizar = document.getElementById("btnGuardiaActualizar");
  const btnGuardiaActualizarDatos = document.getElementById("btnGuardiaActualizarDatos");
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

  let guardiaState = state.guardiaState;

  function renderGuardiaPreview() {
    if (preGuardia) preGuardia.textContent = JSON.stringify(guardiaState || {}, null, 2);
    if (guardiaEstadoTxt) guardiaEstadoTxt.textContent = `Última actualización: ${guardiaState.updated_at_ts || "—"}`;
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

    if (subtabs) {
      subtabs.boot();
      subtabs.apply();
    }
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

    if (subtabs) {
      subtabs.boot();
      subtabs.apply();
    }
  }

  function buildStateFromUI({ touchUpdatedAt = true } = {}) {
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
    if (touchUpdatedAt) next.updated_at_ts = isoNow();
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
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Accept: "application/json",
    };
    if (session?.access_token) headers.Authorization = "Bearer " + session.access_token;

    const r = await fetch(`${SUPABASE_URL}/rest/v1/guardia_estado?select=payload&id=eq.1&limit=1`, { headers });

    if (!r.ok) {
      const txt = await r.text();
      console.warn("[ADMIN] No se pudo leer guardia_estado:", r.status, txt);
      renderGuardiaPreview();
      return;
    }

    const data = await r.json();
    const payload = data?.[0]?.payload || null;

    if (payload && typeof payload === "object") {
      setGuardiaState(payload);
      guardiaState = state.guardiaState;
    }

    aplicarStateAGuardiaUI();
  }

  async function guardarGuardiaEnServidor(nextPayload) {
    const session = await getSessionOrNull(sb);
    if (!session) {
      alert("No hay sesión iniciada. Inicie sesión antes de guardar Guardia.");
      return false;
    }

    const res = await patchOrInsertStore({ table: "guardia_estado", payload: nextPayload, session });
    if (!res.ok) {
      console.error("[ADMIN] Error guardando guardia_estado:", res.status, res.text);
      alert("Error guardando Guardia. Mirá Console (F12). Status: " + res.status);
      return false;
    }

    const p = res.data?.[0]?.payload ?? res.data?.payload ?? null;
    setGuardiaState(p && typeof p === "object" ? p : nextPayload);
    guardiaState = state.guardiaState;

    renderGuardiaPreview();
    return true;
  }


  // ✅ Actualiza SOLO datos de recursos (personal/móviles/elementos/lugar/obs/cartuchos)
  // sin tocar timestamps/logs de acciones (Ingreso/Retiro/Presente/Franco/Constancia).
  async function onActualizarDatos() {
    const next = buildStateFromUI({ touchUpdatedAt: false });
    await guardarGuardiaEnServidor(next);
    aplicarStateAGuardiaUI();
    setEstado("Datos actualizados (sin cambiar horario)");
  }

  async function onGuardarGuardia() {
    const next = buildStateFromUI();
    const ok = await guardarGuardiaEnServidor(next);
    if (ok) alert("Guardia guardada (defaults publicados).");
  }

  async function onActualizarGuardia({ invLoad } = {}) {
    if (typeof invLoad === "function") await invLoad();
    cargarLugaresParaGuardia({ p1Lugar, p2Lugar });
    await cargarGuardiaDesdeServidor();

    if (subtabs) {
      subtabs.boot();
      subtabs.apply();
    }
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
        next.log.unshift({ patrulla: String(p).toUpperCase(), accion, hora, ts, resumen });

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

  function bind() {
    if (btnGuardiaGuardar) btnGuardiaGuardar.addEventListener("click", () => onGuardarGuardia().catch(console.error));
    if (btnGuardiaActualizar) {
      btnGuardiaActualizar.addEventListener("click", () => onActualizarGuardia({ invLoad: null }).catch(console.error));
    }

    bindAccionesEstado();
    bindReglaCartuchosLive();

    // Re-render UI cuando cambia inventario
    subscribeInventario(() => {
      // mantiene lugares y re-render de chips
      renderGuardiaDesdeInventario();
      renderGuardiaPreview();
    });
  }

  async function init({ invLoad } = {}) {
    cargarLugaresParaGuardia({ p1Lugar, p2Lugar });
    renderGuardiaDesdeInventario();
    await cargarGuardiaDesdeServidor();
    renderGuardiaPreview();

    // Parchar handler de actualizar para que use invLoad real
    if (btnGuardiaActualizar) {
      btnGuardiaActualizar.onclick = null;
      btnGuardiaActualizar.addEventListener("click", () => onActualizarGuardia({ invLoad }).catch(console.error));
    }

    if (subtabs) {
      subtabs.boot();
      subtabs.apply();
    }
  }

  return { bind, init, cargarLugaresParaGuardia: () => cargarLugaresParaGuardia({ p1Lugar, p2Lugar }), cargarGuardiaDesdeServidor };
}
