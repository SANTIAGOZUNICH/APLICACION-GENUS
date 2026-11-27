/**
 * Utilidades PURAS (sin E/S ni dependencias de servidor, aptas para el navegador) del alta de accesos al portal:
 * usuario derivado del nombre del cliente, contraseña legible generada con el generador criptográfico del sistema
 * y mensaje para compartir las credenciales por WhatsApp.
 */
import { PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN, normalizeUsername } from "./user-rules";

/** Ingreso al portal de clientes que se informa en el mensaje (PORTAL_PUBLIC_BASE_URL del servidor apunta a otro dominio). */
export const PORTAL_ACCESS_URL = "https://appgenus.vercel.app/entregas";

/** «The Minimal Co.» → «theminimalco». Minúsculas, sin acentos, espacios ni símbolos; siempre cumple `normalizeUsername`. */
export function slugifyUsername(name: unknown): string {
  const base = (typeof name === "string" ? name : "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  let slug = base || "cliente";
  while (slug.length < USERNAME_MIN) slug += "x";
  // Deja lugar para un sufijo numérico incremental sin pasar el máximo.
  return slug.slice(0, USERNAME_MAX - 6);
}

/** `base`, `base2`, `base3`… el primero que no esté en `taken` (ya normalizados a minúsculas). */
export function pickAvailableUsername(base: string, taken: ReadonlySet<string>, startAt = 1): string {
  for (let n = Math.max(1, startAt); n < 10_000; n++) {
    const candidate = n === 1 ? base : `${base}${n}`;
    if (!taken.has(candidate) && normalizeUsername(candidate)) return candidate;
  }
  throw new Error("No hay nombres de usuario disponibles para esa base.");
}

/** Sin 0/O/1/I/l/o: se dicta o tipea desde el celular sin confusiones. */
const LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const ALPHABET = LETTERS + DIGITS;

/** Entero uniforme en [0, max) con crypto.getRandomValues (descarta valores sesgados). */
function secureInt(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(buf);
  while (buf[0]! >= limit);
  return buf[0]! % max;
}

/** Contraseña criptográfica de ≥12 caracteres con letras y números (cumple la política del portal). */
export function generateAccessPassword(length = 12, avoid?: string | null): string {
  const n = Math.max(12, Math.min(length, 64), PASSWORD_MIN);
  const low = avoid ? avoid.toLowerCase() : "";
  for (;;) {
    const chars: string[] = [];
    for (let i = 0; i < n; i++) chars.push(ALPHABET[secureInt(ALPHABET.length)]!);
    // Garantiza al menos una letra y un número en posiciones distintas y aleatorias.
    const li = secureInt(n);
    const di = (li + 1 + secureInt(n - 1)) % n;
    chars[li] = LETTERS[secureInt(LETTERS.length)]!;
    chars[di] = DIGITS[secureInt(DIGITS.length)]!;
    const pwd = chars.join("");
    if (low && pwd.toLowerCase().includes(low)) continue;
    return pwd;
  }
}

/** Mensaje EXACTO que se comparte con el cliente. */
export function buildPortalAccessMessage(username: string, password: string, url: string = PORTAL_ACCESS_URL): string {
  return (
    "¡Hola! Ya tenés acceso al Portal de Clientes de Laboratorio Genus.\n\n" +
    "Desde acá vas a poder seguir el estado de tus pedidos en tiempo real y recibir notificaciones sobre su avance.\n\n" +
    `Usuario: ${username}\n` +
    `Contraseña: ${password}\n\n` +
    "Ingresá en:\n" +
    `${url}\n\n` +
    "¡También podés instalar la aplicación en tu celular!"
  );
}

/** Enlace de WhatsApp sin número fijo: la persona elige el contacto. */
export function buildWhatsappShareUrl(username: string, password: string, url?: string): string {
  return `https://wa.me/?text=${encodeURIComponent(buildPortalAccessMessage(username, password, url))}`;
}
