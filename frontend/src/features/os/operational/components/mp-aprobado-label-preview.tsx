"use client";

import type { MpAprobadoLabelData } from "@/lib/inventory/mp-aprobado-label";

/**
 * Vista previa visual 1:1 del PDF (misma distribución).
 * Se usa en el modal cuando el visor PDF del navegador no rasteriza el iframe.
 */
export function MpAprobadoLabelPreview({ data }: { data: MpAprobadoLabelData }) {
  return (
    <div
      className="mx-auto w-full max-w-[360px] bg-white p-1.5 text-black"
      data-testid="mp-label-html-preview"
    >
      <div className="border-[2.5px] border-black">
        <div className="flex items-center gap-2 px-2 py-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/laboratorio-genus-logo-thermal.png"
            alt="Laboratorio Genus"
            className="h-8 w-auto object-contain"
          />
          <div className="flex-1 text-right text-[22px] font-bold tracking-wide">
            APROBADO
          </div>
        </div>
        <div className="bg-black py-1.5 text-center text-[12px] font-bold tracking-[0.15em] text-white">
          MATERIA PRIMA
        </div>
        <div className="border-t border-black">
          <div className="grid grid-cols-[1.85fr_1fr] border-b border-black">
            <Cell label="PRODUCTO:" value={data.producto} border />
            <Cell label="PCC-ME Nº:" value={data.pccMeNro} small />
          </div>
          <div className="grid grid-cols-3 border-b border-black">
            <Cell label="INGRESO:" value={data.ingreso} border />
            <Cell label="Nº DE REMITO:" value={data.remitoNro} border small />
            <Cell label="CANTIDAD:" value={data.cantidad} />
          </div>
          <div className="border-b border-black">
            <Cell label="PROVEEDOR:" value={data.proveedor} />
          </div>
          <div className="grid grid-cols-2">
            <Cell label="Nº DE BULTOS:" value={data.bultos} border />
            <Cell label="Nº DE LOTE PROVEEDOR:" value={data.loteProveedor} small />
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-center text-[9px] tracking-wide">
        FORM. APROBADO MATERIA PRIMA
      </p>
    </div>
  );
}

function Cell({
  label,
  value,
  border,
  small,
}: {
  label: string;
  value: string;
  border?: boolean;
  small?: boolean;
}) {
  return (
    <div className={`min-h-[52px] px-1.5 py-1 ${border ? "border-r border-black" : ""}`}>
      <div className="text-[8px] font-bold uppercase leading-tight">{label}</div>
      <div
        className={`mt-1 flex min-h-[28px] items-center justify-center text-center font-bold uppercase leading-tight ${
          small ? "text-[12px]" : "text-[14px]"
        }`}
      >
        {value || "\u00A0"}
      </div>
    </div>
  );
}
