// shared/js/ordersSync.js
(function (global) {
  // Aplica un "paquete" importado al estado actual:
  // - Si viene {__ELIMINAR__: "NUM"} => elimina por num
  // - Si viene {num, franjas[]} => upsert por num
  function mergeImportedOrders(currentOrders, importedArray) {
    let ordenes = Array.isArray(currentOrders) ? [...currentOrders] : [];

    if (!Array.isArray(importedArray)) return ordenes;

    importedArray.forEach(item => {
      if (!item || typeof item !== "object") return;

      if (item.__ELIMINAR__) {
        const numEliminar = String(item.__ELIMINAR__).trim();
        ordenes = ordenes.filter(o => o && o.num !== numEliminar);
        return;
      }

      if (!item.num || !Array.isArray(item.franjas)) return;

      const idx = ordenes.findIndex(o => o && o.num === item.num);
      if (idx >= 0) ordenes[idx] = item;
      else ordenes.push(item);
    });

    return ordenes;
  }

  // Filtra caducadas según Dates.isCaducidadVigente
  function filtrarCaducadas(ordenes) {
    if (!Array.isArray(ordenes)) return [];
    return ordenes.filter(o => o && global.Dates.isCaducidadVigente(o.caducidad));
  }

  global.OrdersSync = { mergeImportedOrders, filtrarCaducadas };
})(window);
// shared/js/ordersSync.js
(function (global) {
  function mergeImportedOrders(currentOrders, importedArray) {
    let ordenes = Array.isArray(currentOrders) ? [...currentOrders] : [];
    if (!Array.isArray(importedArray)) return ordenes;

    importedArray.forEach(item => {
      if (!item || typeof item !== "object") return;

      if (item.__ELIMINAR__) {
        const numEliminar = String(item.__ELIMINAR__).trim();
        ordenes = ordenes.filter(o => o && o.num !== numEliminar);
        return;
      }

      if (!item.num || !Array.isArray(item.franjas)) return;

      const idx = ordenes.findIndex(o => o && o.num === item.num);
      if (idx >= 0) ordenes[idx] = item;
      else ordenes.push(item);
    });

    return ordenes;
  }

  function filtrarCaducadas(ordenes) {
    if (!Array.isArray(ordenes)) return [];
    return ordenes.filter(o => o && global.Dates.isCaducidadVigente(o.caducidad));
  }

  global.OrdersSync = { mergeImportedOrders, filtrarCaducadas };
})(window);