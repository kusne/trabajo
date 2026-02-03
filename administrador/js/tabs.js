// ======================================================
// Tabs principales (Órdenes / Guardia / Inventario)
// ======================================================

export function initTabs({ onGuardiaActivate } = {}) {
  const tabBtns = Array.from(document.querySelectorAll(".tab-btn"));
  const tabPanels = {
    ordenes: document.getElementById("tab-ordenes"),
    guardia: document.getElementById("tab-guardia"),
    inventario: document.getElementById("tab-inventario"),
  };

  function activarTab(nombre) {
    tabBtns.forEach((b) => b.classList.toggle("is-active", b.dataset.tab === nombre));
    Object.keys(tabPanels).forEach((k) => tabPanels[k]?.classList.toggle("is-active", k === nombre));

    if (nombre === "guardia" && typeof onGuardiaActivate === "function") {
      onGuardiaActivate();
    }
  }

  tabBtns.forEach((b) => b.addEventListener("click", () => activarTab(b.dataset.tab)));

  return { activarTab };
}
