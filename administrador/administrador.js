// administrador.js (ENTRYPOINT MODULAR)
// Conecta: auth + tabs + módulos (ordenes/guardia/inventario/libro)
// Mantiene puente global para onclick="agregarOrden()" y publicarOrdenes().

import { createSbClient } from "../funciones/js/supabaseClient.js";
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
  alert("ADM no inicializó agregarOrden. Revisá administrador.js y Ctrl+F5.");
};

window.publicarOrdenes = function () {
  if (typeof window.__adm_publicarOrdenes === "function") return window.__adm_publicarOrdenes();
  alert("ADM no inicializó publicarOrdenes. Revisá administrador.js y Ctrl+F5.");
};

window.eliminarOrden = function () {
  if (typeof window.__adm_eliminarOrden === "function") return window.__adm_eliminarOrden();
  alert("ADM no inicializó eliminarOrden. Revisá administrador.js y Ctrl+F5.");
};

console.log("[ADM] administrador.js entrypoint cargado OK");

// ===============================
// Bootstrap
// ===============================
const sb = createSbClient();

document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Auth + Tabs
    const auth = initAuth({ sb });
    const tabs = initTabs({ defaultTab: "ordenes" });

    // Módulos
    const ordenes = initOrdenes({ sb });
    const guardia = initGuardia({ sb });
    const inventario = initInventario({ sb });
    const libro = initLibroMemorandum({ sb });

    // Bind UI handlers
    if (ordenes?.bind) ordenes.bind();
    if (guardia?.bind) guardia.bind();
    if (inventario?.bind) inventario.bind();
    if (libro?.bind) libro.bind();

    // Conectar botones legacy si existen
    // (por si tu módulo ordenes maneja estos métodos)
    if (typeof ordenes?.agregarOrden === "function") window.__adm_agregarOrden = ordenes.agregarOrden;
    if (typeof ordenes?.publicarOrdenes === "function") window.__adm_publicarOrdenes = ordenes.publicarOrdenes;
    if (typeof ordenes?.eliminarOrden === "function") window.__adm_eliminarOrden = ordenes.eliminarOrden;

    // Si tu HTML tiene botón "Eliminar" por id (sin onclick), lo conectamos acá también
    const btnEliminar = document.getElementById("btnEliminarOrden");
    if (btnEliminar && typeof ordenes?.eliminarOrden === "function") {
      btnEliminar.addEventListener("click", ordenes.eliminarOrden);
    } else if (btnEliminar && typeof window.__adm_eliminarOrden === "function") {
      btnEliminar.addEventListener("click", window.__adm_eliminarOrden);
    }

    // Init auth flow
    await auth.init({
      onLoggedIn: async () => {
        tabs.show();

        // Init ordenes primero, porque guardia toma lugares desde órdenes
        if (ordenes?.init) await ordenes.init();

        if (inventario?.init) await inventario.init();

        // Si tu guardia necesita un callback de inventario, lo pasamos si existe
        if (guardia?.init) {
          const invLoad = inventario?.invLoad;
          await guardia.init(invLoad ? { invLoad } : undefined);
        }

        if (libro?.init) await libro.init();
      },

      onLoggedOut: () => {
        tabs.hide();
      },
    });
  } catch (err) {
    console.error("[ADM] Error inicializando administrador.js:", err);
    alert("Error inicializando ADM. Mirá Console (F12).");
  }
});
