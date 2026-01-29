// shared/js/storage.js
(function (global) {
  const KEYS = {
    ORDENES: "ordenes",
  };

  function getJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function setJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function cargarOrdenes() {
    return getJSON(KEYS.ORDENES, []);
  }

  function guardarOrdenes(ordenes) {
    setJSON(KEYS.ORDENES, Array.isArray(ordenes) ? ordenes : []);
  }

  global.StorageApp = { KEYS, getJSON, setJSON, cargarOrdenes, guardarOrdenes };
})(window);

