# 29 — Identidad y Acceso (Fase 4)

> **Estado:** en curso — PR 4.1b UX premium login  
> **Patrón:** Strangler Fig — mock auth TEMP → Google OAuth + API  
> **Principio:** Login resuelve **identidad**; Role Engine resuelve **experiencia sectorial**

---

## 1. Separación de responsabilidades

| Capa | Responsabilidad |
|------|-----------------|
| **Login (Fase 4)** | email, password, sesión, identidad (`displayName`, `roleId`, `sectorId`) |
| **Role Engine** | qué ve cada sector, paneles, sidebar, Creamy — **sin cambios** |
| **RBAC server (futuro)** | enforcement PERMISOS — doc 04, 17, 19 |

---

## 2. PRs Fase 4

| PR | Alcance | Estado |
|----|---------|--------|
| **4.1** | UI `OsSignInScreen` + ruta `/login` aislada | ✅ |
| **4.1b** | UX premium — layout, contexto planta, bootstrap UI | ✅ |
| **4.1c** | UX polish + Access Preview mock por sector | ✅ en curso |
| **4.2** | `OsAuthSession` + `AuthAdapter` + contratos | ✅ |
| **5.1** | Dynamic Workspace Shell — resolver + provider | ✅ en curso |
| **4.3** | Mapeo email → persona → sector → rol (mock TEMP) | Pendiente |
| **4.4** | Validación mock contraseña (server route) | Pendiente |
| **4.5** | Session bootstrap + remember me | Pendiente |
| **4.6** | Integración `OsAppRoot loginMode="credentials"` | Pendiente |
| **4.7** | Stubs OAuth/API + estrategia auth real | Pendiente |

---

## 3. PR 4.1 — UI login enterprise

### Archivos

- `features/os/auth/components/os-sign-in-screen.tsx`
- `features/os/auth/components/os-auth-mock-banner.tsx`
- `app/login/` — ruta preview aislada

### Sin tocar

- `OsAppRoot`, `SectorLogin`, rutas OS existentes
- Role Engine, Workflow Engine, mappers

### Criterios

- [x] Email + contraseña + remember me
- [x] Sector/rol/nombre read-only (preview vacío hasta PR 4.3)
- [x] Banner AUTH MOCK visible
- [x] Tokens `--os-*` / enterprise feel
- [ ] Wiring auth (PR 4.4+)

---

## 4. PR 4.1b — UX premium login

### Decisiones de layout

**Opción elegida:** split asimétrico 52/48 — panel oscuro contextual (OS shell) + superficie clara de ingreso.

| Alternativa evaluada | Por qué no |
|---------------------|------------|
| Formulario centrado card | Genérico; no transmite MOS |
| 50/50 decorativo | Panel izquierdo sin valor operativo |
| Full-bleed video/foto | Ruido visual; no alineado al DS |

### Componentes nuevos

- `GenusOsLogo`, `OsPlantContextPanel`, `OsSignInIdentityCard`
- `OsSessionBootstrapScreen`, `OsAuthField`
- `lib/plant-context.ts`, `lib/session-bootstrap-steps.ts`

### Criterios UX

- [x] Branding MOS con presencia
- [x] Contexto planta (fecha, hora, turno, ops)
- [x] Identidad preparada (avatar, cargo, sector, rol, empresa)
- [x] Bootstrap simulado post-submit en `/login`
- [x] Remember me permanente con copy
- [x] Responsive notebook/desktop/tablet
- [x] Accesibilidad: skip link, labels, aria-live bootstrap

---

## 5. PR 4.1c — UX polish + Access Preview

### Credenciales mock (solo preview)

| Email | Password | Sector |
|-------|----------|--------|
| produccion@laboratoriogenus.com.ar | produccion123 | Producción |
| calidad@laboratoriogenus.com.ar | calidad123 | Calidad |
| deposito@laboratoriogenus.com.ar | deposito123 | Depósito |
| direccion@laboratoriogenus.com.ar | direccion123 | Dirección |

Flujo: validar → bootstrap simulado → redirect `/mi-trabajo` · storage `genus_os_auth_session` (migra legacy `genus_os_preview_user`).

### UX polish

- Panel izquierdo reducido: branding + credencial + estado + horario
- Bootstrap premium con barra de progreso
- Transición fade login → bootstrap → redirect
- Footer minimal · idioma ES

---

## 7. PR 4.2 — Auth contracts

### Tipos

- `OsAuthSession`, `AuthUser`, `AuthSector`, `AuthRole`, `AuthSessionStatus`

### Contrato e implementación

- `AuthAdapter` — interfaz contractual
- `MockAuthAdapter` — preview sin auth real
- Persistencia: `sessionStorage` por defecto · `localStorage` con remember me

### Helpers

- `getCurrentAuthSession`, `clearAuthSession`, `isAuthenticatedPreview`, `getAuthSector`

### Archivos

- `features/os/auth/contracts/`
- `features/os/auth/adapters/mock-auth-adapter.ts`
- `features/os/auth/lib/auth-session-storage.ts`
- `features/os/auth/lib/auth-session-helpers.ts`
- `features/os/auth/lib/auth-contracts.test.ts`

### Sin tocar

- OsAppRoot · rutas · engines · mappers · UX visual `/login`

---

## 8. Referencias

- `docss/28-convergence-strategy.md` §7 — auditoría post-Fase 3
- `docss/17-api.md` §5 — autenticación target
- `docss/03-modelo-de-datos.md` — USUARIOS, ROLES
- `docss/24-role-engine.md` — login ≠ Role Engine
