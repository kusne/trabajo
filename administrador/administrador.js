// Administrador (bootstrap modular)

import { wireGlobalBridge } from "./js/bridge.js";
import { createSupabaseClient } from "./js/supabaseClient.js";
import { createSubtabsPatrullas } from "./js/subtabsPatrullas.js";
import { initTabs } from "./js/tabs.js";
import { initAuth } from "./js/auth.js";
import { initOrdenes } from "./js/ordenes.js";
import { initInventario } from "./js/inventario.js";
import { initGuardia } from "./js/guardia.js";

wireGlobalBridge();
console.log("Administrador cargado OK (modo modular)");

document.addEventListener("DOMContentLoaded", async () => {
  // Supabase client (usa el CDN ya cargado en el HTML)
  const sb = createSupabaseClient();

  // Subsolapas (Patrullas)
  const subtabs = createSubtabsPatrullas();

  // Módulos
  const guardia = initGuardia({ sb, subtabs });
  const inventario = initInventario({ sb });
  const ordenes = initOrdenes({
    sb,
    onOrdenesChanged: () => {
      // cuando cambian órdenes, refrescamos lugares de guardia
      try { guardia.cargarLugaresParaGuardia(); } catch { }
    },
  });

  // Bind (event listeners)
  ordenes.bind();
  inventario.bind();
  guardia.bind();

  // Tabs principales
  const tabs = initTabs({
    onGuardiaActivate: () => {
      subtabs.boot();
      subtabs.apply();
    },
  });

  // Boot autenticación + init de app cuando hay sesión
  const auth = initAuth({
    sb,
    onLoggedIn: async () => {
      // Ordenes
      ordenes.limpiarOrdenesCaducadas();
      ordenes.actualizarSelector();
      ordenes.resetPublishState();

      // Guardia
      try { guardia.cargarLugaresParaGuardia(); } catch { }
      subtabs.boot();
      subtabs.apply();

      // Carga datos
      await inventario.invLoad();
      await guardia.init({ invLoad: inventario.invLoad });

      // Tab inicial
      tabs.activarTab("ordenes");
    },
  });

  auth.bind();
  await auth.bootSession();

  // Si está logueado, el init de arriba ya seteó la tab.
  // Si NO está logueado, mantenemos la UI oculta sin tocar tabs.
});
