/** Reglas puras (sin servidor) de la activación inicial de la cuenta de Administración. */

/** Única cuenta que esta vía puede crear. Sector y rol son fijos: el navegador no los elige. */
export const ADMIN_ACCOUNT = Object.freeze({
  email: "admin@laboratoriogenus.com.ar",
  displayName: "Administración / Facturación",
  sector: "ADMINISTRACION",
  roleId: "ROL-AD",
  roleLabel: "Administración",
  sectorLabel: "Administración / Facturación",
  jobTitle: "Administración y Facturación",
  redirectTo: "/mi-trabajo",
});

export const ACTIVATION_TTL_MINUTES = 30;
export const PASSWORD_MIN_LENGTH = 10;

const COMMON = new Set([
  "admin123", "admin1234", "administracion", "administracion1", "password", "password1", "12345678", "123456789", "1234567890",
  "genus123", "laboratoriogenus", "laboratoriogenus1", "qwertyuiop", "contrasena", "contraseña",
]);

/** Devuelve el motivo de rechazo o null si la contraseña es aceptable. */
export function validateNewPassword(password: string): string | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) return `Usá al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (password.length > 200) return "La contraseña es demasiado larga.";
  if (/[\r\n]/.test(password)) return "La contraseña no puede tener saltos de línea.";
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || lower.includes("admin123")) return "Esa contraseña es demasiado común. Elegí otra.";
  if (lower.includes("laboratoriogenus") || lower.startsWith("admin@")) return "No uses el nombre de la empresa ni el correo en la contraseña.";
  if (/^(.)\1+$/.test(password)) return "La contraseña no puede repetir un solo carácter.";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes < 3) return "Combiná al menos tres tipos: minúsculas, MAYÚSCULAS, números y símbolos.";
  return null;
}
