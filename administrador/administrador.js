// administrador.js (RESTORE ENTRYPOINT)
// Objetivo: volver a dejar funcional el cambio de solapas y la inicialización modular
// sin depender de rutas ./js/* inexistentes.
//
// NOTA: este archivo asume que están en la MISMA carpeta:
// - tabs.js, guardia.js, inventario.js, libroMemorandum.js, subtabsPatrullas.js, supabaseClient.js
// y que config.js + utils.js existen (los usan los módulos).

import { createSupabaseClient } from "./supabaseClient.js";
import { initTabs } from "./tabs.js";
import { createSubtabsPatrullas } from "./subtabsPatrullas.js";

import { initGuardia } from "./guardia.js";
import { initInventario } from "./inventario.js";
import { initLibroMemorandum } from "./libroMemorandum.js";

(function () {
  // Puentes globales (no tocamos lógica legacy: solo avisos si algo falta)
  window.agregarOrden = window.agregarOrden || function () {
    alert("Función agregarOrden() no está cargada. Revisá scripts legacy de Órdenes.");
  };

  window.publicarOrdenes = window.publicarOrdenes || function () {
    alert("Función publicarOrdenes() no está cargada. Revisá scripts legacy de Órdenes.");
  };

  window.importarLibroMemorandum = window.importarLibroMemorandum || function () {
    // si libroMemorandum.js expone import, lo engancha él; esto evita error si alguien lo llama
    console.warn("importarLibroMemorandum() aún no inicializado.");
  };

  document.addEventListener("DOMContentLoaded", async () => {
    // 1) Supabase client (si no hay sesión, los módulos lo manejarán con sus alerts)
    const sb = createSupabaseClient();

    // 2) Subsolapas Patrulla 1/2
    const subtabs = createSubtabsPatrullas({
      rootId: "guardiaSubtabs",
      panel1Id: "panelPatrulla1",
      panel2Id: "panelPatrulla2",
      btn1Sel: '[data-subtab="p1"]',
      btn2Sel: '[data-subtab="p2"]',
    });

    // 3) Guardia / Inventario / Libro
    const guardia = initGuardia({ sb, subtabs });
    const inventario = initInventario({ sb });
    const libro = initLibroMemorandum({ sb });

    // 4) Tabs principales
    const tabs = initTabs({
      onGuardiaActivate: () => {
        // refresca lugares cuando se entra en Guardia
        try { guardia.refreshLugares?.(); } catch {}
      },
    });

    // 5) Bind eventos
    try { inventario.bind?.(); } catch (e) { console.error(e); }
    try { guardia.bind?.(); } catch (e) { console.error(e); }
    try { libro.bind?.(); } catch (e) { console.error(e); }

    // 6) Init (carga de datos)
    // Inventario primero (guardia depende del inventario para chips)
    try { await inventario.init?.(); } catch (e) { console.error(e); }
    try { await guardia.init?.({ invLoad: inventario.load?.bind(inventario) || null }); } catch (e) { console.error(e); }
    try { await libro.init?.(); } catch (e) { console.error(e); }

    // 7) Tab inicial: Órdenes
    try { tabs.activarTab?.("ordenes"); } catch {}

    console.log("[ADM] EntryPoint RESTORE OK");
  });
})();



