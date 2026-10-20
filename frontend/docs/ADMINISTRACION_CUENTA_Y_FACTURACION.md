# Cuenta de Administración y Control de facturación

## 1. Alta de `admin@laboratoriogenus.com.ar` (la corre el propietario)

La app no crea usuarios por sí sola y **no hay ninguna contraseña en el repo, migraciones, variables ni logs**.

```bash
# desde frontend/, con la URL de Neon de producción solo en tu terminal
export DATABASE_URL='<neon production>'
node scripts/provision-administracion-account.mjs --check     # solo informa si el correo ya existe (no escribe)
node scripts/provision-administracion-account.mjs --verify    # pide la contraseña 2 veces (oculta), crea la cuenta y prueba el login real
```

- Si el correo **ya existe**, el script no crea nada y no toca su contraseña, sector ni estado.
- Mínimo 10 caracteres; rechaza `admin123` y claves comunes. Solo se guarda el hash bcrypt (costo 12).
- Cuenta creada: sector `ADMINISTRACION`, rol `ROL-AD`, estado `ACTIVO`. No es superadmin.
- Para cambiar luego su contraseña: `/administracion/usuarios` (superadmin) → restablecer contraseña.

## 2. Administrador general existente

El/los correos de superadmin **no están en el repo**: son la variable `GENUS_SUPERADMIN_EMAIL` del proyecto en Vercel (lista separada por coma o punto y coma). Para recuperar el acceso:

1. Ver el valor en Vercel → Project → Settings → Environment Variables (Production).
2. `scripts/_admin_reset_superadmin_password.ps1` (o `.mjs`) restablece **solo** esa cuenta, con contraseña oculta, y valida con un login real. No toca otras cuentas.
3. Si ya hay otro superadmin con sesión: `/administracion/usuarios` → restablecer contraseña de esa cuenta (queda auditado).

Nada de esto se ejecutó desde la sesión de desarrollo.

## 3. Qué ve y qué puede hacer Administración

- Menú: Control de facturación, Dashboard (de facturación, sin importes), Entregados, Entregas, Remitos (consulta/descarga), Avisos, Configuración.
- Registra y anula facturación (facturas emitidas fuera de GENUS OS; sin importes, sin ARCA).
- No modifica fórmulas, stock MP/ME, órdenes, entregas ya registradas ni permisos de otros usuarios.
- Producción y Dirección consultan el control (solo lectura).

## 4. Modelo de datos (migración 0062, aditiva)

`billing_invoices` (factura por cliente + número), `billing_invoice_lines` (unidades de UNA entrega real), `billing_invoice_events` (historial/auditoría), `billing_work_notes` (observaciones). Sin FKs ni borrados; no toca entregas, stock ni producción.

Estados de facturación (contra lo **entregado**): SIN ENTREGAS · PENDIENTE DE FACTURAR · FACTURACIÓN PARCIAL · FACTURADO · ANULADO / CON INCIDENCIA. El estado de entrega (sin entregas / parcial / completa) se muestra aparte.

## 5. Avisos a Administración

Listo para entregar · entrega registrada (parcial o final) · pedido entregado completo · remito generado · remito anulado que afecta entregas pendientes de facturar. Id determinístico por evento: una recarga, reintento o doble clic no duplica.
