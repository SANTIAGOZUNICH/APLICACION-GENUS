/** Contexto periférico del Hero — "Cristian · jueves". */
export function formatGreetingContext(firstName: string, now = new Date()): string {
  const day = new Intl.DateTimeFormat("es-AR", { weekday: "long" }).format(now);
  return `${firstName} · ${day}`;
}
