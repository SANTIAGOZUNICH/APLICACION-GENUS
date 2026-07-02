# Desarrollo

Antes de contribuir al proyecto o implementar cualquier funcionalidad, es obligatorio leer la carpeta `/playbook`.

El orden de lectura es:

1. playbook/README.md
2. 01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md
3. 02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md
4. 03_GENUS_OS_CURSOR_PLAYBOOK.md
5. 04_GENUS_OS_EXECUTION_MANUAL.md

Estos documentos definen la filosofía, arquitectura, metodología y forma oficial de desarrollar Genus OS.

# Genus Operaciones

Sistema digital de operaciones de Laboratorio Genus — fabricante cosmético GMP bajo ANMAT.

## Documentación

Documentación técnica completa en [`/docs`](./docs/README.md).

## Frontend — Genus OS

Interfaz web en [`/frontend`](./frontend/README.md).

```bash
cd frontend && npm install && npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000)

### Deploy en Vercel

Configurar **Root Directory = `frontend`** en el proyecto de Vercel. Ver [`frontend/README.md`](./frontend/README.md#deploy-en-vercel).
