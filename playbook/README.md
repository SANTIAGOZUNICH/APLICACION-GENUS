# Genus OS — Playbook

Carpeta oficial de ejecución de producto e ingeniería para Genus OS.

## Contenido esperado

| Documento | Propósito |
|-----------|-----------|
| `04_GENUS_OS_EXECUTION_MANUAL.md` | Manual de ejecución operativa (proceso, gates, criterios) |

> **Estado:** El manual de ejecución debe versionarse en este directorio. Si aún no está en el repo, usar la copia local aprobada como fuente hasta incorporarlo.

## Relación con otras fuentes

| Fuente | Rol |
|--------|-----|
| `/playbook` | **Cómo ejecutar** — proceso, gates, validación |
| `/docss` | **Qué construir** — arquitectura, producto, motores |
| `frontend/src/design-system/` | **Cómo se ve** — tokens y reglas visuales |

## Principio operativo (inviolable)

```text
Trabajo → Estado → Acción → Datos
```

Ninguna decisión de playbook, documentación o implementación puede romper este modelo.

## Convergencia (Fase 0+)

Ver `docss/28-convergence-strategy.md` para la estrategia aprobada de migración Strangler Fig hacia Genus OS v1.0.
