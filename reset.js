// ===== IMPORT SUPABASE (ESM) =====
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===== CONFIG =====
const SUPABASE_URL = "https://ugeydxozfewzhldjbkat.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ZeLC2rOxhhUXlQdvJ28JkA_qf802-pX";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log("reset.js cargado");

function getRepoBase() {
  // https://kusne.github.io/<repo>/...
  const repoName = location.pathname.split("/")[1] || "";
  return `${location.origin}/${repoName}/`;
}

function leerTokens() {
  // 1) Intentar desde HASH (formato clásico: #access_token=...&refresh_token=...)
  const hash = (window.location.hash || "").replace(/^#/, "");
  if (hash) {
    const p = new URLSearchParams(hash);
    const access_token = p.get("access_token");
    const refresh_token = p.get("refresh_token");
    if (access_token && refresh_token) return { access_token, refresh_token };
  }

  // 2) Fallback: querystring (por si llega ?access_token=... o ?token=...&type=recovery)
  const q = new URLSearchParams(window.location.search || "");
  const access_token_q = q.get("access_token");
  const refresh_token_q = q.get("refresh_token");
  if (access_token_q && refresh_token_q) return { access_token: access_token_q, refresh_token: refresh_token_q };

  return null;
}

document.addEventListener("DOMContentLoaded", async () => {
  // ============================
  // 1️⃣ LEER TOKENS
  // ============================
  const tokens = leerTokens();

  if (!tokens) {
    alert("Link de recuperación inválido o vencido");
    return;
  }

  // ============================
  // 2️⃣ INYECTAR SESIÓN
  // ============================
  const { error: sessionError } = await supabase.auth.setSession(tokens);

  if (sessionError) {
    alert("Error estableciendo sesión");
    console.error(sessionError);
    return;
  }

  console.log("Sesión recovery establecida");

  // ============================
  // 3️⃣ DOM
  // ============================
  const btn = document.getElementById("btnSavePassword");
  const input = document.getElementById("newPassword");

  if (!btn || !input) {
    alert("Formulario incompleto");
    return;
  }

  // ============================
  // 4️⃣ BOTÓN GUARDAR
  // ============================
  btn.addEventListener("click", async () => {
    const password = input.value.trim();

    if (password.length < 6) {
      alert("La contraseña debe tener al menos 6 caracteres");
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      alert("Error guardando contraseña: " + error.message);
      console.error(error);
      return;
    }

    alert("Contraseña actualizada correctamente");

    // ============================
    // 5️⃣ REDIRIGIR AL administrador (repo actual + estructura nueva)
    // ============================
    window.location.href = getRepoBase() + "administrador/administrador.html";
  });
});
