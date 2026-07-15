/**
 * @mock-temp Persistencia de "materia prima preparada" por OE — localStorage.
 * Cada tilde queda con usuario y fecha/hora. Desacoplado de la UI.
 */

export interface MpPreparationCheck {
  oeRef: string;
  codigo: string;
  preparedBy: string;
  preparedAt: string;
}

export interface MpConfirmation {
  oeRef: string;
  confirmedBy: string;
  confirmedAt: string;
}

const CHECKS_KEY = "genus_os_mp_preparation_checks";
const CONFIRMATIONS_KEY = "genus_os_mp_preparation_confirmations";

function readChecks(): MpPreparationCheck[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHECKS_KEY);
    return raw ? (JSON.parse(raw) as MpPreparationCheck[]) : [];
  } catch {
    return [];
  }
}

function writeChecks(items: MpPreparationCheck[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CHECKS_KEY, JSON.stringify(items));
}

export function getPreparedCodes(oeRef: string): MpPreparationCheck[] {
  return readChecks().filter((c) => c.oeRef === oeRef);
}

export function isCodePrepared(oeRef: string, codigo: string): boolean {
  return readChecks().some((c) => c.oeRef === oeRef && c.codigo === codigo);
}

export function setCodePrepared(
  oeRef: string,
  codigo: string,
  prepared: boolean,
  preparedBy: string
): void {
  const items = readChecks().filter((c) => !(c.oeRef === oeRef && c.codigo === codigo));
  if (prepared) {
    items.push({ oeRef, codigo, preparedBy, preparedAt: new Date().toISOString() });
  }
  writeChecks(items);
}

function readConfirmations(): MpConfirmation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CONFIRMATIONS_KEY);
    return raw ? (JSON.parse(raw) as MpConfirmation[]) : [];
  } catch {
    return [];
  }
}

function writeConfirmations(items: MpConfirmation[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CONFIRMATIONS_KEY, JSON.stringify(items));
}

export function getConfirmation(oeRef: string): MpConfirmation | null {
  return readConfirmations().find((c) => c.oeRef === oeRef) ?? null;
}

export function confirmPreparation(oeRef: string, confirmedBy: string): MpConfirmation {
  const confirmation: MpConfirmation = {
    oeRef,
    confirmedBy,
    confirmedAt: new Date().toISOString(),
  };
  const items = readConfirmations().filter((c) => c.oeRef !== oeRef);
  items.push(confirmation);
  writeConfirmations(items);
  return confirmation;
}

export function listAllConfirmations(): MpConfirmation[] {
  return [...readConfirmations()].sort(
    (a, b) => new Date(b.confirmedAt).getTime() - new Date(a.confirmedAt).getTime()
  );
}
