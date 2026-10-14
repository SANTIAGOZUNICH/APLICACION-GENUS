# 56 — Métricas: edición tipo Excel y pegado desde Excel / Google Sheets

## Qué hace
- **Edición en la planilla de Métricas:** Fecha, Producto, Unidades y Responsable se editan en la celda (Enter / Tab / flechas), con validación por celda. El **Sector** no se edita (se carga en el sector correcto).
- **Pegar un rango sobre registros existentes** (Ctrl+V sobre una celda de la planilla): lo resuelve `GenusGrid` (vista previa si son más de 5 celdas, celdas protegidas, Ctrl+Z).
- **«Pegar desde Excel»** (botón sobre la tabla): pega filas nuevas. Se interpretan tabuladores y saltos de línea (incluidas celdas entre comillas de Google Sheets), se respeta el **orden de columnas** (con o sin fila de encabezados), fechas `dd/mm/aaaa` y números con coma decimal / punto de miles (es-AR). La vista previa muestra el error **en cada celda** (editable) y el estado de cada fila según el servidor.

## Duplicados
Clave natural: **sector + fecha + producto + responsable** (sin distinguir mayúsculas ni tildes).
| Estado | Qué pasa |
|---|---|
| Nueva | se crea |
| Ya existe (mismas unidades) | no se toca |
| Existe con otras unidades | **no se pisa** salvo que el usuario tilde «Pisar unidades» en esa fila; si el registro cambió mientras revisaba, tampoco se pisa |
| Repetida en lo pegado | solo la primera |
| Con error | no se importa |

## Persistencia y auditoría
- Tabla existente `packaging_metrics` (sin migración, sin base paralela).
- Auditoría en `feature_audit_events` (dominio `metricas`): alta, edición (valores antes/después y origen: `form`, `grid`, `paste`), baja y restauración, y un evento por pegado con su `batchId`.
- Edición por celda con **versión** (`updatedAt`): si otra persona modificó el registro, responde 409 y no se pisa; la fila se bloquea (`FOR UPDATE`) durante la edición.
- El pegado es **atómico** (todo o nada) e **idempotente** por `batchId` (índice único parcial de `feature_audit_events`): un reintento o varias confirmaciones simultáneas guardan una sola vez.
- Máximo 500 filas por pegado.

## Permisos (sin cambios)
Envasado Masivo / Premium: solo su sector. Producción: ambos (elige sector por fila o uno por defecto). Los demás sectores: 403. El servidor revalida cada fila; nada se confía del navegador.

## Pruebas
- `metricas-paste.test.ts` (interpretación), `metricas-import.test.ts` (servicio), `metricas-paste-dialog.test.tsx` (diálogo).
- E2E con Postgres descartable: `npm run test:e2e:metricas-pegado` (30 comprobaciones, incluidas tablet y celular).
