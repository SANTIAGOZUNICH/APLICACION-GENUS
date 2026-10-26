import { describe, expect, it } from "vitest";
import { addressesOf, senderDomain, verifyOriginalRecipient, type Header } from "./recipient";

const TARGET = "pedidos@laboratoriogenus.com.ar";
const OWN = "agzunich@gmail.com";
const h = (pairs: Array<[string, string]>): Header[] => pairs.map(([name, value]) => ({ name, value }));
const verdict = (headers: Header[]) => verifyOriginalRecipient(headers, TARGET, OWN);

/**
 * OJO: estos juegos de encabezados son REPRESENTATIVOS de cómo suelen verse los reenvíos del lado servidor (Postfix/Webnode → Gmail); NO son
 * capturas reales del buzón (esta sesión no tiene acceso a él). La prueba real se hace con «Verificar filtro (sin analizar)» en la pantalla.
 */
describe("correos reenviados desde Webnode: se aceptan solo con destinatario original verificable en ENCABEZADOS", () => {
  it("reenvío del servidor que conserva To: (cliente escribió a pedidos@)", () => {
    const v = verdict(h([
      ["Delivered-To", OWN],
      ["Received", "by 2002:a05:6a20:1 with SMTP id x; Mon, 20 Oct 2026 09:00:00 -0700 (PDT)"],
      ["Received", "from mail.webnode.example (mail.webnode.example [203.0.113.5]) by mx.google.com with ESMTPS id abc for <agzunich@gmail.com> (Google Transport Security)"],
      ["From", "Compras Firmea <compras@firmea.com>"],
      ["To", "Pedidos Genus <pedidos@laboratoriogenus.com.ar>"],
    ]));
    expect(v).toMatchObject({ verified: true, strength: "declarada", evidence: ["To"] });
  });
  it("reenvío con X-Original-To / X-Forwarded-For (destinatario real agregado por el servidor): evidencia FUERTE aunque el To: diga otra cosa (Bcc)", () => {
    const v = verdict(h([
      ["Delivered-To", OWN],
      ["X-Original-To", "pedidos@laboratoriogenus.com.ar"],
      ["X-Forwarded-For", "pedidos@laboratoriogenus.com.ar agzunich@gmail.com"],
      ["To", "undisclosed-recipients:;"],
    ]));
    expect(v).toMatchObject({ verified: true, strength: "fuerte" });
    expect((v as { evidence: string[] }).evidence).toEqual(expect.arrayContaining(["X-Original-To", "X-Forwarded-For"]));
  });
  it("Delivered-To de una etapa anterior = pedidos@ (reenvío encadenado) es fuerte; el Delivered-To propio de Gmail NO cuenta", () => {
    expect(verdict(h([["Delivered-To", OWN], ["Delivered-To", TARGET]]))).toMatchObject({ verified: true, strength: "fuerte" });
    expect(verdict(h([["Delivered-To", OWN]]))).toMatchObject({ verified: false, reason: "sin_destinatario_original" });
  });
  it("cláusula «for <pedidos@…>» de un Received cuenta como evidencia declarada", () => {
    expect(verdict(h([["Received", "from mx1.webnode.example by mx.google.com with ESMTP id z for <pedidos@laboratoriogenus.com.ar>; Mon, 20 Oct 2026"]]))).toMatchObject({ verified: true, strength: "declarada", evidence: ["Received(for)"] });
  });
  it("Cc a pedidos@ cuenta (el mensaje también iba dirigido a esa casilla)", () => {
    expect(verdict(h([["To", "otro@cliente.com"], ["Cc", "Genus <PEDIDOS@LaboratorioGenus.com.ar>"]]))).toMatchObject({ verified: true, strength: "declarada" });
  });
});

describe("mensajes personales y encabezados ambiguos: se EXCLUYEN (no se leen ni van a la IA)", () => {
  it("correo personal que menciona «pedido» en el asunto: el asunto ni se consulta; sin destinatario original → excluido", () => {
    const v = verdict(h([["Delivered-To", OWN], ["From", "Amigo <amigo@hotmail.com>"], ["To", "Santiago <agzunich@gmail.com>"], ["Subject", "pedidos@laboratoriogenus.com.ar - te hago un pedido de pizza"]]));
    expect(v).toMatchObject({ verified: false, reason: "sin_destinatario_original" });
  });
  it("To con la dirección solo como NOMBRE para mostrar (engaño) no cuenta", () => {
    expect(verdict(h([["To", '"pedidos@laboratoriogenus.com.ar" <alguien@evil.com>']])).verified).toBe(false);
    expect(verdict(h([["To", "pedidos@laboratoriogenus.com.ar (nota) <alguien@evil.com>"]])).verified).toBe(true); // el comentario no oculta la dirección real
  });
  it("direcciones parecidas no cuentan: otro dominio, sufijo, prefijo, doble @", () => {
    for (const bad of ["pedidos@laboratoriogenus.com.ar.evil.com", "xpedidos@laboratoriogenus.com.ar", "pedidos@laboratoriogenus.com", "pedidos@laboratoriogenus.com.ar@evil.com", "pedidos@sub.laboratoriogenus.com.ar", "pedidos2@laboratoriogenus.com.ar"]) {
      expect(verdict(h([["To", bad]])).verified, bad).toBe(false);
    }
  });
  it("Bcc sin ningún rastro (To: undisclosed-recipients, sin X-Original-To) → NO verificable", () => {
    expect(verdict(h([["Delivered-To", OWN], ["To", "undisclosed-recipients:;"], ["From", "x@y.com"]]))).toMatchObject({ verified: false, reason: "sin_destinatario_original" });
  });
  it("sin encabezados → excluido por seguridad", () => {
    expect(verdict([])).toMatchObject({ verified: false, reason: "sin_encabezados" });
  });
  it("X-Forwarded-To / destino del reenvío NO equivale al destinatario original", () => {
    expect(verdict(h([["X-Forwarded-To", TARGET]])).verified).toBe(false);
  });
  it("utilidades: direcciones y dominio del remitente", () => {
    expect(addressesOf('"Nombre, Apellido" <A@B.com>, c@d.org; (x) e@f.net')).toEqual(["a@b.com", "c@d.org", "e@f.net"]);
    expect(senderDomain("Juan <juan@Empresa.com.ar>")).toBe("empresa.com.ar");
  });
});
