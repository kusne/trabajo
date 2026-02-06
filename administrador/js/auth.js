// administrador/js/auth.js
import { getSessionOrNull } from "./supabaseClient.js";

export function initAuth({ sb } = {}) {
  const loginContainer = document.getElementById("loginContainer");
  const admContainer = document.getElementById("admContainer");

  const loginEmail = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");
  const btnLogin = document.getElementById("btnLogin");
  const btnForgot = document.getElementById("btnForgot");
  const loginError = document.getElementById("loginError");
  const btnLogout = document.getElementById("btnLogout");

  function showLoggedOut() {
    if (loginContainer) loginContainer.style.display = "block";
    if (admContainer) admContainer.style.display = "none";
  }

  async function showLoggedIn(onLoggedIn) {
    if (loginContainer) loginContainer.style.display = "none";
    if (admContainer) admContainer.style.display = "block";
    if (typeof onLoggedIn === "function") await onLoggedIn();
  }

  function bindForgot() {
    if (!btnForgot) return;

    btnForgot.addEventListener("click", async () => {
      const email = (loginEmail?.value || "").trim();
      if (!email) return alert("Escribí tu email primero.");

      // repo name (GitHub Pages) = primer segmento del path
      const repoName = location.pathname.split("/")[1] || "";
      const redirectTo = repoName
        ? `${location.origin}/${repoName}/reset.html`
        : `${location.origin}/reset.html`;

      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) return alert("Error enviando mail: " + error.message);

      alert("Te enviamos un correo para restablecer la contraseña.");
    });
  }

  function bindLogout(onLoggedOut) {
    if (!btnLogout) return;

    btnLogout.addEventListener("click", async () => {
      await sb.auth.signOut();
      if (typeof onLoggedOut === "function") onLoggedOut();
      showLoggedOut();
    });
  }

  function bindLogin(onLoggedIn) {
    if (!btnLogin) return;

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

      await showLoggedIn(onLoggedIn);
    });
  }

  async function bootSession(onLoggedIn) {
    const session = await getSessionOrNull(sb);
    if (!session) {
      showLoggedOut();
      return;
    }
    await showLoggedIn(onLoggedIn);
  }

  return {
    async init({ onLoggedIn, onLoggedOut } = {}) {
      bindLogin(onLoggedIn);
      bindForgot();
      bindLogout(onLoggedOut);
      await bootSession(onLoggedIn);
    },
  };
}
