import { getSessionOrNull } from "./supabaseClient.js";

export function initAuth({ sb, onLoggedIn } = {}) {
  const loginContainer = document.getElementById("loginContainer");
  const admContainer = document.getElementById("admContainer");

  const loginEmail = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");
  const btnLogin = document.getElementById("btnLogin");
  const btnForgot = document.getElementById("btnForgot");
  const loginError = document.getElementById("loginError");

  async function showLoggedOut() {
    if (loginContainer) loginContainer.style.display = "block";
    if (admContainer) admContainer.style.display = "none";
  }

  async function showLoggedIn() {
    if (loginContainer) loginContainer.style.display = "none";
    if (admContainer) admContainer.style.display = "block";
    if (typeof onLoggedIn === "function") await onLoggedIn();
  }

  async function bootSession() {
    const session = await getSessionOrNull(sb);
    if (!session) return showLoggedOut();
    return showLoggedIn();
  }

  function bind() {
    if (btnLogin) {
      btnLogin.addEventListener("click", async () => {
        if (loginError) loginError.style.display = "none";

        const email = (loginEmail?.value || "").trim();
        const password = (loginPassword?.value || "").trim();

        if (!email || !password) {
          if (loginError) {
            loginError.textContent = "Complete email y contraseña";
            loginError.style.display = "block";
          }
          return;
        }

        const { error } = await sb.auth.signInWithPassword({ email, password });

        if (error) {
          if (loginError) {
            loginError.textContent = "Credenciales inválidas";
            loginError.style.display = "block";
          }
          return;
        }

        await showLoggedIn();
      });
    }

    if (btnForgot) {
      btnForgot.addEventListener("click", async () => {
        const email = (loginEmail?.value || "").trim();
        if (!email) return alert("Escribí tu email primero.");

        // primer carpeta del path = nombre del repo en GitHub Pages
        const repoName = location.pathname.split("/")[1] || "";
        const redirectTo = repoName ? `${location.origin}/${repoName}/reset.html` : `${location.origin}/reset.html`;

        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });

        if (error) return alert("Error enviando mail: " + error.message);
        alert("Te enviamos un correo para restablecer la contraseña.");
      });
    }
  }

  return { bind, bootSession };
}
