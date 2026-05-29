const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export async function buscarNeumaticos(medida) {
  const response = await fetch(`${API_URL}/api/neumaticos?medida=${encodeURIComponent(medida)}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Error al buscar neumáticos");
  }

  return data;
}

export async function obtenerProveedores() {
  const response = await fetch(`${API_URL}/api/proveedores`);
  return response.json();
}
