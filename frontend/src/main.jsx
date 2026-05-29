import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import * as XLSX from "xlsx";
import "./styles.css";

const PROVEEDORES = [
  "AZedan",
  "Neumacenter",
  "NeumaticosK",
  "ChileNeumaticos",
  "SDN",
  "Pionono",
  "Neumafast",
  "Llantas del Pacífico",
];

const FABRICANTES = [
  "HANKOOK",
  "MICHELIN",
  "BRIDGESTONE",
  "FIRESTONE",
  "PIRELLI",
  "GOODYEAR",
  "DUNLOP",
  "KUMHO",
  "WESTLAKE",
  "ROADX",
  "APTANY",
  "YOKOHAMA",
  "FALKEN",
  "NEXEN",
  "LINGLONG",
];

function App() {
  const [archivo, setArchivo] = useState(null);
  const [medidas, setMedidas] = useState([]);
  const [resultados, setResultados] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [proveedor1, setProveedor1] = useState("");
  const [proveedor2, setProveedor2] = useState("");
  const [fabricanteFiltro, setFabricanteFiltro] = useState("");

  const proveedoresConfigurados = new Set(
  resultados.flatMap((grupo) =>
    grupo.resultados?.map((item) => item.proveedor) || []
  )
).size;

  const cargarExcel = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setArchivo(file);

    const reader = new FileReader();

    reader.onload = (event) => {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const hoja = workbook.Sheets[workbook.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(hoja, { header: 1 });

      const medidasExcel = filas
        .flat()
        .map((x) => String(x).trim())
        .filter(Boolean);

      setMedidas(medidasExcel);
    };

    reader.readAsArrayBuffer(file);
  };

  const buscarMedidasExcel = async () => {
  if (medidas.length === 0) {
    alert("Primero debes cargar un archivo Excel con medidas.");
    return;
  }

  try {
    const proveedoresSeleccionados = [proveedor1, proveedor2].filter(Boolean);

    if (proveedor1 && proveedor2 && proveedor1 === proveedor2) {
      alert("Proveedor 1 y Proveedor 2 no pueden ser iguales.");
      return;
    }

    setCargando(true);
    setResultados([]);

    const response = await fetch("http://localhost:3001/api/neumaticos/lote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        medidas,
        proveedores: proveedoresSeleccionados,
        fabricante: fabricanteFiltro,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detalle || data.error || "Error al buscar lote");
    }

    setResultados(data.resultados || []);
  } catch (error) {
    alert(error.message);
  } finally {
    setCargando(false);
  }
};

  const exportarExcel = () => {
  if (resultados.length === 0) {
    alert("No hay resultados para exportar.");
    return;
  }

  const proveedores = [
    ...new Set(
      resultados.flatMap((grupo) =>
        (grupo.resultados || []).map((item) => item.proveedor)
      )
    ),
  ];

  const filas = [];

  resultados.forEach((grupo) => {
    const productos = grupo.resultados || [];

    productos.forEach((item) => {
      const filaExistente = filas.find(
        (fila) =>
          fila.Medida === grupo.medida &&
          fila.Producto === item.producto
      );

      if (!filaExistente) {
        const nuevaFila = {
          Medida: grupo.medida,
          Producto: item.producto,
        };

        proveedores.forEach((proveedor) => {
          nuevaFila[proveedor] = "";
        });

        nuevaFila[item.proveedor] = Number(
          item.precioOferta || item.precio || 0
        );

        nuevaFila["Mejores precios por medidas"] = "";

        filas.push(nuevaFila);
      } else {
        filaExistente[item.proveedor] = Number(
          item.precioOferta || item.precio || 0
        );
      }
    });
  });

  const mejoresPorMedida = {};

filas.forEach((fila) => {
  const precios = proveedores
    .map((proveedor) => Number(fila[proveedor] || 0))
    .filter((precio) => precio > 0);

  if (precios.length === 0) return;

  const mejorPrecio = Math.min(...precios);

  if (
    !mejoresPorMedida[fila.Medida] ||
    mejorPrecio < mejoresPorMedida[fila.Medida]
  ) {
    mejoresPorMedida[fila.Medida] = mejorPrecio;
  }
});

filas.forEach((fila) => {
  const preciosFila = proveedores
    .map((proveedor) => Number(fila[proveedor] || 0))
    .filter((precio) => precio > 0);

  const precioMasBaratoFila =
    preciosFila.length > 0 ? Math.min(...preciosFila) : 0;

  fila["Mejores precios por medidas"] =
    precioMasBaratoFila === mejoresPorMedida[fila.Medida]
      ? mejoresPorMedida[fila.Medida]
      : "";
});

  const hoja = XLSX.utils.json_to_sheet(filas);

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Comparador");

  XLSX.writeFile(libro, "comparador-neumaticos.xlsx");
};

  return (
    <div className="app">
      <main className="dashboard-box">
        <section className="hero">
          <h1>Comparador de precios de neumáticos</h1>
          <small>Scraper Azedan Chile</small>
        </section>

        <section className="card">
          <h2>Importar medidas desde Excel</h2>

          <div className="file-box">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={cargarExcel}
            />
            {/* {archivo && <p className="file-name">{archivo.name}</p>} */}
          </div>



<div className="filters-box">
  <h3>Proveedores a comparar</h3>

  <div className="filters-grid">
    <div>
      <label>Proveedor 1</label>
      <select value={proveedor1} onChange={(e) => setProveedor1(e.target.value)}>
        <option value="">Todos los proveedores</option>
        {PROVEEDORES.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
    </div>

    <div>
      <label>Proveedor 2</label>
      <select value={proveedor2} onChange={(e) => setProveedor2(e.target.value)}>
        <option value="">Todos los proveedores</option>
        {PROVEEDORES.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
    </div>

    <div>
      <label>Fabricante</label>
      <select
        value={fabricanteFiltro}
        onChange={(e) => setFabricanteFiltro(e.target.value)}
      >
        <option value="">Todos los fabricantes</option>
        {FABRICANTES.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
    </div>
  </div>
</div>




          <div className="actions">
            <button
  className="btn-primary"
  onClick={buscarMedidasExcel}
  disabled={cargando}
>
  {cargando ? "Procesando búsqueda..." : "Buscar medidas"}
</button>

            <button className="btn-secondary" onClick={exportarExcel}>
              Exportar Excel
            </button>
          </div>


          {cargando && (
  <div className="processing-box">
    Analizando proveedores, comparando precios y buscando mejores ofertas...
  </div>
)}

          <div className="stats">
  <div className="stat">
    <span>Medidas cargadas</span>
    <strong>{medidas.length}</strong>
  </div>

<div className="stat">
    <span>Proveedores</span>
    <strong>{proveedoresConfigurados}</strong>
  </div>




  <div className="stat">
    <span>Mejores precios por medidas</span>

    {resultados.length > 0 ? (
      <div className="best-prices">
        {resultados.map((grupo, index) => {
  const mejor =
    grupo.mejorPrecio ||
    grupo.resultados?.reduce((menor, actual) => {
      const precioActual = Number(actual.precioOferta || actual.precio || 0);
      const precioMenor = Number(menor.precioOferta || menor.precio || 0);

      return precioActual < precioMenor ? actual : menor;
    }, grupo.resultados?.[0]);

  if (!mejor) return null;

  return (
    <div key={index} className="best-price-item">
      <small>{grupo.medida}</small>
      <small>{mejor.producto}</small>
      <b>
    $
    {Number(mejor.precioOferta || mejor.precio || 0).toLocaleString(
      "es-CL"
    )}
  </b>

  <span className="best-price-provider">
    <br></br>
    {mejor.proveedor}
  </span>
    </div>
  );
})}
      </div>
    ) : (
      <strong>0</strong>
    )}
  </div>

  
</div>
        </section>

        {resultados.length > 0 ? (
          
          

  <div className="table-wrapper">
    <table className="results-table">
      <thead>
  <tr>
    <th>Medida</th>
    <th>Proveedor</th>
    <th>Producto</th>
    <th>Precio normal</th>
    <th>Precio oferta</th>
    <th>Ver</th>
  </tr>
</thead>

      <tbody>
  {resultados.flatMap((grupo) =>
    grupo.resultados?.map((item, index) => (
      <tr key={`${grupo.medida}-${item.proveedor}-${index}`}>
        <td>{grupo.medida}</td>

        <td>{item.proveedor}</td>

        <td>{item.producto}</td>

        <td>
          $
          {Number(item.precioNormal || 0).toLocaleString(
            "es-CL"
          )}
        </td>

        <td>
          $
          {Number(item.precioOferta || 0).toLocaleString(
            "es-CL"
          )}
        </td>

        <td>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
          >
            Ver
          </a>
        </td>
      </tr>
    ))
  )}
</tbody>
    </table>
  </div>

) : (
  <section className="card results-card">
    <h2>Resultados encontrados</h2>
    <p>No hay resultados para mostrar todavía.</p>
  </section>
)}


      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);