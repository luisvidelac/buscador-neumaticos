export async function buscarLeon(page, itemBusqueda) {
  const proveedor = "Leon";

  const medida =
    typeof itemBusqueda === "string" ? itemBusqueda : itemBusqueda.medida;

  const fabricante =
    typeof itemBusqueda === "string" ? "" : itemBusqueda.fabricante || "";

  const extraerMedida = (valor = "") => {
    const texto = String(valor).toUpperCase();
    const match = texto.match(/(\d{3})\/(\d{2})\s*R(\d{2})/);

    if (!match) return null;

    return {
      ancho: match[1],
      perfil: match[2],
      aro: match[3],
      medidaTexto: `${match[1]}/${match[2]} R${match[3]}`,
    };
  };

  const datosMedida = extraerMedida(medida);

  if (!datosMedida) {
    console.log("Leon: no se pudo extraer medida:", medida);
    return [];
  }

  // La búsqueda de Leon depende de geolocalización para detectar la tienda
  // más cercana (necesaria para habilitar el botón Buscar), por lo que se
  // otorgan permisos de geolocalización fijos en Santiago antes de navegar.
  const abrirYSeleccionar = async (valor) => {
    return page.evaluate((valor) => {
      const listas = Array.from(document.querySelectorAll("ul.select-list"));
      for (const lista of listas) {
        const opcion = Array.from(lista.querySelectorAll("li")).find(
          (li) => li.textContent.trim() === valor
        );
        if (opcion) {
          opcion.click();
          return true;
        }
      }
      return false;
    }, valor);
  };

  try {
    console.log("Leon paso 1: otorgando geolocalización y entrando a home");

    await page
      .context()
      .grantPermissions(["geolocation"], { origin: "https://leon.cl" });
    await page
      .context()
      .setGeolocation({ latitude: -33.4489, longitude: -70.6693 });

    await page.goto("https://leon.cl/neumaticos", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(3000);

    console.log("Leon paso 2: seleccionando ancho/perfil/aro", datosMedida);

    const anchoAbierto = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll("div.select-value"));
      const ancho = divs.find((el) => el.textContent.trim() === "Ancho");
      if (ancho) {
        ancho.click();
        return true;
      }
      return false;
    });

    if (!anchoAbierto) {
      console.log("Leon: no encontró el widget de búsqueda por medida");
      await page.screenshot({
        path: "leon-error-sin-widget.png",
        fullPage: true,
      });
      return [];
    }

    await page.waitForTimeout(600);

    const seleccionoAncho = await abrirYSeleccionar(datosMedida.ancho);
    await page.waitForTimeout(1000);
    const seleccionoPerfil = await abrirYSeleccionar(datosMedida.perfil);
    await page.waitForTimeout(1000);
    const seleccionoAro = await abrirYSeleccionar(datosMedida.aro);
    await page.waitForTimeout(1000);

    if (!seleccionoAncho || !seleccionoPerfil || !seleccionoAro) {
      console.log(
        "Leon: la medida solicitada no está disponible en las opciones del buscador",
        { seleccionoAncho, seleccionoPerfil, seleccionoAro }
      );
      return [];
    }

    console.log("Leon paso 3: esperando habilitación del botón Buscar (geolocalización)");

    const botonHabilitado = await page
      .waitForFunction(
        () => {
          const botones = Array.from(document.querySelectorAll("button")).filter(
            (b) =>
              b.textContent.trim() === "Buscar" &&
              b.getBoundingClientRect().width > 0
          );
          return botones.length > 0 && !botones[0].disabled;
        },
        { timeout: 20000 }
      )
      .then(() => true)
      .catch(() => false);

    if (!botonHabilitado) {
      console.log("Leon: el botón Buscar nunca se habilitó");
      await page.screenshot({
        path: "leon-error-boton-deshabilitado.png",
        fullPage: true,
      });
      return [];
    }

    console.log("Leon paso 4: clic en Buscar");

    await page.evaluate(() => {
      const boton = Array.from(document.querySelectorAll("button")).find(
        (b) =>
          b.textContent.trim() === "Buscar" &&
          b.getBoundingClientRect().width > 0
      );
      if (boton) boton.click();
    });

    const navegoAResultados = await page
      .waitForURL(/\/neumaticos\/plp\//, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    if (!navegoAResultados) {
      console.log("Leon: no navegó a la página de resultados (plp)");
      await page.screenshot({
        path: "leon-error-sin-navegacion.png",
        fullPage: true,
      });
      return [];
    }

    const hayProductos = await page
      .waitForSelector(".producto_individual_plp", { timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    if (!hayProductos) {
      console.log("Leon: 0 productos para esta medida (sin stock)");
      return [];
    }

    console.log("Leon paso 5: resultados cargados", page.url());

    // Los productos se cargan de a poco (lazy load) al hacer scroll.
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(1200);
    }

    const productos = await page.evaluate(
      ({ proveedor, medida, fabricante }) => {
        const normalizarTexto = (txt = "") =>
          String(txt).replace(/\s+/g, " ").trim();

        const normalizarComparacion = (txt = "") =>
          String(txt)
            .toUpperCase()
            .replace(/\s+/g, "")
            .replace(/\//g, "")
            .replace(/-/g, "");

        const parsearPrecio = (txt = "") =>
          Math.round(Number(String(txt).replace(/[^\d]/g, "")) || 0);

        const fabricanteNormalizado = normalizarComparacion(fabricante);

        const items = Array.from(
          document.querySelectorAll(".producto_individual_plp")
        );
        const resultados = [];

        for (const item of items) {
          const marca = normalizarTexto(
            item
              .querySelector('img[alt="logo-marca-neumatico"]')
              ?.src.split("/")
              .pop()
              .replace(/\.(png|webp|jpg|jpeg)$/i, "") || ""
          );

          const modelo = normalizarTexto(
            item.querySelector("#parrafo1")?.textContent || ""
          );

          if (!modelo) continue;

          const titulo = normalizarTexto(`${marca} ${modelo}`);
          const tituloComparable = normalizarComparacion(titulo);

          if (
            fabricanteNormalizado &&
            !tituloComparable.includes(fabricanteNormalizado)
          ) {
            continue;
          }

          const precioTexto =
            item.querySelector(".precio_neumatico p")?.textContent?.trim() ||
            "";
          const precio = parsearPrecio(precioTexto);

          if (precio <= 0) continue;

          resultados.push({
            proveedor,
            medida,
            marca,
            modelo,
            producto: titulo,
            precioOfertaTexto: precioTexto,
            precioNormalTexto: precioTexto,
            precioOferta: precio,
            precioNormal: precio,
            precio,
            url: window.location.href,
          });
        }

        const unicos = new Map();

        for (const item of resultados) {
          unicos.set(`${item.producto}-${item.precio}`, item);
        }

        return Array.from(unicos.values());
      },
      {
        proveedor,
        medida: datosMedida.medidaTexto,
        fabricante,
      }
    );

    console.log("Leon productos reales:", productos.length);

    return productos;
  } catch (error) {
    console.error("Error Leon:", error.message);

    await page
      .screenshot({
        path: "leon-error-general.png",
        fullPage: true,
      })
      .catch(() => {});

    return [];
  }
}
