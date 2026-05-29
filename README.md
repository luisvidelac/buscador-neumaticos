# Comparador de Neumáticos Chile

Proyecto fullstack para buscar precios de neumáticos por medida en distintos proveedores y exportar resultados a Excel.

## Requisitos

- Node.js 20+
- npm

## Instalación rápida

```bash
npm run install:all
cd backend
npx playwright install chromium
cd ..
npm run dev
```

Frontend:

```txt
http://localhost:5173
```

Backend:

```txt
http://localhost:3001
```

## Búsqueda de prueba

```txt
http://localhost:3001/api/neumaticos?medida=205/55R16
```

## Importante

Los scrapers están construidos como base funcional usando búsqueda web por proveedor. Para producción se recomienda ajustar cada scraper con la URL real, estructura HTML y selectores específicos de cada sitio.
