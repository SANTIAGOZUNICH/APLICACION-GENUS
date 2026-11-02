/**
 * Familias de envases y sus accesorios — reglas PURAS (sin IA, sin datos).
 *
 * Sirven para dos cosas: clasificar un material de ME por su descripción (rol) y saber QUÉ accesorio suele necesitar un
 * envase. NUNCA identifican un SKU concreto ni dan por compatibles dos piezas por parecerse el nombre: eso lo decide una
 * persona (o una compatibilidad registrada). Acá solo se razona «este envase suele necesitar un dispensador».
 */
export const ME_ROLES = ["ENVASE", "CIERRE", "DISPENSADOR", "ETIQUETA", "ESTUCHE", "PRECINTO", "OTRO"] as const;
export type MeRole = (typeof ME_ROLES)[number];

export const ME_ROLE_LABELS: Record<MeRole, string> = {
  ENVASE: "Envase",
  CIERRE: "Tapa / cierre",
  DISPENSADOR: "Dispensador",
  ETIQUETA: "Etiqueta",
  ESTUCHE: "Estuche",
  PRECINTO: "Precinto",
  OTRO: "Otro",
};

/** Minúsculas, sin tildes, espacios colapsados. */
export function fold(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ%.\s/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export const keyOf = (s: string | null | undefined) => fold(s).toUpperCase();

const ENVASE_RE = /\b(frasco|botella|pote|pomo|envase|airless|roll[\s-]?on|rollon|tubo|bidon|sachet|ampolla|flacon|jar|bottle|tarro)\b/;
const ACCESSORY_RE = /\b(tapa|tapon|sobretapa|contratapa|cierre|dropper|pipeta|cuentagotas|gotero\s+(?:de\s+)?(?:goma|vidrio|pipeta)|valvula|pulverizador|atomizador|bomba|dosificador|bolilla|bola|aplicador|dispensador|disp\b|pump|spray\s+pump)\b/;
const DISPENSER_RE = /\b(dropper|pipeta|cuentagotas|valvula|pulverizador|atomizador|bomba|dosificador|bolilla|bola|aplicador|dispensador|pump)\b/;
const CLOSURE_RE = /\b(tapa|tapon|sobretapa|contratapa|cierre)\b/;

/** Rol de un material de ME según su descripción. Gana la palabra que aparece PRIMERO («Frasco gotero» = envase; «Dropper …» = dispensador). */
export function classifyRole(description: string): MeRole {
  const t = fold(description);
  if (!t) return "OTRO";
  if (/\betiqueta\b|\bsticker\b/.test(t)) return "ETIQUETA";
  if (/\bestuche\b|\bcaja\b|\bdisplay\b/.test(t)) return "ESTUCHE";
  if (/\bprecinto\b|\bsello\b|\btermocontraible\b/.test(t)) return "PRECINTO";
  const env = t.search(ENVASE_RE);
  const acc = t.search(ACCESSORY_RE);
  if (env >= 0 && (acc < 0 || env < acc)) return "ENVASE";
  if (acc >= 0) {
    const m = t.match(ACCESSORY_RE)![0];
    if (DISPENSER_RE.test(m) || /pump|spray/.test(m)) return "DISPENSADOR";
    if (CLOSURE_RE.test(m)) return "CIERRE";
    return "DISPENSADOR";
  }
  return "OTRO";
}

export type AccessoryNeed = { role: "CIERRE" | "DISPENSADOR"; label: string; hint: string };

/**
 * Accesorios que SUELE necesitar un envase según su familia. Devuelve [] si no se reconoce la familia: ante la duda no
 * se inventa ninguna necesidad.
 */
export function accessoriesNeededBy(envaseDescription: string): AccessoryNeed[] {
  const t = fold(envaseDescription);
  if (!t || classifyRole(t) !== "ENVASE") return [];
  if (/\bairless\b/.test(t)) return [{ role: "DISPENSADOR", label: "sistema de dispensación", hint: "bomba airless compatible con la presentación" }];
  if (/roll[\s-]?on|rollon/.test(t))
    return [
      { role: "DISPENSADOR", label: "bolilla / aplicador", hint: "bolilla o aplicador roll-on" },
      { role: "CIERRE", label: "tapa", hint: "tapa del roll-on" },
    ];
  if (/\bgotero\b|\bdropper\b|\bcuentagotas\b/.test(t)) return [{ role: "DISPENSADOR", label: "dropper", hint: "dropper / pipeta compatible" }];
  if (/\bspray\b|\bpulverizador\b|\batomizador\b/.test(t)) return [{ role: "DISPENSADOR", label: "pulverizador", hint: "pulverizador compatible" }];
  if (/\bvalvula\b|\bpump\b|\bbomba\b|\bdosificador\b/.test(t)) return [{ role: "DISPENSADOR", label: "válvula", hint: "válvula / bomba compatible" }];
  if (/\bshampoo\b|\bacondicionador\b|\bjabon\b/.test(t)) return [{ role: "CIERRE", label: "tapa o dispensador", hint: "tapa o dispensador de la botella" }];
  if (/\bpote\b|\bjar\b|\btarro\b/.test(t)) return [{ role: "CIERRE", label: "tapa", hint: "tapa del pote" }];
  if (/\bpomo\b|\btubo\b/.test(t)) return [{ role: "CIERRE", label: "tapa", hint: "tapa del pomo" }];
  if (/\bfrasco\b|\bbotella\b|\benvase\b/.test(t)) return [{ role: "CIERRE", label: "tapa", hint: "tapa del envase" }];
  return [];
}

export const isSectorEnvasado = (s: string) => s === "ENVASADO_MASIVO" || s === "ENVASADO_PREMIUM";
