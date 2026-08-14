import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CANONICAL_PRODUCTION_HOST,
  getCanonicalProductionHost,
  shouldRedirectToCanonicalHost,
  shouldRedirectToCanonicalPreviewHost,
} from "./canonical-host";

const ORIGINAL_CANONICAL_HOST = process.env.CANONICAL_HOST;

afterEach(() => {
  if (ORIGINAL_CANONICAL_HOST === undefined) delete process.env.CANONICAL_HOST;
  else process.env.CANONICAL_HOST = ORIGINAL_CANONICAL_HOST;
});

/**
 * Regresión: login "aparentemente correcto" pero el usuario queda
 * expulsado inmediatamente — causa raíz real: el deployment de Production
 * tiene varios alias de Vercel (appgenus.vercel.app,
 * aplicacion-genus-<team>.vercel.app, aplicacion-genus-git-main-<team>
 * .vercel.app, y uno nuevo por deploy) y la cookie de sesión es host-only
 * (nunca setea Domain=) — si el login ocurre en un alias distinto del que
 * usa la navegación siguiente, la cookie no viaja y el middleware expulsa
 * al usuario como si nunca hubiera iniciado sesión, sin que haya ningún
 * código específico de sector involucrado.
 */
describe("shouldRedirectToCanonicalHost", () => {
  it("redirige en Production cuando el host no es el canónico", () => {
    expect(
      shouldRedirectToCanonicalHost({
        vercelEnv: "production",
        hostname: "aplicacion-genus-santizunich-2879s-projects.vercel.app",
        isApiRequest: false,
      })
    ).toBe(true);
  });

  it("no redirige si ya está en el host canónico", () => {
    expect(
      shouldRedirectToCanonicalHost({
        vercelEnv: "production",
        hostname: DEFAULT_CANONICAL_PRODUCTION_HOST,
        isApiRequest: false,
      })
    ).toBe(false);
  });

  it("nunca redirige en Preview — cada deploy de Preview tiene su propio hostname único", () => {
    expect(
      shouldRedirectToCanonicalHost({
        vercelEnv: "preview",
        hostname: "aplicacion-genus-git-feature-x-santizunich-2879s-projects.vercel.app",
        isApiRequest: false,
      })
    ).toBe(false);
  });

  it("nunca redirige en local (VERCEL_ENV indefinido)", () => {
    expect(
      shouldRedirectToCanonicalHost({
        vercelEnv: undefined,
        hostname: "localhost",
        isApiRequest: false,
      })
    ).toBe(false);
  });

  it("nunca redirige requests de API — las fetches de la SPA son same-origin relativas", () => {
    expect(
      shouldRedirectToCanonicalHost({
        vercelEnv: "production",
        hostname: "aplicacion-genus-santizunich-2879s-projects.vercel.app",
        isApiRequest: true,
      })
    ).toBe(false);
  });

  it("respeta un override explícito de canonicalHost sobre el default", () => {
    expect(
      shouldRedirectToCanonicalHost({
        vercelEnv: "production",
        hostname: "custom-domain.example.com",
        isApiRequest: false,
        canonicalHost: "custom-domain.example.com",
      })
    ).toBe(false);
  });
});

/**
 * Regresión: "Sesión vencida" constante en el Preview de PR #74 con una
 * sesión en realidad válida — causa raíz real: cada deployment de Preview
 * expone DOS hostnames válidos para el mismo build (VERCEL_URL propio +
 * alias de rama VERCEL_BRANCH_URL), confirmado contra la API de Vercel
 * para el deployment real de este PR. La cookie de sesión es host-only —
 * saltar entre ambos hostnames (pestaña vieja, link distinto, bookmark) dej
 * a una request sin cookie y el middleware la trata como sesión vencida
 * aunque el login siga siendo válido en el otro hostname. Distinto del bug
 * de Production (canónico fijo appgenus.vercel.app): acá no hay un dominio
 * fijo, el canónico es el propio VERCEL_URL de ESTE deployment.
 */
describe("shouldRedirectToCanonicalPreviewHost", () => {
  it("redirige en Preview cuando el hostname no es el propio deployment (VERCEL_URL)", () => {
    expect(
      shouldRedirectToCanonicalPreviewHost({
        vercelEnv: "preview",
        hostname: "aplicacion-genus-git-fix-remi-ad97b6-santizunich-2879s-projects.vercel.app",
        isApiRequest: false,
        deploymentHost: "aplicacion-genus-p3rf1lm04-santizunich-2879s-projects.vercel.app",
      })
    ).toBe(true);
  });

  it("no redirige si ya está en el hostname propio del deployment", () => {
    expect(
      shouldRedirectToCanonicalPreviewHost({
        vercelEnv: "preview",
        hostname: "aplicacion-genus-p3rf1lm04-santizunich-2879s-projects.vercel.app",
        isApiRequest: false,
        deploymentHost: "aplicacion-genus-p3rf1lm04-santizunich-2879s-projects.vercel.app",
      })
    ).toBe(false);
  });

  it("nunca redirige en Production — usa el canónico fijo, no VERCEL_URL", () => {
    expect(
      shouldRedirectToCanonicalPreviewHost({
        vercelEnv: "production",
        hostname: "aplicacion-genus-git-main-santizunich-2879s-projects.vercel.app",
        isApiRequest: false,
        deploymentHost: "aplicacion-genus-abc123-santizunich-2879s-projects.vercel.app",
      })
    ).toBe(false);
  });

  it("nunca redirige en local (VERCEL_ENV indefinido)", () => {
    expect(
      shouldRedirectToCanonicalPreviewHost({
        vercelEnv: undefined,
        hostname: "localhost",
        isApiRequest: false,
        deploymentHost: undefined,
      })
    ).toBe(false);
  });

  it("nunca redirige requests de API — las fetches de la SPA son same-origin relativas", () => {
    expect(
      shouldRedirectToCanonicalPreviewHost({
        vercelEnv: "preview",
        hostname: "aplicacion-genus-git-fix-remi-ad97b6-santizunich-2879s-projects.vercel.app",
        isApiRequest: true,
        deploymentHost: "aplicacion-genus-p3rf1lm04-santizunich-2879s-projects.vercel.app",
      })
    ).toBe(false);
  });

  it("no redirige (fail-open) si VERCEL_URL no está disponible", () => {
    expect(
      shouldRedirectToCanonicalPreviewHost({
        vercelEnv: "preview",
        hostname: "aplicacion-genus-git-fix-remi-ad97b6-santizunich-2879s-projects.vercel.app",
        isApiRequest: false,
        deploymentHost: undefined,
      })
    ).toBe(false);
  });
});

describe("getCanonicalProductionHost", () => {
  it("usa el default (appgenus.vercel.app) sin CANONICAL_HOST", () => {
    delete process.env.CANONICAL_HOST;
    expect(getCanonicalProductionHost()).toBe(DEFAULT_CANONICAL_PRODUCTION_HOST);
  });

  it("respeta CANONICAL_HOST si está configurado", () => {
    process.env.CANONICAL_HOST = "otro-dominio.example.com";
    expect(getCanonicalProductionHost()).toBe("otro-dominio.example.com");
  });
});
