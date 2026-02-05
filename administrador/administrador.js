import { createSbClient } from "../funciones/js/supabaseClient.js";
import { initAuth } from "./js/auth.js";
import { initTabs } from "./js/tabs.js";
import { initOrdenes } from "./js/ordenes.js";
import { initGuardia } from "./js/guardia.js";
import { initInventario } from "./js/inventario.js";
import { initLibroMemorandum } from "./js/libroMemorandum.js";

const sb = createSbClient();

document.addEventListener("DOMContentLoaded", async () => {
  const auth = initAuth({ sb });
  const tabs = initTabs({ defaultTab: "ordenes" });

  const ordenes = initOrdenes({ sb });
  const guardia = initGuardia({ sb });
  const inventario = initInventario({ sb });
  const libro = initLibroMemorandum({ sb });

  ordenes.bind();
  guardia.bind();
  inventario.bind();
  libro.bind();

  await auth.init({
    onLoggedIn: async () => {
      tabs.show();

      await ordenes.init();
      await inventario.init();
      await guardia.init({ invLoad: inventario.invLoad });
      await libro.init();
    },
    onLoggedOut: () => {
      tabs.hide();
    },
  });
});
