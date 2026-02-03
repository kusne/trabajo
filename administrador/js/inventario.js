import { esc, slugifyValue, safeParseJson } from "./utils.js";
import { setInventario, state } from "./state.js";

export function invActivos(tipo) {
  return state.inventario
    .filter((x) => x.tipo === tipo && x.activo)
    .sort((a, b) => (a.orden - b.orden) || a.label.localeCompare(b.label, "es"));
}

export function invLabelFromValue(tipo, value) {
  const r = state.inventario.find((x) => x.tipo === tipo && x.value === value);
  return r ? r.label : value;
}

export function initInventario({ sb, onInventarioChanged } = {}) {
  // ===== DOM refs =====
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

  let inventario = []; // cache local

  async function invLoad() {
    if (invEstado) invEstado.textContent = "Cargando inventario…";

    const { data, error } = await sb
      .from("inventario_base")
      .select("id,tipo,label,value,orden,activo,meta")
      .order("tipo", { ascending: true })
      .order("orden", { ascending: true })
      .order("label", { ascending: true });

    if (error) {
      console.error("[ADMIN] inventario_base load error:", error);
      if (invEstado) invEstado.textContent = "Error cargando inventario (mirá Console).";
      inventario = [];
      setInventario([]);
      renderInventarioLista();
      if (typeof onInventarioChanged === "function") onInventarioChanged();
      return false;
    }

    inventario = Array.isArray(data) ? data : [];
    setInventario(inventario);

    if (invEstado) invEstado.textContent = `Inventario: ${inventario.length} ítems`;
    renderInventarioLista();
    if (typeof onInventarioChanged === "function") onInventarioChanged();
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

    const { error } = await sb.from("inventario_base").insert([payload]);

    if (error) {
      console.error("[ADMIN] inventario_base insert error:", error);
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
    const { error } = await sb
      .from("inventario_base")
      .update({ activo: !!nextActivo })
      .eq("id", id);

    if (error) {
      console.error("[ADMIN] inventario_base update activo error:", error);
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
    if (parsed === "__INVALID__") return alert("Meta inválido (JSON)." );

    const { error } = await sb
      .from("inventario_base")
      .update({ label: nLabel.trim(), value: nValue.trim(), orden: nOrden, meta: parsed || null })
      .eq("id", item.id);

    if (error) {
      console.error("[ADMIN] inventario_base update error:", error);
      alert("Error editando inventario. Mirá Console (F12)." );
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
        const item = inventario.find((x) => String(x.id) === String(id));
        if (!item) return;
        invEditar(item).catch((e) => console.error(e));
      });
    });
  }

  function bind() {
    if (btnInvAgregar) btnInvAgregar.addEventListener("click", () => invInsert().catch((e) => console.error(e)));
    if (btnInvRefrescar) btnInvRefrescar.addEventListener("click", () => invLoad().catch((e) => console.error(e)));

    if (invLabel && invValue) {
      invLabel.addEventListener("input", () => {
        if ((invValue.value || "").trim()) return;
        invValue.value = slugifyValue(invLabel.value);
      });
    }
  }

  return { bind, invLoad };
}
