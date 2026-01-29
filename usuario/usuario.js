// ===== CONFIG SUPABASE (SOLO LECTURA WSP) =====
const SUPABASE_URL = "https://ugeydxozfewzhldjbkat.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ZeLC2rOxhhUXlQdvJ28JkA_qf802-pX";

(function () {
  // ===== DOM refs =====
  const selTipo = document.getElementById("tipo");
  const selOrden = document.getElementById("orden");
  const selHorario = document.getElementById("horario");

  const divFinaliza = document.getElementById("finaliza");
  const divDetalles = document.getElementById("bloqueDetalles");

  const divMismosElementos = document.getElementById("bloqueMismosElementos");
  const chkMismosElementos = document.getElementById("mismosElementos");
  const btnEnviar = document.getElementById("btnEnviar");

  // ===== Estado =====
  let ordenSeleccionada = null;
  let franjaSeleccionada = null;
  let syncingOrdenes = false;

  // Cache en memoria (respaldo si StorageApp no está o no guarda/lee como se espera)
  let ordenesCache = [];
  function guardarOrdenesSeguro(arr) {
    ordenesCache = Array.isArray(arr) ? arr : [];
    try {
      StorageApp && StorageApp.guardarOrdenes && StorageApp.guardarOrdenes(ordenesCache);
    } catch (e) {
      console.warn("[WSP] No se pudo guardar en StorageApp, uso cache en memoria.", e);
    }
  }
  function cargarOrdenesSeguro() {
    try {
      const arr = StorageApp && StorageApp.cargarOrdenes && StorageApp.cargarOrdenes();
      if (Array.isArray(arr)) return arr;
    } catch (e) {
      console.warn("[WSP] No se pudo leer de StorageApp, uso cache en memoria.", e);
    }
    return Array.isArray(ordenesCache) ? ordenesCache : [];
  }

  // ======================================================
  // ===== LECTURA DESDE SUPABASE (FUENTE REAL) ============
  // ======================================================
  async function syncOrdenesDesdeServidor() {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/ordenes_store?select=payload&order=updated_at.desc&limit=1`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Accept: "application/json",
          },
        }
      );

      if (!r.ok) {
        console.error("[WSP] Supabase REST error:", r.status, await r.text());
        return false;
      }

      const data = await r.json();
      if (!Array.isArray(data) || !Array.isArray(data[0]?.payload)) return false;

      // ✅ payload ES el array de órdenes
      guardarOrdenesSeguro(data[0].payload);
      return true;
    } catch (e) {
      console.error("Error leyendo Supabase:", e);
      return false;
    }
  }

  async function syncAntesDeSeleccion() {
    if (syncingOrdenes) return;
    syncingOrdenes = true;

    const ok = await syncOrdenesDesdeServidor();
    if (ok) {
      cargarOrdenesDisponibles();
      limpiarSeleccionOrden();
    }

    syncingOrdenes = false;
  }

  // ===== UI =====
  function limpiarSeleccionOrden() {
    ordenSeleccionada = null;
    franjaSeleccionada = null;
    selOrden.value = "";
    selHorario.innerHTML = '<option value="">Seleccionar horario</option>';
  }

  // ===== Guardia =====
  function getGuardiaInicio() {
    const now = new Date();
    const start = new Date(now);
    start.setHours(6, 0, 0, 0);
    if (now < start) start.setDate(start.getDate() - 1);
    return start;
  }

  function extraerHoraInicio(h) {
    const s = String(h || "").toLowerCase();

    // Buscar hh:mm primero
    let m = s.match(/(\d{1,2})\s*:\s*\d{2}/);
    if (m) {
      const n = parseInt(m[1], 10);
      return n >= 0 && n <= 23 ? n : null;
    }

    // Buscar primer hora "al inicio" o después de palabras típicas
    m = s.match(/(?:^|desde|de|horario|hs|h|a\s+las)\s*(\d{1,2})\b/);
    if (m) {
      const n = parseInt(m[1], 10);
      return n >= 0 && n <= 23 ? n : null;
    }

    // Fallback: primer número del string
    m = s.match(/\b(\d{1,2})\b/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return n >= 0 && n <= 23 ? n : null;
  }

  function franjaEnGuardia(h) {
    const hi = extraerHoraInicio(h);
    if (hi === null) return true;

    const inicio = getGuardiaInicio();
    const fin = new Date(inicio.getTime() + 86400000);
    const f = new Date(inicio);
    f.setHours(hi, 0, 0, 0);
    if (f < inicio) f.setDate(f.getDate() + 1);
    return f >= inicio && f < fin;
  }

  function parseVigenciaFlexible(v) {
    // 1) intentar con el parser existente
    try {
      const d = Dates?.parseVigenciaToDate?.(v);
      if (d instanceof Date && !isNaN(d)) return d;
    } catch {}

    // 2) aceptar YYYY-MM-DD
    const iso = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

    // 3) aceptar DD/MM/YYYY
    const latam = String(v || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (latam) return new Date(Number(latam[3]), Number(latam[2]) - 1, Number(latam[1]));

    return null;
  }

  function cargarOrdenesDisponibles() {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    let ordenes = OrdersSync.filtrarCaducadas(cargarOrdenesSeguro());
    guardarOrdenesSeguro(ordenes);

    selOrden.innerHTML = '<option value="">Seleccionar</option>';

    ordenes.forEach((o, i) => {
      const v = parseVigenciaFlexible(o.vigencia);
      if (!v || v > hoy) return;
      if (!o.franjas?.some((f) => franjaEnGuardia(f.horario))) return;

      const op = document.createElement("option");
      op.value = i;
      op.text = `${o.num} ${o.textoRef || ""}`.trim();
      selOrden.appendChild(op);
    });
  }

  function cargarHorariosOrden() {
    ordenSeleccionada = null;
    franjaSeleccionada = null;

    const ordenes = cargarOrdenesSeguro();
    const idx = Number(selOrden.value);
    if (!ordenes[idx]) return;

    ordenSeleccionada = ordenes[idx];
    selHorario.innerHTML = '<option value="">Seleccionar horario</option>';

    ordenSeleccionada.franjas.forEach((f, i) => {
      if (franjaEnGuardia(f.horario)) {
        const o = document.createElement("option");
        o.value = i;
        o.text = f.horario;
        selHorario.appendChild(o);
      }
    });
  }

  function actualizarDatosFranja() {
    if (!ordenSeleccionada) return;
    franjaSeleccionada = ordenSeleccionada.franjas[Number(selHorario.value)] || null;

    // ✅ Defaults desde Guardia activa por LUGAR (solo si el usuario todavía no seleccionó nada)
    if (franjaSeleccionada?.lugar && window.GuardiaSync?.aplicarDefaultsPorLugar) {
      GuardiaSync.aplicarDefaultsPorLugar(franjaSeleccionada.lugar, { soloSiVacio: true })
        .then((r) => {
          if (r?.ok) console.log("[WSP] Defaults guardia aplicados:", r.patrullas);
        })
        .catch((e) => console.warn("[WSP] GuardiaSync error:", e));
    }
  }

  function actualizarTipo() {
    const fin = selTipo.value === "FINALIZA";

    divFinaliza.classList.toggle("hidden", !fin);
    divDetalles.classList.toggle("hidden", !fin);

    // mostrar/ocultar el bloque del checkbox
    if (divMismosElementos) divMismosElementos.classList.toggle("hidden", !fin);

    if (!fin) {
      // INICIA: checkbox off y elementos visibles
      if (chkMismosElementos) chkMismosElementos.checked = false;
      setElementosVisibles(true);
      return;
    }

    // FINALIZA: por defecto, intentar usar “mismos elementos”
    const payload = cargarElementosGuardados?.() || null;

    if (chkMismosElementos) chkMismosElementos.checked = !!payload;

    if (payload) {
      aplicarElementos(payload);
      setElementosVisibles(false); // ocultar elementos
    } else {
      setElementosVisibles(true); // no hay guardado -> deja seleccionar manual
    }
  }

  // ======================================================
  // ===== SELECCIONES (CLAVE) ============================
  // ======================================================
  function seleccion(clase) {
    return Array.from(document.querySelectorAll("." + clase + ":checked"))
      .map((e) => e.value)
      .join("\n");
  }

  function seleccionLinea(clase, sep) {
    const v = Array.from(document.querySelectorAll("." + clase + ":checked")).map((e) => e.value);
    return v.length ? v.join(" " + sep + " ") : "/";
  }

  function leerSeleccionPorClase(clase) {
    return Array.from(document.querySelectorAll("." + clase + ":checked")).map((e) => e.value);
  }

  function lineaDesdeArray(arr, sep) {
    const v = Array.isArray(arr) ? arr : [];
    return v.length ? v.join(" " + sep + " ") : "/";
  }

  // ======================================================
  // ===== NORMALIZADORES DE SALIDA (SOLO WSP) ============
  // ======================================================
  function normalizarTextoWhatsApp(texto) {
    return texto
      .toLowerCase()
      .replace(/[*_\-•—–]/g, "")
      .replace(/[.]{2,}/g, ".")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/(^|\n|\.\s+)([a-záéíóúñ])/g, (m, p1, p2) => p1 + p2.toUpperCase())
      .trim();
  }

  function normalizarTituloOperativo(txt) {
    if (!txt) return "";

    let t = txt.toLowerCase().trim();

    // Capitalizar palabras
    t = t.replace(/\b\w/g, (l) => l.toUpperCase());

    // Normalizar OP
    t = t.replace(/\b(o\.?\s*op\.?|op)\s*0*(\d+\/\d+)\b/i, "O.Op. $2");

    return t;
  }

  function normalizarLugar(txt) {
    if (!txt) return "";
    return txt.toLowerCase().trim().replace(/\b\w/g, (l) => l.toUpperCase());
  }

  function normalizarHorario(txt) {
    if (!txt) return "";

    let t = txt.toLowerCase().replace(/\s+/g, " ").trim();

    // Solo Finalizar con mayúscula
    t = t.replace(/\bfinalizar\b/g, "Finalizar");

    return t;
  }

  function setElementosVisibles(visible) {
    const ids = ["bloqueEscopeta", "bloqueHT", "bloquePDA", "bloqueImpresora", "bloqueAlometro", "bloqueAlcoholimetro"];

    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle("hidden", !visible);
    });
  }

  function resetUI() {
    // estado interno
    ordenSeleccionada = null;
    franjaSeleccionada = null;

    // selects
    selTipo.value = "";
    selOrden.value = "";
    selHorario.innerHTML = '<option value="">Seleccionar horario</option>';

    // checkboxes
    document.querySelectorAll('input[type="checkbox"]').forEach((c) => (c.checked = false));

    // inputs numéricos y textos
    document.querySelectorAll('input[type="number"], input[type="text"], textarea').forEach((i) => (i.value = ""));

    // observaciones default
    const obs = document.getElementById("obs");
    if (obs) obs.value = "";

    // ocultar bloques dependientes
    divFinaliza.classList.add("hidden");
    divDetalles.classList.add("hidden");
    // reset “mismos elementos” + visibilidad
    if (chkMismosElementos) chkMismosElementos.checked = false;
    if (divMismosElementos) divMismosElementos.classList.add("hidden");
    setElementosVisibles(true);
  }

  // ======================================================
  // ===== PASOS 2, 3 y 4: “mismos elementos” =============
  // 2) Guardar elementos al enviar INICIA
  // 3) Checkbox en FINALIZA: si tildado, cargar elementos guardados
  // 4) En FINALIZA, imprimir elementos guardados si está tildado
  // ======================================================

  function guardarElementosDeInicio() {
    const payload = {
      ts: Date.now(),
      ESCOPETA: leerSeleccionPorClase("ESCOPETA"),
      HT: leerSeleccionPorClase("HT"),
      PDA: leerSeleccionPorClase("PDA"),
      IMPRESORA: leerSeleccionPorClase("IMPRESORA"),
      Alometro: leerSeleccionPorClase("Alometro"),
      Alcoholimetro: leerSeleccionPorClase("Alcoholimetro"),
    };

    // 1) Si existe StorageApp y tiene la función, usalo
    try {
      if (typeof StorageApp !== "undefined" && typeof StorageApp.guardarElementosInicio === "function") {
        StorageApp.guardarElementosInicio(payload);
        return;
      }
    } catch (e) {
      console.warn("[WSP] Error guardando en StorageApp, uso localStorage.", e);
    }

    // 2) Fallback seguro: localStorage
    try {
      localStorage.setItem("elementos_inicio", JSON.stringify(payload));
    } catch (e) {
      console.warn("[WSP] No se pudo guardar en localStorage.", e);
    }
  }

  function cargarElementosGuardados() {
    try {
      const p = StorageApp?.cargarElementosInicio?.();
      if (p) return p;
    } catch {}

    try {
      return JSON.parse(localStorage.getItem("elementos_inicio") || "null");
    } catch {
      return null;
    }
  }

  function limpiarSeleccionElementos() {
    const clases = ["ESCOPETA", "HT", "PDA", "IMPRESORA", "Alometro", "Alcoholimetro"];
    clases.forEach((clase) => {
      document.querySelectorAll("." + clase).forEach((inp) => {
        inp.checked = false;
      });
    });
  }

  function aplicarElementos(payload) {
    if (!payload) return;

    const map = {
      ESCOPETA: payload.ESCOPETA,
      HT: payload.HT,
      PDA: payload.PDA,
      IMPRESORA: payload.IMPRESORA,
      Alometro: payload.Alometro,
      Alcoholimetro: payload.Alcoholimetro,
    };

    Object.keys(map).forEach((clase) => {
      const wanted = new Set(Array.isArray(map[clase]) ? map[clase] : []);
      const inputs = Array.from(document.querySelectorAll("." + clase));

      // deja exactamente lo guardado
      inputs.forEach((inp) => {
        inp.checked = wanted.has(inp.value);
      });
    });
  }

  if (chkMismosElementos) {
    chkMismosElementos.addEventListener("change", () => {
      // ✅ SI DESTILDA: modo manual + limpiar selección
      if (!chkMismosElementos.checked) {
        limpiarSeleccionElementos();
        setElementosVisibles(true);
        return;
      }

      // si tilda: cargar guardados + ocultar
      const payload = cargarElementosGuardados();
      if (!payload) {
        alert("No hay elementos guardados del INICIA.");
        chkMismosElementos.checked = false;
        limpiarSeleccionElementos();
        setElementosVisibles(true);
        return;
      }

      aplicarElementos(payload);
      setElementosVisibles(false);
    });
  }

  // ===== ENVIAR A WHATSAPP =====
  function enviar() {
    if (!ordenSeleccionada || !franjaSeleccionada) return;

    if (!seleccion("personal")) {
      alert("Debe seleccionar personal policial.");
      return;
    }

    // MÓVILES: obligatorios SIEMPRE (motos cuentan como móviles)
    const mov = seleccionLinea("movil", "/");
    const mot = seleccionLinea("moto", "/");
    if (mov === "/" && mot === "/") {
      alert("Debe seleccionar al menos un móvil o moto.");
      return;
    }

    const esFinaliza = selTipo.value === "FINALIZA";
    const usarMismosElementos = esFinaliza && !!chkMismosElementos?.checked;

    // Si en FINALIZA tilda “mismos elementos”, debe existir guardado del INICIA
    let elementosInicio = null;
    if (usarMismosElementos) {
      elementosInicio = cargarElementosGuardados();
      if (!elementosInicio) {
        alert("No hay elementos guardados del INICIA. Destilde “mismos elementos” o envíe primero un INICIA.");
        return;
      }
    }

    const fecha = new Date().toLocaleDateString("es-AR");

    let bloqueResultados = "";
    let textoDetalles = "";

    // ⬇️ SOLO si es FINALIZA agregamos los numerales
    if (esFinaliza) {
      const vehiculos = document.getElementById("vehiculos")?.value || 0;
      const personas = document.getElementById("personas")?.value || 0;
      const testalom = document.getElementById("testalom")?.value || 0;
      const alco = document.getElementById("Alcotest")?.value || 0;
      const posSan = document.getElementById("positivaSancionable")?.value || 0;
      const posNo = document.getElementById("positivaNoSancionable")?.value || 0;
      const actas = document.getElementById("actas")?.value || 0;
      const requisa = document.getElementById("Requisa")?.value || 0;
      const qrz = document.getElementById("qrz")?.value || 0;
      const dominio = document.getElementById("dominio")?.value || 0;

      const remision = document.getElementById("Remision")?.value || 0;
      const retencion = document.getElementById("Retencion")?.value || 0;
      const prohibicion = document.getElementById("Prohibicion")?.value || 0;
      const cesion = document.getElementById("Cesion")?.value || 0;

      bloqueResultados = `Resultados:
Vehículos Fiscalizados: (${vehiculos})
Personas Identificadas: (${personas})
Test de Alómetro: (${testalom})
Test de Alcoholímetro: (${alco})
Positiva Sancionable: (${posSan})
Positiva no Sancionable: (${posNo})
Actas Labradas: (${actas})
Requisas: (${requisa})
Qrz: (${qrz})
Dominio: (${dominio})
Medidas Cautelares:
Remisión: (${remision})
Retención: (${retencion})
Prohibición de Circulación: (${prohibicion})
Cesión de Conducción: (${cesion})
`;

      const detallesTexto = document.getElementById("detalles")?.value?.trim();
      if (detallesTexto) {
        textoDetalles = `Detalles:
${detallesTexto}
`;
      }
    }

    // ===== Elementos (según modo) =====
    const escopetasTXT = usarMismosElementos
      ? lineaDesdeArray(elementosInicio.ESCOPETA, "/")
      : seleccionLinea("ESCOPETA", "/");
    const htTXT = usarMismosElementos ? lineaDesdeArray(elementosInicio.HT, "/") : seleccionLinea("HT", "/");
    const pdaTXT = usarMismosElementos ? lineaDesdeArray(elementosInicio.PDA, "/") : seleccionLinea("PDA", "/");
    const impTXT = usarMismosElementos
      ? lineaDesdeArray(elementosInicio.IMPRESORA, "/")
      : seleccionLinea("IMPRESORA", "/");
    const alomTXT = usarMismosElementos
      ? lineaDesdeArray(elementosInicio.Alometro, "/")
      : seleccionLinea("Alometro", "/");
    const alcoTXT = usarMismosElementos
      ? lineaDesdeArray(elementosInicio.Alcoholimetro, "/")
      : seleccionLinea("Alcoholimetro", "/");

    // ===== Texto principal =====
    const texto = `Policia de la Provincia de Santa Fe - Guardia Provincial
Brigada Motorizada Centro Norte
Tercio Charly

${selTipo.value.charAt(0) + selTipo.value.slice(1).toLowerCase()} ${normalizarTituloOperativo(
      franjaSeleccionada.titulo
    )} ${ordenSeleccionada.num}

Fecha: ${fecha}
Horario: ${normalizarHorario(franjaSeleccionada.horario)}
Lugar: ${normalizarLugar(franjaSeleccionada.lugar)}

Personal Policial:
${seleccion("personal")}

Móviles: ${[seleccionLinea("movil", "/"), seleccionLinea("moto", "/")].filter((v) => v !== "/").join(" / ") || "/"}

Elementos:
Escopetas: ${escopetasTXT}
Ht: ${htTXT}
Pda: ${pdaTXT}
Impresoras: ${impTXT}
Alómetros: ${alomTXT}
Alcoholímetros: ${alcoTXT}
${bloqueResultados}
${textoDetalles}
Observaciones:
${document.getElementById("obs")?.value || "Sin novedad"}`;

    const textoFinal = texto.replace(/\n{3,}/g, "\n\n");

    // ===== PASO 2: guardar elementos SOLO al enviar INICIA =====
    if (selTipo.value === "INICIA") {
      guardarElementosDeInicio();
    }

    // 🔹 RESET DE LA UI
    resetUI();

    // 🔹 ENVÍO A WHATSAPP
    setTimeout(() => {
      window.location.href = "https://wa.me/?text=" + encodeURIComponent(textoFinal);
    }, 0);
  }

  // ===== Eventos =====
  selOrden.addEventListener("focus", syncAntesDeSeleccion);
  selOrden.addEventListener("change", cargarHorariosOrden);
  selHorario.addEventListener("change", actualizarDatosFranja);
  selTipo.addEventListener("change", actualizarTipo);
  btnEnviar.addEventListener("click", enviar);

  // ===== Init =====
  (async function init() {
    actualizarTipo();
    await syncOrdenesDesdeServidor();
    const _tmp = cargarOrdenesSeguro();
    console.log("[WSP] Órdenes en memoria/Storage:", Array.isArray(_tmp) ? _tmp.length : _tmp);
    cargarOrdenesDisponibles();
  })();
})();










