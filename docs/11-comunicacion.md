# 11 — Comunicación

> **ESTADO: MÓDULO FUTURO PROPUESTO.** No diseñado en detalle ni construido. Hoy solo existe **Slack** como canal previsto de notificaciones. Este documento propone la dirección; el alcance debe confirmarse antes de construir.

---

## 1. Objetivo

Centralizar la comunicación operativa **alrededor del trabajo**, no en un chat aparte. La comunicación en Genus debe estar **anclada al contexto** (a una OE, un lote, una liberación, un pedido), de modo que las conversaciones queden trazables junto al objeto al que se refieren — algo valioso para GMP.

## 2. Componentes propuestos

- **Notificaciones:** avisos automáticos disparados por eventos (la posta, problemas, vencimientos). Canal: Slack hoy; push del front-end propio a futuro.
- **Alertas:** notificaciones de severidad (stock crítico, lote por vencer, desvío, rechazo). Se reflejan también en la sección "Problemas" de los Workspaces.
- **Mensajes internos / chat entre sectores:** conversación entre roles, idealmente **contextual** (hilo asociado a una entidad).
- **Menciones:** @persona o @rol para llamar la atención de alguien sobre un objeto.
- **Historial:** registro consultable de la conversación por objeto (trazabilidad).

## 3. Integraciones

- **Slack:** canal actual previsto para notificaciones. Bots/automatizaciones publican eventos relevantes en canales por área.
- **Microsoft Teams:** alternativa/complemento según la ofimática del laboratorio. Integración vía webhooks/conector.
- **Email:** para avisos formales o resúmenes.

## 4. Principios de diseño

- **Anclada al contexto:** preferir el comentario sobre el objeto (lote/orden) por encima del chat suelto.
- **Sin ruido:** notificar lo accionable; evitar la fatiga de alertas (riesgo principal de este módulo).
- **Trazable:** todo lo que importe a calidad/auditoría debe quedar registrado y asociado a su entidad.
- **Respeta RBAC:** se ve/menciona según permisos.

## 5. Relación con otros módulos

- Es el canal de la **posta** y de las **alertas** de la Bandeja Inteligente (`09`).
- Se alimenta de las **automatizaciones** (`14`, `19`).
- Un "feed de actividad reciente" por objeto (historial) es un componente de log relacionado (bucket C, pendiente).

## 6. Pendiente de definición

Modelo de datos de mensajes/hilos; política de notificaciones (qué evento → qué canal → a quién); elección Teams vs. Slack como primario; retención e historial. Ver `19-pendientes.md`.
