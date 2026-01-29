// shared/js/dates.js
(function (global) {
  function parseDDMMYYYYToDate(ddmmyyyy) {
    if (!ddmmyyyy) return null;
    const s = String(ddmmyyyy).trim();
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (!m) return null;

    const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

    // Fin del día UTC para que "vence ese día" no quede fuera por huso horario
    const d = new Date(Date.UTC(yyyy, mm - 1, dd, 23, 59, 59));
    if (
      d.getUTCFullYear() !== yyyy ||
      (d.getUTCMonth() + 1) !== mm ||
      d.getUTCDate() !== dd
    ) return null;

    return d;
  }

  function isCaducidadVigente(caducidadStr) {
    if (!caducidadStr) return true;
    const cad = String(caducidadStr).trim().toUpperCase();
    if (cad === "A FINALIZAR") return true;

    const fin = parseDDMMYYYYToDate(caducidadStr);
    if (!fin) return true; // seguridad: si está mal, no filtramos/borramos
    return fin >= new Date();
  }

  function parseVigenciaToDate(vigenciaStr) {
    // ADM usa YYYY-MM-DD (input date)
    if (!vigenciaStr) return null;
    const d = new Date(String(vigenciaStr) + "T00:00:00");
    return isNaN(d.getTime()) ? null : d;
  }

  global.Dates = { parseDDMMYYYYToDate, isCaducidadVigente, parseVigenciaToDate };
})(window);
// shared/js/dates.js
(function (global) {
  function parseDDMMYYYYToDate(ddmmyyyy) {
    if (!ddmmyyyy) return null;
    const s = String(ddmmyyyy).trim();
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (!m) return null;

    const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

    const d = new Date(Date.UTC(yyyy, mm - 1, dd, 23, 59, 59));
    if (
      d.getUTCFullYear() !== yyyy ||
      (d.getUTCMonth() + 1) !== mm ||
      d.getUTCDate() !== dd
    ) return null;

    return d;
  }

  function isCaducidadVigente(caducidadStr) {
    if (!caducidadStr) return true;
    const cad = String(caducidadStr).trim().toUpperCase();
    if (cad === "A FINALIZAR") return true;

    const fin = parseDDMMYYYYToDate(caducidadStr);
    if (!fin) return true;
    return fin >= new Date();
  }

  function parseVigenciaToDate(vigenciaStr) {
    if (!vigenciaStr) return null;
    const d = new Date(String(vigenciaStr) + "T00:00:00");
    return isNaN(d.getTime()) ? null : d;
  }

  global.Dates = { parseDDMMYYYYToDate, isCaducidadVigente, parseVigenciaToDate };
})(window);