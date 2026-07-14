/**
 * Protección anti-retroceso: una versión/revision ya aplicada
 * no puede ser sobrescrita por una respuesta stale de otra instancia.
 */

export function shouldAcceptLiveSyncUpdate(options: {
  appliedRevision: number | null | undefined;
  appliedVersion: string | null | undefined;
  incomingRevision?: number | null;
  incomingVersion: string;
}): boolean {
  const appliedRev =
    options.appliedRevision === null || options.appliedRevision === undefined
      ? null
      : options.appliedRevision;
  const incomingRev =
    options.incomingRevision === null || options.incomingRevision === undefined
      ? null
      : options.incomingRevision;

  if (appliedRev !== null && incomingRev !== null) {
    if (incomingRev < appliedRev) return false;
    if (incomingRev > appliedRev) return true;
    // misma revision: solo aceptar si la version coincide (idempotente)
    if (options.appliedVersion) {
      return options.appliedVersion === options.incomingVersion;
    }
    return true;
  }

  if (
    options.appliedVersion &&
    options.appliedVersion === options.incomingVersion
  ) {
    return true;
  }

  // Sin revision comparable: aceptar (primera aplicación o bootstrap)
  return true;
}
