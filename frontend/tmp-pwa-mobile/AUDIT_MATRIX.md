# Auditoría móvil + PWA — matriz resumida (Preview)

Base hscroll previa (`tmp-hscroll-audit-full`): PASS en login + sectores @ 390/1366/1440/1920.

## Clasificación de hallazgos (esta pasada)

| ID | Severidad | Hallazgo | Estado |
| --- | --- | --- | --- |
| M1 | P0 | Sin PWA instalable (manifest/SW/iconos) | Corregido |
| M2 | P0 | `/offline` y connectivity bloqueados por middleware sin sesión | Corregido |
| M3 | P1 | Safe-area iPhone ausente en TwinShell | Corregido |
| M4 | P1 | Inputs login 15px (zoom iOS) | Corregido → 16px |
| M5 | P1 | `overflow-x-auto` en OE/OA/excel paste | Corregido → clip |
| M6 | P1 | Sin banner conexión real / sin update SW controlado | Corregido |
| M7 | P2 | Touch target menú hamburguesa &lt; 44px | Corregido → 44px |
| M8 | P2 | Sin “Instalar Genus OS” | Corregido (menú + login) |
| M9 | P3 | Build/SHA no visible en standalone | Corregido badge status bar |

## Viewports de referencia

375×667 · 390×844 · 430×932 · 360×800 · 412×915 · 768×1024 · 1024×768 · 1366×768 · 1920×1080

## Sectores

Producción · Calidad · Elaboración · Envasado Masivo · Envasado Premium · Codificado · MP · Depósito

## SW — rutas excluidas de caché

- `/api/**` (todas)
- Navegación HTML autenticada (network-only; offline → `/offline`)
- Cookies / sesión / `/api/v1/auth/me`

## Caché permitida

- `/_next/static/**`
- `/icons/**`, `/brand/**`
- `/offline`
- fuentes/css/js versionados

## Limitaciones reales

- Instalación iPhone: solo Safari + “Agregar a pantalla de inicio” (sin prompt automático).
- `beforeinstallprompt` no disponible en todos los navegadores desktop.
- Sin cola offline de escrituras (por diseño).
- Prueba física iPhone/Android de instalación depende del dispositivo del usuario; Preview valida código + SW policy tests.
