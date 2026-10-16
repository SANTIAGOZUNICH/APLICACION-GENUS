/** Plantillas de correo del portal (HTML con la marca de Laboratorio Genus + texto plano). Sin datos internos. */
import { portalContact } from "./config";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const LOGO_URL = "https://www.laboratoriogenus.com.ar/assets/logo-genus.png";
const NAVY = "#0b2f57";
const BLUE = "#0b5cab";
const TURQ = "#4fbfcf";

export type EmailContent = { subject: string; text: string; html: string };

function shell(title: string, bodyHtml: string, footerNote: string): string {
  const c = portalContact();
  return `<!doctype html><html lang="es"><body style="margin:0;background:#eef3f9;font-family:Helvetica,Arial,sans-serif;color:${NAVY}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 18px rgba(11,47,87,.08)">
<tr><td style="background:${NAVY};padding:18px 28px"><img src="${LOGO_URL}" alt="Laboratorio Genus" height="44" style="display:block;background:#fff;border-radius:8px;padding:4px 10px"></td></tr>
<tr><td style="padding:28px 28px 8px"><div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${TURQ};font-weight:700">Portal de Clientes</div>
<h1 style="margin:6px 0 0;font-size:22px;line-height:1.3;color:${NAVY}">${esc(title)}</h1></td></tr>
<tr><td style="padding:12px 28px 24px;font-size:15px;line-height:1.6;color:#1d3a5c">${bodyHtml}</td></tr>
<tr><td style="padding:18px 28px;background:#f6f9fd;font-size:12px;line-height:1.6;color:#5b7391">${footerNote}<br>
Laboratorio Genus · <a href="mailto:${esc(c.email)}" style="color:${BLUE}">${esc(c.email)}</a> · WhatsApp <a href="${esc(c.whatsappUrl)}" style="color:${BLUE}">${esc(c.whatsappLabel)}</a></td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:22px 0"><a href="${esc(href)}" style="background:${NAVY};color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:12px;font-weight:700;display:inline-block">${esc(label)}</a></p>`;

export function loginEmail(args: { clientName: string; otp: string; link: string; ttlMinutes: number }): EmailContent {
  const subject = "Tu código de acceso | Laboratorio Genus";
  const text = `Hola,\n\nTu código para ingresar al Portal de Clientes de ${args.clientName} es: ${args.otp}\nVence en ${args.ttlMinutes} minutos y sirve una sola vez.\n\nTambién podés ingresar con este enlace seguro:\n${args.link}\n\nSi no lo pediste vos, ignorá este correo: nadie puede ingresar sin él.\n\nLaboratorio Genus`;
  const html = shell(
    "Tu código de acceso",
    `<p>Para ingresar al portal de <b>${esc(args.clientName)}</b> usá este código:</p>
<p style="margin:18px 0;font-size:34px;letter-spacing:.32em;font-weight:800;color:${NAVY};text-align:center;background:#eaf3fb;border-radius:12px;padding:14px 8px">${esc(args.otp)}</p>
<p>Vence en ${args.ttlMinutes} minutos y sirve una sola vez.</p>${button(args.link, "Ingresar al portal")}`,
    "Si no pediste este código, ignorá el correo: nadie puede ingresar sin él."
  );
  return { subject, text, html };
}

export function invitationEmail(args: { clientName: string; publicCode: string; portalUrl: string }): EmailContent {
  const subject = "Ya podés seguir tu producción | Laboratorio Genus";
  const text = `Hola,\n\nLaboratorio Genus te habilitó el acceso al Portal de Clientes de ${args.clientName}.\n\nTu código de cliente: ${args.publicCode}\nIngresá en: ${args.portalUrl}\n\nVas a poner tu código de cliente y este correo; te enviaremos un código temporal para entrar. El código de cliente solo no alcanza para ingresar.\n\nLaboratorio Genus`;
  const html = shell(
    "Tu acceso al Portal de Clientes",
    `<p>Laboratorio Genus habilitó este correo para seguir las producciones de <b>${esc(args.clientName)}</b>.</p>
<p>Tu código de cliente es <b style="letter-spacing:.12em">${esc(args.publicCode)}</b>.</p>
<p>Ingresá con tu código de cliente y este correo: te enviamos un código temporal para entrar. El código de cliente solo no alcanza para ingresar.</p>${button(args.portalUrl, "Abrir el portal")}`,
    "Recibís este correo porque Laboratorio Genus autorizó tu dirección."
  );
  return { subject, text, html };
}

export function readyEmail(args: { clientName: string; product: string; quantity: string | null; portalUrl: string }): EmailContent {
  const c = portalContact();
  const subject = "Tu producto está listo | Laboratorio Genus";
  const qty = args.quantity ? `Cantidad disponible: ${args.quantity}\n` : "";
  const text = `Hola ${args.clientName},\n\n¡Tu producto está listo para entregar!\n\nProducto: ${args.product}\n${qty}\nPodés coordinar la entrega con nuestro equipo:\n- Respondiendo este correo o escribiendo a ${c.email}\n- Por WhatsApp: ${c.whatsappLabel}\n\nSeguí el detalle en el portal:\n${args.portalUrl}\n\nGracias por confiar en Laboratorio Genus.`;
  const html = shell(
    "¡Tu producto está listo!",
    `<p>Hola <b>${esc(args.clientName)}</b>,</p>
<p>Tu producto ya está listo para entregar.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0;border-collapse:collapse;width:100%">
<tr><td style="padding:10px 14px;background:#eaf3fb;border-radius:10px 10px 0 0"><span style="font-size:12px;color:#5b7391">Producto</span><br><b style="font-size:16px">${esc(args.product)}</b></td></tr>
${args.quantity ? `<tr><td style="padding:10px 14px;background:#f2f8fd;border-radius:0 0 10px 10px"><span style="font-size:12px;color:#5b7391">Cantidad disponible</span><br><b style="font-size:16px">${esc(args.quantity)}</b></td></tr>` : ""}
</table>
<p><b>Cómo coordinar la entrega:</b> respondé este correo, escribinos a <a href="mailto:${esc(c.email)}" style="color:${BLUE}">${esc(c.email)}</a> o por <a href="${esc(c.whatsappUrl)}" style="color:${BLUE}">WhatsApp</a>.</p>${button(args.portalUrl, "Ver mi pedido")}`,
    "Gracias por confiar en Laboratorio Genus."
  );
  return { subject, text, html };
}
