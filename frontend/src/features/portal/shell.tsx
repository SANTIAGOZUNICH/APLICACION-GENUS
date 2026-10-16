"use client";

import type { ReactNode } from "react";

export function PortalHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="gp-header">
      <div className="gp-wrap gp-header-in">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="gp-logo" src="/entregas/logo-genus.png" alt="Laboratorio Genus" width={89} height={46} />
        <div className="gp-brand">
          <b>GENUS | Portal de Clientes</b>
          <span>Tu producción, en buenas manos.</span>
        </div>
        <div className="gp-spacer" />
        {right}
      </div>
    </header>
  );
}
