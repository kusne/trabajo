// ===== PUENTE GLOBAL (NO SE ROMPE CON DOMContentLoaded NI CON PISADAS) =====
// Mantiene compatibilidad con onclick="agregarOrden()" y onclick="publicarOrdenes()"

export function wireGlobalBridge() {
  window.agregarOrden = function () {
    if (typeof window.__adm_agregarOrden === "function") return window.__adm_agregarOrden();
    alert("Administrador no inicializó agregarOrden. Hacé Ctrl+F5.");
  };

  window.publicarOrdenes = function () {
    if (typeof window.__adm_publicarOrdenes === "function") return window.__adm_publicarOrdenes();
    alert("Administrador no inicializó publicarOrdenes. Hacé Ctrl+F5.");
  };
}
