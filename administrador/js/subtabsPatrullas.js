// ======================================================
// SUBSOLAPAS GUARDIA: Patrulla 1 / Patrulla 2
// - Delegación de eventos (no se pierde)
// - Fuerza display con !important
// - Levanta disabled si por algún motivo lo pusieron
// ======================================================

export function createSubtabsPatrullas() {
  let active = "p1";
  let hooked = false;

  function refs() {
    const guardiaPanel = document.getElementById("tab-guardia");
    const btns = Array.from(document.querySelectorAll('.subtab-btn[data-subtab]'));
    const p1 = document.getElementById("patrulla-p1");
    const p2 = document.getElementById("patrulla-p2");
    return { guardiaPanel, btns, p1, p2 };
  }

  function forceDisplay(el, show) {
    if (!el) return;
    el.classList.toggle("is-active", !!show);
    el.style.setProperty("display", show ? "block" : "none", "important");
  }

  function setActive(key, { save = true } = {}) {
    const k = (key === "p2") ? "p2" : "p1";
    active = k;

    const { btns, p1, p2 } = refs();

    // Blindaje: si Patrulla 2 quedó disabled por algo externo, lo levantamos
    btns.forEach((b) => {
      const sk = b.getAttribute("data-subtab");
      if (sk === "p2") b.disabled = false;
    });

    btns.forEach((b) => {
      b.classList.toggle("is-active", b.getAttribute("data-subtab") === k);
    });

    forceDisplay(p1, k === "p1");
    forceDisplay(p2, k === "p2");

    if (save) {
      try { localStorage.setItem("adm_patrulla_activa", k); } catch { }
    }
  }

  function boot() {
    const { btns, p1, p2 } = refs();
    if (!btns.length || (!p1 && !p2)) return;

    let last = "p1";
    try { last = localStorage.getItem("adm_patrulla_activa") || "p1"; } catch { }
    setActive(last, { save: false });

    if (!hooked) {
      document.addEventListener("click", (e) => {
        const btn = e.target.closest('.subtab-btn[data-subtab]');
        if (!btn) return;
        if (btn.disabled) return;
        setActive(btn.getAttribute("data-subtab"), { save: true });
      });
      hooked = true;
    }
  }

  function apply() {
    setActive(active, { save: false });
  }

  function getActive() { return active; }

  return { boot, apply, setActive, getActive };
}
