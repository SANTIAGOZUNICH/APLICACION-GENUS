# Conectar Vercel Blob privado (COA + Remitos)

NO MERGE · NO PRODUCTION · NO aplicar migración 0008 todavía.

## 1. Crear store Blob en Vercel

1. Abrí el proyecto `aplicacion-genus` en Vercel → **Storage** → **Create** → **Blob**.
2. Elegí región cercana y creá el store.
3. Conectalo al proyecto (Preview + Development). Production solo cuando se autorice.

## 2. Variables de entorno (server only)

En Vercel → Project → Settings → Environment Variables (solo **Preview** por ahora):

| Variable | Valor | Público |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | token del store (lo inyecta Vercel al conectar) | **NO** — nunca `NEXT_PUBLIC_` |
| `GENUS_FILE_STORAGE` | `vercel_blob` | NO |

Opcional local:

```bash
cd frontend
npx vercel env pull .env.local --yes
```

Verificá que `.env.local` tenga `BLOB_READ_WRITE_TOKEN` y **no** lo commitees.

## 3. Migración 0008 (aún NO)

Archivo: `frontend/drizzle/0008_private_file_storage.sql`

Queda en el journal pero **diferida** salvo `APPLY_MIGRATION_0008=1`.

Hasta aplicarla, Genus guarda `storage_key` en columnas legacy `drive_file_id*` + `audit`/`checksum`. Cuando autoricen 0008:

```bash
# Solo Preview Neon, con autorización explícita:
APPLY_MIGRATION_0008=1 npm run db:migrate-if
```

No tocar `APPLY` de 0005/0006/0007 si ya están aplicadas.

## 4. Qué deja de usarse

- `GOOGLE_DRIVE_COAS_FOLDER_ID` — no requerido
- `GOOGLE_DRIVE_REMITOS_FOLDER_ID` — no requerido

**No modificar** `GOOGLE_DRIVE_FORMULAS_FOLDER_ID` (fórmulas siguen en Drive).

## 5. Rutas autenticadas

- `GET /api/v1/coas/files/:id/download`
- `GET /api/v1/coas/files/:id/preview`
- `GET /api/v1/remitos/:id/versions/:version/download?format=pdf|xlsx`
- `POST /api/v1/coas/upload-token` — token temporal cliente (cargas grandes)

RBAC: COA = MP admin / MP+Prod+Calidad+Dirección view · Remitos = solo PRODUCCIÓN.

## 6. Verificación rápida

1. Preview READY con `BLOB_READ_WRITE_TOKEN`.
2. MP: crear carpeta virtual → subir PDF → preview → descarga.
3. Producción: GENERAR REMITO → error claro si falta token; con token → PDF/XLSX en pestaña Remitos.
4. Editar remito → v2; v1 sigue descargable.
5. Calidad → Remitos = 403.
6. Fórmulas: 842 versiones / 784 activas intactas.
