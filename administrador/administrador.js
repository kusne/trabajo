// administrador/administrador.js (ENTRYPOINT MODULAR)
// Conecta: auth + tabs + módulos (ordenes/guardia/inventario/libro)
// Mantiene puentes globales para onclick legacy.

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
    // ========= Supabase =========
    const sb = createSupabaseClient();

    // ========= UI Core =========
    const auth = initAuth({ sb });
    const tabs = initTabs({ defaultTab: "ordenes" });

    // Compat: tu tabs.js puede devolver show/hide o showTabs/hideTabs
    const tabsShow =
      (tabs && typeof tabs.show === "function" && tabs.show.bind(tabs)) ||
      (tabs && typeof tabs.showTabs === "function" && tabs.showTabs.bind(tabs)) ||
      (() => {});
    const tabsHide =
      (tabs && typeof tabs.hide === "function" && tabs.hide.bind(tabs)) ||
      (tabs && typeof tabs.hideTabs === "function" && tabs.hideTabs.bind(tabs)) ||
      (() => {});

    // ========= Módulos =========
    // IMPORTANTE: Ordenes primero porque Guardia toma lugares desde órdenes
    const ordenes = initOrdenes({
      sb,
      onOrdenesChanged: () => {
        // si guardia expone "refreshLugares" (o similar) lo llamamos
        if (guardia && typeof guardia.refreshLugares === "function") guardia.refreshLugares();
      },
    });
    const guardia = initGuardia({ sb });
    const inventario = initInventario({ sb });
    const libro = initLibroMemorandum({ sb });

    // ========= Bind =========
    if (ordenes?.bind) ordenes.bind();
    if (guardia?.bind) guardia.bind();
    if (inventario?.bind) inventario.bind();
    if (libro?.bind) libro.bind();

    // Puentes desde el módulo Órdenes (lo más importante)
    // (tu ordenes.js ya suele setear __adm_... pero lo forzamos por compat)
    if (typeof ordenes?.agregarOrden === "function") window.__adm_agregarOrden = ordenes.agregarOrden;
    if (typeof ordenes?.publicarOrdenes === "function") window.__adm_publicarOrdenes = ordenes.publicarOrdenes;
    if (typeof ordenes?.eliminarOrden === "function") window.__adm_eliminarOrden = ordenes.eliminarOrden;

    // Botón eliminar por ID (si existe)
    const btnEliminar = document.getElementById("btnEliminarOrden");
    if (btnEliminar) {
      btnEliminar.addEventListener("click", () => {
        if (typeof window.__adm_eliminarOrden === "function") return window.__adm_eliminarOrden();
        alert("Eliminar no inicializado. Revisá ordenes.js y administrador.js");
      });
    }

    // ========= Arranque Auth =========
    // Compat: tu auth.js puede tener init({...}) o bind()+bootSession()
    if (auth && typeof auth.init === "function") {
      await auth.init({
        onLoggedIn: async () => {
          tabsShow();

          // init ordenes primero
          if (ordenes?.limpiarOrdenesCaducadas) ordenes.limpiarOrdenesCaducadas();
          if (ordenes?.actualizarSelector) ordenes.actualizarSelector();
          if (ordenes?.resetPublishState) ordenes.resetPublishState();
          if (ordenes?.init) await ordenes.init();

          if (inventario?.init) await inventario.init();

          if (guardia?.init) {
            const invLoad = inventario?.invLoad;
            await guardia.init(invLoad ? { invLoad } : undefined);
          }

          if (libro?.init) await libro.init();
        },
        onLoggedOut: () => {
          tabsHide();
        },
      });
    } else {
      // fallback antiguo: auth.bind() + auth.bootSession()
      if (auth?.bind) auth.bind();
      await auth?.bootSession?.(); // tu auth.js interno decide logged in/out
      // si estás usando este modo y querés, después lo ajustamos fino
    }
  } catch (err) {
    console.error("[ADM] Error inicializando entrypoint:", err);
    alert("Error inicializando ADM. Mirá Console (F12).");
  }
});
