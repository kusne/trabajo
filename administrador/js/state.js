import { cloneDeep } from "./utils.js";

export const state = {
  inventario: [],
  guardiaState: {
    version: 1,
    patrullas: {
      p1: { lugar: "", obs: "", estado: "", estado_ts: "", personal_ids: [], moviles: [], elementos_ids: [], cartuchos_map: {} },
      p2: { lugar: "", obs: "", estado: "", estado_ts: "", personal_ids: [], moviles: [], elementos_ids: [], cartuchos_map: {} },
    },
    log: [],
    updated_at_ts: "",
  },
};

const listeners = {
  inventario: new Set(),
  guardia: new Set(),
};

export function subscribeInventario(fn) {
  listeners.inventario.add(fn);
  return () => listeners.inventario.delete(fn);
}

export function subscribeGuardia(fn) {
  listeners.guardia.add(fn);
  return () => listeners.guardia.delete(fn);
}

export function setInventario(arr) {
  state.inventario = Array.isArray(arr) ? arr : [];
  listeners.inventario.forEach((fn) => {
    try { fn(state.inventario); } catch (e) { console.error(e); }
  });
}

export function setGuardiaState(payload) {
  const next = payload && typeof payload === "object" ? payload : cloneDeep(state.guardiaState);
  next.version = next.version || 1;
  next.patrullas = next.patrullas || {
    p1: { lugar: "", obs: "", estado: "", estado_ts: "", personal_ids: [], moviles: [], elementos_ids: [], cartuchos_map: {} },
    p2: { lugar: "", obs: "", estado: "", estado_ts: "", personal_ids: [], moviles: [], elementos_ids: [], cartuchos_map: {} },
  };
  next.log = Array.isArray(next.log) ? next.log : [];
  next.updated_at_ts = next.updated_at_ts || "";

  state.guardiaState = next;
  listeners.guardia.forEach((fn) => {
    try { fn(state.guardiaState); } catch (e) { console.error(e); }
  });
}
