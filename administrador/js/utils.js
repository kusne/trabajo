// ======================================================
// Utils (compartidas)
// ======================================================

export function isoToLatam(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function normalizarOrdenParaPublicar(o) {
  const out = { ...o };
  out.vigencia = isoToLatam(out.vigencia);
  if (Array.isArray(out.franjas)) out.franjas = out.franjas.map((f) => ({ ...f }));
  else out.franjas = [];
  return out;
}

export function normalizarLugar(l) {
  return String(l || "").trim().replace(/\s+/g, " ");
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[c]));
}

export function slugifyValue(s) {
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

// Hora local AR como HH:MM (usa el timezone local del dispositivo)
export function hhmmArNow() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function isoNow() {
  return new Date().toISOString();
}

export function cloneDeep(obj) {
  if (typeof structuredClone === "function") return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj || {}));
}

export function safeParseJson(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return "__INVALID__";
  }
}
