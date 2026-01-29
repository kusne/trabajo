// shared/js/caducidadFinalizar.js
(function (global) {
  /**
   * Sincroniza:
   * - checkbox ON => input = "A FINALIZAR" y readOnly
   * - checkbox OFF => input editable y vacío
   * - input escrito manualmente "A FINALIZAR" => checkbox ON y readOnly
   */
  function bindAFinalizar({ checkboxEl, inputEl }) {
    if (!checkboxEl || !inputEl) return;

    checkboxEl.addEventListener("change", () => {
      if (checkboxEl.checked) {
        inputEl.value = "A FINALIZAR";
        inputEl.readOnly = true;
      } else {
        inputEl.readOnly = false;
        inputEl.value = "";
      }
    });

    inputEl.addEventListener("input", () => {
      const v = (inputEl.value || "").trim().toUpperCase();
      if (v === "A FINALIZAR") {
        checkboxEl.checked = true;
        inputEl.readOnly = true;
      } else if (checkboxEl.checked) {
        checkboxEl.checked = false;
        inputEl.readOnly = false;
      }
    });
  }

  global.CaducidadFinalizar = { bindAFinalizar };
})(window);