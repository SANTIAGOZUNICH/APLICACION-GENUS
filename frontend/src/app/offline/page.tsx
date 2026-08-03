"use client";

import Link from "next/link";

/** Pantalla offline segura — sin datos operativos cacheados. */
export default function OfflinePage() {
  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center"
      style={{ background: "#071925", color: "#eaf3f6" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icons/icon-192.png"
        alt="Genus OS"
        width={96}
        height={96}
        style={{ borderRadius: 20 }}
      />
      <div className="max-w-sm space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">Sin conexión</h1>
        <p className="text-sm leading-relaxed" style={{ color: "#93a8b4" }}>
          Genus OS necesita internet para operar. No se muestran datos operativos
          sin conexión y no se simulan guardados.
        </p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-11 rounded-xl px-5 py-3 text-sm font-medium"
          style={{ background: "#12bfb7", color: "#071925" }}
        >
          Reintentar
        </button>
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border px-5 py-3 text-sm font-medium"
          style={{ borderColor: "#1e3a4a", color: "#eaf3f6" }}
        >
          Ir al ingreso
        </Link>
      </div>
    </main>
  );
}
