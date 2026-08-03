# Vercel Blob privado — COA y Remitos (OIDC)

Formulas **siguen en Google Drive**. COA y Remitos usan **Vercel Blob** con acceso privado.

## Variables

| Variable | Rol | Dónde |
|---|---|---|
| `GENUS_FILE_STORAGE=vercel_blob` | Activa el adapter | Preview / Production / local |
| `BLOB_STORE_ID` | Store conectado (OIDC Marketplace) | Auto en Vercel al conectar Blob |
| `VERCEL_OIDC_TOKEN` | Auth runtime (rotado por Vercel) | **Inyectado** — no crear a mano |
| `BLOB_READ_WRITE_TOKEN` | Fallback **solo** local/CLI | Opcional; **no** crear en Vercel |
| `BLOB_WEBHOOK_PUBLIC_KEY` | Solo verificación de webhooks | Auto; **no** autentica put/get/delete |

Nunca exponer estas variables con prefijo `NEXT_PUBLIC_`.

## Auth en el adapter

1. **OIDC** (preferido en Vercel): `BLOB_STORE_ID` + `VERCEL_OIDC_TOKEN` en runtime.
2. **TOKEN** (local/CLI): `BLOB_READ_WRITE_TOKEN` si no hay OIDC.

Diagnóstico seguro (sesión requerida):

```http
GET /api/v1/storage/health
```

Respuesta (sin IDs ni secretos):

```json
{
  "provider": "VERCEL_BLOB_PRIVATE",
  "configured": true,
  "authMode": "OIDC",
  "storeConfigured": true
}
```

## Checklist Preview

1. Blob store conectado vía OIDC en el proyecto Vercel.
2. `GENUS_FILE_STORAGE=vercel_blob` en Preview.
3. Confirmar `GET /api/v1/storage/health` → `configured=true`, `authMode=OIDC`.
4. **No** crear `BLOB_READ_WRITE_TOKEN` en Vercel.
5. Migración `0008` **no** aplicar hasta el go-ahead explícito.

## Keys de almacenamiento

- COA: `coas/{folderId}/{fileId}/v{n}/{fileName}`
- Remitos: `remitos/{year}/{remitoId}/v{n}/remito.{pdf|xlsx}`

Descargas solo vía API autenticada Genus OS (nunca URL pública del blob al cliente).
