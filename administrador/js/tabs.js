// ======================================================
// Tabs principales (Órdenes / Guardia / Inventario / Libro)
// ======================================================

export function initTabs({ onGuardiaActivate } = {}) {
  const tabBtns = Array.from(document.querySelectorAll(".tab-btn"));

  const tabPanels = {
    ordenes: document.getElementById("tab-ordenes"),
    guardia: document.getElementById("tab-guardia"),
    inventario: document.getElementById("tab-inventario"),
    libro: document.getElementById("tab-libro"), // ✅ agregado
  };

  function activarTab(nombre) {
    // si piden un tab que no existe, caemos a ordenes
    if (!tabPanels[nombre]) nombre = "ordenes";

    tabBtns.forEach((b) => b.classList.toggle("is-active", b.dataset.tab === nombre));
    Object.keys(tabPanels).forEach((k) => tabPanels[k]?.classList.toggle("is-active", k === nombre));

    if (nombre === "guardia" && typeof onGuardiaActivate === "function") {
      onGuardiaActivate();
    }
  }

  tabBtns.forEach((b) => b.addEventListener("click", () => activarTab(b.dataset.tab)));

  // ✅ helpers para entrypoint (evita tabs.show undefined)
  function show() {
    const admContainer = document.getElementById("admContainer");
    const loginContainer = document.getElementById("loginContainer");
    if (loginContainer) loginContainer.style.display = "none";
    if (admContainer) admContainer.style.display = "block";
  }

  function hide() {
    const admContainer = document.getElementById("admContainer");
    const loginContainer = document.getElementById("loginContainer");
    if (admContainer) admContainer.style.display = "none";
    if (loginContainer) loginContainer.style.display = "block";
  }

  return { activarTab, show, hide };
}
