// shared/js/uiValidation.js
(function (global) {
  function validarSelect(selectEl) {
    if (!selectEl) return;
    selectEl.classList.toggle("obligatorio", !selectEl.value);
  }

  function validarCheckboxGrupo(claseCheckbox, idBloque) {
    const checks = document.querySelectorAll("." + claseCheckbox + ":checked");
    const bloque = document.getElementById(idBloque);
    if (!bloque) return;
    if (checks.length > 0) bloque.classList.remove("obligatorio");
    else bloque.classList.add("obligatorio");
  }

  global.UIValidation = { validarSelect, validarCheckboxGrupo };
})(window);