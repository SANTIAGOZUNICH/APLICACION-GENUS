<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

The whole product is a single Next.js 16 (App Router) app that lives in `frontend/` — run every command from there (npm, Node 20+). Standard scripts live in `frontend/package.json` / `frontend/README.md`: `npm run dev` (port 3000), `npm run lint`, `npm run test` (Vitest), `npm run build`.

- **Demo mode needs zero external services.** Copy `.env.example` to `.env.local` (defaults `GENUS_DATA_MODE=demo` + in-memory auth). No Postgres, Google, or AI keys are required to run and browse the app. `npm run build` runs `scripts/migrate-if-database.mjs` first, which is a no-op without a DB URL.
- **Local login cannot authenticate (non-obvious).** The in-memory auth backend starts empty and is never seeded in local dev, so the `/login` form always fails (`POST /api/v1/auth/login` → 401). Real login requires Neon: `DATABASE_URL` + `GENUS_AUTH_BACKEND=neon` + migration 0016 applied + `APPLY_AUTH_SEED=1 node scripts/seed-genus-auth.mjs`. Note the runtime DB client (`src/lib/db/client.ts`) uses the Neon serverless **WebSocket** driver, so a plain local Postgres will not work without a Neon-compatible endpoint.
- **To browse the demo UI without a DB:** the client app gates on a preview session in web storage (`genus_os_auth_session`) and `src/middleware.ts` only checks that a `genus_session` cookie is *present* (it never validates it). Inject a demo session from the browser console, then navigate:
  ```js
  const s={status:"preview",mode:"preview",user:{email:"produccion@laboratoriogenus.com.ar",displayName:"Producción",jobTitle:"Supervisora de Planta",company:"Laboratorio Genus"},sector:{id:"PRODUCCION",label:"Producción"},role:{id:"ROL-SU",label:"Supervisora"},rememberMe:true,redirectTo:"/mi-trabajo",createdAt:new Date().toISOString()};
  localStorage.setItem("genus_os_auth_session",JSON.stringify(s));
  document.cookie="genus_session=demo; path=/";
  location.href="/mi-trabajo";
  ```
  Valid sector ids/labels come from `src/features/os/auth/lib/mock-preview-users.ts`.
- **Authenticated API calls in dev:** set `GENUS_AUTH_ALLOW_TEST_HEADERS=1` in `.env.local` to let `/api/v1/*` resolve identity from the `x-genus-actor-email` header (dev/test only; the browser does not send it).
- **Lint baseline:** `npm run lint` currently reports pre-existing errors/warnings. Treat that as the repo baseline, not an environment problem.
