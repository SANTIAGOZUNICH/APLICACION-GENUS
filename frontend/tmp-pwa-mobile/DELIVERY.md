# Entrega — Móvil + PWA (PR #60 Preview)

## SHA
(ver commit al push)

## Preview
Tras deploy del commit de esta entrega (branch alias):
https://aplicacion-genus-git-claude-g-024097-santizunich-2879s-projects.vercel.app

## Manifest
- `src/app/manifest.ts` → Genus OS / standalone / theme `#071925` / es-AR
- Iconos: `public/icons/icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon.png`
- Fuente: logo oficial `public/brand/laboratorio-genus-logo-official-source.png`

## Service worker
- `public/sw.js` (build query `?build=SHA`)
- Cache: solo estáticos seguros + `/offline`
- Excluido: `/api/**`, navegación autenticada (network-first → offline page)
- Update UI: “Hay una nueva versión…” + bloqueo si hay operación dirty (remito/etiqueta/form)

## Instalar Genus OS
- Menú usuario + pantalla login
- Chrome/Edge: `beforeinstallprompt`
- iPhone: instrucciones Safari / Abrir como app
- Chrome iPhone: copiar enlace + aviso Safari

## Móvil corregido
- Safe-area TwinShell
- Touch 44px menú
- Login inputs 16px
- OE/OA/excel: sin overflow-x-auto
- Banner conexión real (`/api/v1/connectivity`)
- Middleware: `/offline` + connectivity públicos

## Confirmaciones
- merge=false · Production=false
- migraciones 0014–0017 intactas
- fórmulas 842/784 (no tocadas)
- auth empresarial intacta
- TEST_*=0 (sin datos sintéticos en esta pasada)
