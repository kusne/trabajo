// administrador/administrador.js (ENTRYPOINT MODULAR)
// auth + tabs + módulos (ordenes/guardia/inventario/libro)
// Mantiene puentes globales para HTML legacy (onclick).

import { createSbClient } from "./js/supabaseClient.js";
import { initAuth } from "./js/auth.js";
import { initTabs } from "./js/tabs.js";
import { initOrdenes } from "./js/ordenes.js";
import { initGuardia } from "./js/guardia.js";
import { initInventario } from "./js/inventario.js";
import { initLibroMemorandum } from "./js/libroMemorandum.js";

// ===============================
// Puentes globales (compat HTML)
// ===============================
window.agregarOrden = function () {
  if (typeof window.__adm_agregarOrden === "function") return window.__adm_agregarOrden();
  alert("ADM no inicializó agregarOrden. Ctrl+F5 y revisá consola.");
};

window.publicarOrdenes = function () {
  if (typeof window.__adm_publicarOrdenes === "function") return window.__adm_publicarOrdenes();
  alert("ADM no inicializó publicarOrdenes. Ctrl+F5 y revisá consola.");
};

window.eliminarOrden = function () {
  if (typeof window.__adm_eliminarOrden === "function") return window.__adm_eliminarOrden();
  alert("ADM no inicializó eliminarOrden. Ctrl+F5 y revisá consola.");
};

console.log("[ADM] entrypoint administrador.js cargado OK");

// ===============================
// Bootstrap
// ===============================
const sb = createSbClient();

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const auth = initAuth({ sb });
    const tabs = initTabs({ defaultTab: "ordenes" });

    const ordenes = initOrdenes({ sb });
    const guardia = initGuardia({ sb });
    const inventario = initInventario({ sb });
    const libro = initLibroMemorandum({ sb });

    // Bind handlers internos de cada módulo
    ordenes?.bind?.();
    guardia?.bind?.();
    inventario?.bind?.();
    libro?.bind?.();

    // Puentes globales DEFINITIVOS (toman funciones reales del módulo)
    // Nota: en el ordenes.js corregido, estas funciones existen.
    if (typeof ordenes?.agregarOrden === "function") window.__adm_agregarOrden = ordenes.agregarOrden;
    if (typeof ordenes?.publicarOrdenes === "function") window.__adm_publicarOrdenes = ordenes.publicarOrdenes;
    if (typeof ordenes?.eliminarOrden === "function") window.__adm_eliminarOrden = ordenes.eliminarOrden;

    // Botón eliminar por id (si existe)
    const btnEliminar = document.getElementById("btnEliminarOrden");
    if (btnEliminar) {
      btnEliminar.addEventListener("click", () => window.eliminarOrden());
    }

    // Auth flow
    await auth.init({
      onLoggedIn: async () => {
        tabs.show();

        // Ordenes primero (guardia usa lugares de órdenes)
        await ordenes?.init?.();
        await inventario?.init?.();

        // Si guardia requiere invLoad (solo si existe)
        const invLoad = inventario?.invLoad;
        await guardia?.init?.(invLoad ? { invLoad } : undefined);

        await libro?.init?.();
      },
      onLoggedOut: () => {
        tabs.hide();
      },
    });
  } catch (err) {
    console.error("[ADM] Error inicializando entrypoint:", err);
    alert("Error inicializando ADM. Mirá Console (F12).");
  }
});
