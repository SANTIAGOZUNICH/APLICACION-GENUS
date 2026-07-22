# Genus OS — Iteración operativa (UI, entrega, MP, lotes, OE/OA)

**Fecha:** 2026-07-20  
**Rama:** `claude/genus-os-operational-ui`  
**PR:** https://github.com/SANTIAGOZUNICH/APLICACION-GENUS/pull/60  
**Estado:** Beta Preview — no Production

---

## Funcionalidades de esta iteración

1. **Layout:** una sola barra vertical (main); sidebar scrollea internamente; menú hamburguesa en móvil; hover/focus accesibles.
2. **Cerrar sesión:** visible en sidebar y header; confirmación «¿Querés cerrar la sesión?».
3. **Fecha de entrega** en Asignar trabajos (reemplaza Prioridad visible); filtros, orden, chips Vencido/Hoy/Próximo; `priority` se conserva en datos.
4. **Materias Primas:** Pegar desde Excel (preview, mapeo, validación), Nueva materia prima, edición, baja lógica; banner de almacenamiento local.
5. **OE/OA:** permisos por sector, versiones, validación de archivos, drag-and-drop; almacenamiento demo en el navegador (no Drive).
6. **Asignación de lotes** (nuevo): CRUD, Excel, filtros mes/año, paginación; acceso CALIDAD / PRODUCCIÓN / CODIFICADO.
7. **CODIFICADO:** login demo `codificado@…` / `codificado123`; home → Asignación de lotes.
8. **Consultar / Creamy:** búsqueda real en asignación de lotes (sin inventar datos).
9. **RBAC Calidad:** `actorSectorId` **obligatorio** y exactamente `CALIDAD` (también si viene ausente → 403).

---

## Credenciales de demostración (7)

| Sector | Correo | Contraseña |
|---|---|---|
| Elaboración | elaboracion@laboratoriogenus.com.ar | elaboracion123 |
| Producción | produccion@laboratoriogenus.com.ar | produccion123 |
| Envasado Masivo | emasivo@laboratoriogenus.com.ar | emasivo123 |
| Envasado Premium | epremium@laboratoriogenus.com.ar | epremium123 |
| Calidad | calidad@laboratoriogenus.com.ar | calidad123 |
| Materias Primas | mp@laboratoriogenus.com.ar | mp123 |
| Codificado | codificado@laboratoriogenus.com.ar | codificado123 |

`codificado@` es **credencial temporal de demo** — reemplazar antes de uso productivo.

No autentican: deposito@, direccion@, masivo@, premium@.

---

## Permisos

### Calidad (decisión)
Solo `CALIDAD` puede aprobar/rechazar. Producción consulta en solo lectura.

### OE
- Elaboración: ver/descargar  
- Producción, Calidad, Materia Prima: subir/ver/descargar/reemplazar  

### OA
- Envasado Masivo/Premium: ver/descargar  
- Producción, Calidad: subir/ver/descargar/reemplazar  
- Materia Prima: sin acceso a OA  

### Asignación de lotes
CALIDAD, PRODUCCIÓN, CODIFICADO: consultar/crear/editar/importar. Otros: sin acceso.

---

## Persistencia

### Sincroniza entre dispositivos (Live Sync / Sheets cuando `GENUS_DATA_MODE=real`)
- WorkItems de planillas, avance/finalización, decisiones de Calidad (vía OperationalStore + API).

### Solo local (este navegador) — `@mock-temp`
- Stock MP, asignación manual de trabajos, documentos OE/OA (data URL ≤4MB), asignación de lotes, notificaciones, checklist MP, fórmulas demo.

**No afirmar sincronización multi-dispositivo para estos módulos.**

Archivos OE/OA: no hay Google Drive de escritura configurado para esta Beta. Falta servicio/backend de almacenamiento de archivos (Drive o Blob) + auth server-side.

---

## Limitación de autenticación

`actorSectorId` / permisos de cliente **no son identidad autenticada server-side**. Un cliente podría falsificar el campo. Mejora la validación del pipeline; no reemplaza Identity Access (`docss/29-identity-access.md`).

---

## Preview Vercel protegida

Si la Preview pide login de Vercel SSO:

1. Vercel Dashboard → Project → Settings → Deployment Protection  
2. Para Preview: desactivar Protection o usar «Shareable Link» / password  
3. O autorizar el email del revisor en el equipo Vercel  

---

## Verificación

```bash
cd frontend
npm ci && npm test && npm run build && npm run lint && npx tsc --noEmit
```

Errores preexistentes (no introducidos aquí): 4 lint `set-state-in-effect`; 2 TS en tests ajenos (`work-item-projector.test.ts`, `role-engine.test.ts` kpi_tiles).
