"use client";

import type { OperationalOrderRecord } from "@/lib/orders/types";

/** Vista de impresión/legal A4 — sin chrome de UI ni % completado. */
export function LegalOrderPreview({ order }: { order: OperationalOrderRecord }) {
  const c = order.formData;
  return (
    <div className="legal-a4 mx-auto max-w-[210mm] border border-neutral-400 bg-white p-6 text-[11px] text-black shadow print:border-0 print:shadow-none">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .legal-a4, .legal-a4 * { visibility: visible; }
          .legal-a4 { position: absolute; left: 0; top: 0; width: 210mm; }
          @page { size: A4; margin: 10mm; }
        }
      `}</style>
      <div className="mb-3 flex border border-neutral-700">
        <div className="w-[28%] p-2 font-bold">Laboratorio Genus</div>
        <div className="w-[44%] bg-neutral-200 p-2 text-center text-base font-bold">
          {c.kind === "OE" ? "OE" : "ORDEN DE ACONDICIONAMIENTO"}
        </div>
        <div className="w-[28%] p-2 text-center">{c.kind === "OE" ? "PT" : ""}</div>
      </div>

      {c.kind === "OE" ? (
        <>
          <div className="grid grid-cols-6 gap-0 border border-neutral-600 text-[10px]">
            <div className="col-span-2 border-r p-1 font-semibold">{c.header.productName}</div>
            <div className="border-r p-1">Código<br />{c.header.code}</div>
            <div className="border-r p-1">Fecha<br />{c.header.date}</div>
            <div className="border-r p-1">Cant. Kg<br />{c.header.quantityKg}</div>
            <div className="p-1">N° Lote / Vigencia<br />{c.header.lot} / {c.header.vigencia}</div>
          </div>
          <p className="mt-1">Cliente: {c.header.client} · Envase cúbica: {c.header.envaseCubica} · Equipo: {c.header.equipoCalefactor}</p>
          <h4 className="mt-3 bg-neutral-200 px-1 font-bold">MATERIAS PRIMAS</h4>
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="bg-neutral-100">
                {["Materia prima", "Código", "Fórmula %", "kg a pesar", "Ajuste", "Lote"].map((h) => (
                  <th key={h} className="border p-1 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.materials.map((m) => (
                <tr key={m.id}>
                  <td className="border p-1">{m.materiaPrima}</td>
                  <td className="border p-1">{m.codigo}</td>
                  <td className="border p-1">{m.formulaPct}</td>
                  <td className="border p-1">{m.kgAPesar}</td>
                  <td className="border p-1">{m.ajuste}</td>
                  <td className="border p-1">{m.lote}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1">Total %: {c.totals.formulaPctSum} · Total kg: {c.totals.kgSum} · Firma pesada: ________</p>
          <h4 className="mt-3 bg-neutral-200 px-1 font-bold">PROCEDIMIENTO DE ELABORACIÓN</h4>
          <ol className="list-decimal pl-4">
            {c.procedureSteps.map((s) => (
              <li key={s.id}>{s.text}</li>
            ))}
          </ol>
          <h4 className="mt-3 bg-neutral-200 px-1 font-bold">Control de proceso / calidad</h4>
          <p>
            Aspecto {c.processControl.aspecto} · Color {c.processControl.color} · Olor{" "}
            {c.processControl.olor} · pH {c.processControl.ph} · Viscosidad{" "}
            {c.processControl.viscosidad}
          </p>
          <p>
            Cant. real {c.processControl.cantidadReal} · Merma {c.processControl.mermaPct}% · Cant.
            obt. {c.processControl.cantidadObtenida} · Fecha {c.processControl.fechaFin}
          </p>
          <p>Análisis granel: {c.qualityControl.resultado}</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="h-14 border p-1">Firma Producción</div>
            <div className="h-14 border p-1">Firma Control de Calidad</div>
            <div className="h-14 border p-1">Firma Dirección Técnica</div>
          </div>
        </>
      ) : (
        <>
          <p className="font-semibold">
            PRODUCTO: {c.header.productName} · CLIENTE: {c.header.client}
          </p>
          <p>
            LOTE: {c.header.lot} · ANALISIS: {c.header.analisis} · CODIGO: {c.header.productCode} ·
            VTO: {c.header.vto}
          </p>
          <p>
            APROBO: {c.header.aprobo} · FECHA EMISION: {c.header.fechaEmision}
          </p>
          <h4 className="mt-3 bg-neutral-200 px-1 font-bold">ANALISIS DE GRANEL</h4>
          <p>RESULTADO: {c.analisisGranel.resultado} · FIRMA: ________</p>
          <h4 className="mt-3 bg-neutral-200 px-1 font-bold">
            SUMINISTRO DE MATERIALES DE ACONDICIONAMIENTO
          </h4>
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="bg-neutral-100">
                {["Nº", "Codigo", "Nombre", "Recibidos", "Desechados", "Usados", "Fecha", "Resp."].map(
                  (h) => (
                    <th key={h} className="border p-1 text-left">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {c.materials.map((m) => (
                <tr key={m.id}>
                  <td className="border p-1">{m.nro}</td>
                  <td className="border p-1">{m.codigo}</td>
                  <td className="border p-1">{m.nombreInsumo}</td>
                  <td className="border p-1">{m.recibidos}</td>
                  <td className="border p-1">{m.desechados}</td>
                  <td className="border p-1">{m.usados}</td>
                  <td className="border p-1">{m.fecha}</td>
                  <td className="border p-1">{m.responsable}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4 className="mt-3 bg-neutral-200 px-1 font-bold">ENVASADO / RENDIMIENTOS</h4>
          <p>
            Inicio {c.envasado.fechaInicio} · Fin {c.envasado.fechaTerminacion} · Operarios{" "}
            {c.envasado.operarios}
          </p>
          <p>
            Teórica {c.rendimientos.produccionTeoricaUnidades} · Unidades{" "}
            {c.rendimientos.cantidadUnidades} · Rendimiento A {c.rendimientos.rendimientoA}% (
            {c.rendimientos.rangoTeorico})
          </p>
          <p>Observaciones: {c.observaciones}</p>
          <h4 className="mt-3 bg-neutral-200 px-1 font-bold">
            CONTROLES EN PROCESO — Etiquetado / Codificado
          </h4>
          <p>{c.etiquetadoCodificadoLegalText}</p>
          <p>
            Resultado PT: {c.analisisProductoTerminado.resultado} · FIRMA: ________
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="h-14 border p-1">AUTORIZACION PRODUCCION</div>
            <div className="h-14 border p-1">AUTORIZACION CONTROL CALIDAD</div>
            <div className="h-14 border p-1">AUTORIZACION DIRECCION TECNICA</div>
          </div>
        </>
      )}

      <p className="mt-4 text-[9px] text-neutral-600">
        {order.orderNumber} · plantilla v{order.templateVersion} · rev {order.revision} · id{" "}
        {order.id} · generado {new Date().toISOString()}
      </p>
    </div>
  );
}
