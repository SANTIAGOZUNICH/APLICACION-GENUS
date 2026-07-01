# Genus Operaciones

Sistema digital de operaciones de Laboratorio Genus — fabricante cosmético GMP bajo ANMAT.

## Documentación

La documentación técnica completa del proyecto está en [`/docs`](./docs/README.md).

**Para empezar:**

- Visión general: [`docs/00-vision-general.md`](./docs/00-vision-general.md)
- Guía para Cursor AI: [`docs/20-recomendaciones-cursor.md`](./docs/20-recomendaciones-cursor.md)

## Frontend — Genus OS

Interfaz web en [`/frontend`](./frontend/README.md).

```bash
cd frontend && npm install && npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000)

### Deploy en Vercel

Configurar **Root Directory = `frontend`** en el proyecto de Vercel. Ver [`frontend/README.md`](./frontend/README.md#deploy-en-vercel).

## Estado del proyecto

| Componente | Estado |
|---|---|
| Backend operativo (F1–F4.1) | Construido y verificado |
| RBAC (F6.0) | Construido en sandbox; pendiente producción |
| Experiencia (F7) | Diseñada; pendiente de construcción |
| Front-end propio | Visión documentada; no iniciado |
