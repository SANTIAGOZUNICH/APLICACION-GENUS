/**
 * Proxy local WebSocket (TLS) → Postgres TCP, para que el driver `@neondatabase/serverless` de la app
 * (src/lib/db/client.ts, sin cambios) hable con un Postgres LOCAL de prueba.
 *
 * El driver abre `wss://<host>/v2` y manda por ahí los bytes crudos del protocolo Postgres; este proxy
 * hace exactamente eso hacia 127.0.0.1:<puerto Postgres>. Solo escucha en 127.0.0.1.
 *
 * Uso:   node scripts/e2e/local-pg-wsproxy.mjs --cert-dir .e2e-local/certs [--pg-port 5432] [--listen-port 443]
 * Genera (si faltan) cert.pem/key.pem para "localhost" y ca-bundle.pem (CA del sistema + este cert).
 * Los procesos que se conecten (app y tests) necesitan NODE_EXTRA_CA_CERTS=<cert-dir>/ca-bundle.pem.
 * Puerto 443: requiere root o CAP_NET_BIND_SERVICE (el driver no permite elegir el puerto sin tocar la app).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { WebSocketServer } = require("ws");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const certDir = path.resolve(arg("cert-dir", ".e2e-local/certs"));
const pgPort = Number(arg("pg-port", "5432"));
const listenPort = Number(arg("listen-port", "443"));

fs.mkdirSync(certDir, { recursive: true });
const keyPath = path.join(certDir, "key.pem");
const certPath = path.join(certDir, "cert.pem");
const bundlePath = path.join(certDir, "ca-bundle.pem");
if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "7",
    "-keyout", keyPath, "-out", certPath,
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ], { stdio: "ignore" });
}
// CA del sistema/proxy corporativo (si existe) + el cert local: NODE_EXTRA_CA_CERTS acepta un solo archivo.
const systemCa = process.env.GENUS_E2E_SYSTEM_CA ?? process.env.NODE_EXTRA_CA_CERTS;
const parts = [];
if (systemCa && fs.existsSync(systemCa) && path.resolve(systemCa) !== bundlePath) parts.push(fs.readFileSync(systemCa, "utf8"));
parts.push(fs.readFileSync(certPath, "utf8"));
fs.writeFileSync(bundlePath, parts.join("\n"));

const server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) });
const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  const sock = net.connect(pgPort, "127.0.0.1");
  const pending = [];
  sock.on("connect", () => {
    for (const chunk of pending) sock.write(chunk);
    pending.length = 0;
  });
  ws.on("message", (data) => (sock.readyState === "open" ? sock.write(data) : pending.push(data)));
  sock.on("data", (data) => ws.readyState === 1 && ws.send(data));
  sock.on("close", () => ws.close());
  sock.on("error", () => ws.close());
  ws.on("close", () => sock.destroy());
});
server.listen(listenPort, "127.0.0.1", () => {
  console.log(`[e2e-wsproxy] wss://localhost:${listenPort}/v2 → 127.0.0.1:${pgPort} · NODE_EXTRA_CA_CERTS=${bundlePath}`);
});
