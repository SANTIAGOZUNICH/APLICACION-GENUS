import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { availableToRemit, deliveryKey, remittedEditProblem, type LineRemittance } from "./delivery-remittance";

const ref = (units: number, status = "GENERADO") => ({ id: "r1", number: "0001-00000001", status, units, key: "dl:x" });
const rem = (remitted: number, mark: LineRemittance["mark"] = null): LineRemittance => ({ remitted, remitos: remitted ? [ref(remitted)] : [], mark });

describe("availableToRemit", () => {
  it("800 recibidas con remito de 800 no se ofrecen de nuevo", () => expect(availableToRemit(800, rem(800))).toBe(0));
  it("800 con remito de 500 deja saldo 300 (nunca 400)", () => expect(availableToRemit(800, rem(500))).toBe(300));
  it("nunca es negativo", () => expect(availableToRemit(600, rem(800))).toBe(0));
  it("marcas manuales no se ofrecen", () => {
    expect(availableToRemit(800, rem(0, "EXCLUIDA"))).toBe(0);
    expect(availableToRemit(800, rem(0, "REMITO_EXTERNO"))).toBe(0);
  });
});

describe("remittedEditProblem", () => {
  it("sin remito vigente todo se puede corregir", () => {
    expect(remittedEditProblem(rem(0), { cancel: true, newQuantity: 100, boxesChanged: true })).toBeNull();
  });
  it("con remito vigente bloquea cancelar, bajar de lo remitido y cambiar cajas", () => {
    expect(remittedEditProblem(rem(800), { cancel: true, newQuantity: null, boxesChanged: false })).toMatch(/No se puede cancelar/);
    expect(remittedEditProblem(rem(800), { cancel: false, newQuantity: 600, boxesChanged: false })).toMatch(/No se puede bajar/);
    expect(remittedEditProblem(rem(800), { cancel: false, newQuantity: null, boxesChanged: true })).toMatch(/cajas/);
  });
  it("subir la cantidad u observaciones sí se permite", () => {
    expect(remittedEditProblem(rem(800), { cancel: false, newQuantity: 900, boxesChanged: false })).toBeNull();
    expect(remittedEditProblem(rem(800), { cancel: false, newQuantity: null, boxesChanged: false })).toBeNull();
  });
  it("remito externo bloquea cualquier cambio de cantidad", () => {
    expect(remittedEditProblem(rem(0, "REMITO_EXTERNO"), { cancel: false, newQuantity: 700, boxesChanged: false })).toMatch(/fuera de GENUS OS/);
  });
});

describe("deliveryKey", () => {
  it("la clave histórica no cambia y la parcial lleva token", () => {
    expect(deliveryKey("abc")).toBe("dl:abc");
    expect(deliveryKey("abc", "t1")).toBe("dl:abc:t1");
  });
});
