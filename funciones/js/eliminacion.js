// shared/js/deletions.js
(function (global) {
  function cargarEliminaciones() {
    return StorageApp.getJSON(StorageApp.KEYS.ELIMINACIONES, []);
  }

  function guardarEliminaciones(arr) {
    StorageApp.setJSON(StorageApp.KEYS.ELIMINACIONES, Array.isArray(arr) ? arr : []);
  }

  function registrarEliminacion(numOrden) {
    const n = String(numOrden || "").trim();
    if (!n) return;
    const actuales = cargarEliminaciones();
    actuales.push({ "__ELIMINAR__": n });
    guardarEliminaciones(actuales);
  }

  function resetEliminaciones() {
    guardarEliminaciones([]);
  }

  global.Deletions = { cargarEliminaciones, guardarEliminaciones, registrarEliminacion, resetEliminaciones };
})(window);