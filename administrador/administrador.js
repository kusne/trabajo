// administrador/administrador.js (ENTRYPOINT MODULAR)
// - Importa Supabase client desde ./js (NO desde ../funciones)
// - Inicializa auth + tabs + módulos (ordenes/guardia/inventario/libro)
// - Mantiene puentes globales para onclick legacy

import { createSupabaseClient } from "./js/supabaseClient.js";

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

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const sb = createSupabaseClient();

    // Tabs (NO asumimos show/hide porque tu tabs.js puede exponer otra API)
    const tabs = initTabs?.({ defaultTab: "ordenes" }) || null;

    // Módulos
    const ordenes = initOrdenes?.({
      sb,
      onOrdenesChanged: () => {
        // si guardia tiene refresh de lugares, lo llamamos
        if (typeof guardia?.refreshLugares === "function") guardia.refreshLugares();
      },
    });

    const guardia = initGuardia?.({ sb });
    const inventario = initInventario?.({ sb });
    const libro = initLibroMemorandum?.({ sb });

    // Bind
    ordenes?.bind?.();
    guardia?.bind?.();
    inventario?.bind?.();
    libro?.bind?.();

    // Botón eliminar (si existe por id)
    const btnEliminar = document.getElementById("btnEliminarOrden");
    if (btnEliminar) {
      btnEliminar.addEventListener("click", () => window.eliminarOrden());
    }

    // Auth
    const auth = initAuth?.({ sb });

    if (!auth?.init) {
      throw new Error("auth.js no expone init(). Verificá tu módulo auth.js.");
    }

    await auth.init({
      onLoggedIn: async () => {
        // Si tabs tiene show(), lo usamos. Si no, no rompemos.
        if (typeof tabs?.show === "function") tabs.show();

        // Inits en orden lógico
        if (typeof ordenes?.init === "function") await ordenes.init();
        if (typeof inventario?.init === "function") await inventario.init();

        if (typeof guardia?.init === "function") {
          const invLoad = inventario?.invLoad;
          await guardia.init(invLoad ? { invLoad } : undefined);
        }

        if (typeof libro?.init === "function") await libro.init();

        // Set tab default si tu tabs.js expone activarTab()
        if (typeof tabs?.activarTab === "function") tabs.activarTab("ordenes");
      },

      onLoggedOut: () => {
        if (typeof tabs?.hide === "function") tabs.hide();
      },
    });
  } catch (err) {
    console.error("[ADM] Error inicializando entrypoint:", err);
    alert("Error inicializando ADM. Mirá Console (F12).");
  }
});
