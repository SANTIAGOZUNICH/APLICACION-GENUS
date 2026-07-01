# Genus OS — Frontend

Interfaz web de Genus Operaciones.

## Requisitos

- Node.js 20+
- npm 10+

## Desarrollo local

```bash
npm install
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000) — redirige a `/bandeja`.

## Rutas (Sprint 1)

| Ruta | Descripción |
|---|---|
| `/bandeja` | Mi Trabajo — Bandeja Inteligente |
| `/produccion` | Workspace Producción |
| `/calidad` | Workspace Calidad |
| `/deposito` | Workspace Depósito |
| `/comercial` | Workspace Comercial |
| `/direccion` | Workspace Dirección |
| `/dt` | Workspace Dirección Técnica |
| `/design-system` | Referencia visual de tokens |

## Documentación

La fuente de verdad del producto está en `/docs` del repositorio raíz.

## Scripts

```bash
npm run dev      # servidor de desarrollo
npm run build    # build de producción
npm run start    # servir build
npm run lint     # ESLint
```

## Deploy en Vercel

El frontend vive en la subcarpeta `frontend/` del monorepo. Vercel debe apuntar ahí.

### Configuración del proyecto (obligatoria)

En **Vercel → Project Settings → General → Root Directory**:

| Campo | Valor |
|---|---|
| **Root Directory** | `frontend` |

Vercel detectará Next.js automáticamente. Los demás campos deben quedar en **Auto** (no override manual):

| Campo | Valor |
|---|---|
| Framework Preset | Next.js (auto) |
| Build Command | `npm run build` (auto) |
| Output Directory | *(vacío — Next.js lo gestiona)* |
| Install Command | `npm install` (auto) |
| Node.js Version | 20.x |

### Verificación post-deploy

- `/` → redirige a `/bandeja`
- `/bandeja` → Mi Trabajo (Entrega 1)
- `/design-system` → referencia visual

### Nota sobre monorepo

La carpeta `/docs` en la raíz del repo **no interfiere** con el deploy cuando Root Directory = `frontend`. No se requiere `vercel.json` en la raíz del repo.
