import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COOKIE_NAME } from "@/lib/auth/cookies";
import { SECTOR_ACCOUNT_DIRECTORY } from "@/lib/auth/directory";
import { setAuthRepositoryForTests } from "@/lib/auth/get-auth-service";
import { MemoryAuthRepository } from "@/lib/auth/memory-repository";
import { AuthService } from "@/lib/auth/service";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { POST as logoutRoute } from "@/app/api/v1/auth/logout/route";
import { GET as meRoute } from "@/app/api/v1/auth/me/route";

const ANA = SECTOR_ACCOUNT_DIRECTORY[0];

function extractCookieValue(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]*)`));
  return match ? match[1] : null;
}

function jsonRequest(url: string, body: unknown, extraHeaders?: Record<string, string>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

function getRequest(url: string, cookie?: string): Request {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new Request(url, { headers });
}

describe("/api/v1/auth routes", () => {
  beforeEach(async () => {
    const repo = new MemoryAuthRepository();
    setAuthRepositoryForTests(repo);
    await new AuthService(repo).ensureUsersSeeded({ [ANA.email]: "clave-segura-1" });
  });

  afterEach(() => {
    setAuthRepositoryForTests(null);
  });

  it("POST /login con credenciales correctas setea la cookie y devuelve el user sin password", async () => {
    const response = await loginRoute(
      jsonRequest("https://example.test/api/v1/auth/login", {
        email: ANA.email,
        password: "clave-segura-1",
      })
    );
    expect(response.status).toBe(200);

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain(`${COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");

    const body = (await response.json()) as { user: Record<string, unknown> };
    expect(body.user.email).toBe(ANA.email);
    expect(body.user.sector).toBe(ANA.sector);
    expect(body.user).not.toHaveProperty("password");
    expect(body.user).not.toHaveProperty("passwordHash");
  });

  it("POST /login con password incorrecta devuelve 401 sin filtrar si el email existe", async () => {
    const responseWrongPassword = await loginRoute(
      jsonRequest("https://example.test/api/v1/auth/login", {
        email: ANA.email,
        password: "incorrecta",
      })
    );
    const responseUnknownEmail = await loginRoute(
      jsonRequest("https://example.test/api/v1/auth/login", {
        email: "nadie@laboratoriogenus.com.ar",
        password: "incorrecta",
      })
    );

    expect(responseWrongPassword.status).toBe(401);
    expect(responseUnknownEmail.status).toBe(401);
    const [bodyWrong, bodyUnknown] = await Promise.all([
      responseWrongPassword.json(),
      responseUnknownEmail.json(),
    ]);
    expect(bodyWrong.error).toBe(bodyUnknown.error);
  });

  it("GET /me devuelve 401 sin cookie", async () => {
    const response = await meRoute(getRequest("https://example.test/api/v1/auth/me"));
    expect(response.status).toBe(401);
  });

  it("GET /me devuelve el actor autenticado con una cookie válida emitida por /login", async () => {
    const loginResponse = await loginRoute(
      jsonRequest("https://example.test/api/v1/auth/login", {
        email: ANA.email,
        password: "clave-segura-1",
      })
    );
    const token = extractCookieValue(loginResponse.headers.get("set-cookie"));
    expect(token).toBeTruthy();

    const meResponse = await meRoute(
      getRequest("https://example.test/api/v1/auth/me", `${COOKIE_NAME}=${token}`)
    );
    expect(meResponse.status).toBe(200);
    const body = (await meResponse.json()) as { user: Record<string, unknown> };
    expect(body.user.email).toBe(ANA.email);
  });

  it("POST /logout revoca la sesión: /me vuelve a devolver 401 con la misma cookie", async () => {
    const loginResponse = await loginRoute(
      jsonRequest("https://example.test/api/v1/auth/login", {
        email: ANA.email,
        password: "clave-segura-1",
      })
    );
    const token = extractCookieValue(loginResponse.headers.get("set-cookie"));
    const cookieHeader = `${COOKIE_NAME}=${token}`;

    const logoutResponse = await logoutRoute(
      new Request("https://example.test/api/v1/auth/logout", {
        method: "POST",
        headers: { cookie: cookieHeader },
      })
    );
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers.get("set-cookie")).toContain("Max-Age=0");

    const meResponse = await meRoute(getRequest("https://example.test/api/v1/auth/me", cookieHeader));
    expect(meResponse.status).toBe(401);
  });
});
