"use client";

import type { OperationalOrderRecord } from "@/lib/orders/types";

function oaOperariosText(order: Extract<OperationalOrderRecord["formData"], { kind: "OA" }>) {
  const fromList = (order.envasado.operariosList ?? [])
    .map((o) => o.nombre.trim())
    .filter(Boolean);
  if (fromList.length > 0) return fromList.join(", ");
  return order.envasado.operarios?.trim() ?? "";
}

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
        <div className="flex w-[28%] items-center gap-2 p-2 font-bold">
          {c.kind === "OA" ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/laboratorio-genus-logo.jpg"
                alt=""
                className="h-8 w-auto object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              <span>LABORATORIO GENUS</span>
            </>
          ) : (
            <span>Laboratorio Genus</span>
          )}
        </div>
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
                  <td className="border p-1">{m.ajuste ?? ""}</td>
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
          <div className="grid grid-cols-2 gap-0 border border-neutral-600 text-[10px]">
            <div className="border-r p-1">
              <div className="text-neutral-600">PRODUCTO</div>
              <div className="font-semibold">{c.header.productName}</div>
            </div>
            <div className="p-1">
              <div className="text-neutral-600">CLIENTE</div>
              <div className="font-semibold">{c.header.client}</div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-0 border border-t-0 border-neutral-600 text-[10px]">
            <div className="border-r p-1">
              <div className="text-neutral-600">LOTE</div>
              <div className="font-semibold">{c.header.lot}</div>
            </div>
            <div className="border-r p-1">
              <div className="text-neutral-600">ANALISIS</div>
              <div className="font-semibold">{c.header.analisis}</div>
            </div>
            <div className="border-r p-1">
              <div className="text-neutral-600">CODIGO PRODUCTO</div>
              <div className="font-semibold">{c.header.productCode}</div>
            </div>
            <div className="p-1">
              <div className="text-neutral-600">VTO</div>
              <div className="font-semibold">{c.header.vto}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-0 border border-t-0 border-neutral-600 text-[10px]">
            <div className="border-r p-1">
              <div className="text-neutral-600">APROBO</div>
              <div className="font-semibold">{c.header.aprobo}</div>
            </div>
            <div className="p-1">
              <div className="text-neutral-600">FECHA DE EMISION</div>
              <div className="font-semibold">{c.header.fechaEmision}</div>
            </div>
          </div>

          <h4 className="mt-3 bg-neutral-200 px-1 font-bold">ANALISIS DE GRANEL</h4>
          <div className="flex gap-2 text-[10px]">
            <div className="flex-1 border p-1">
              RESULTADO: {c.analisisGranel.resultado}
            </div>
            <div className="h-14 w-[30%] border p-1">FIRMA</div>
          </div>

          <h4 className="mt-3 bg-neutral-200 px-1 font-bold">
            SUMINISTRO DE MATERIALES DE ACONDICIONAMIENTO
          </h4>
          <p className="text-[10px]">FECHA: {c.materialsFecha}</p>
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="bg-neutral-100">
                {[
                  "Nº",
                  "Codigo",
                  "Nombre",
                  "Recibidos",
                  "Desechados",
                  "Usados",
                  "Fecha",
                  "Responsable",
                ].map((h) => (
                  <th key={h} className="border p-1 text-left">
                    {h}
                  </th>
                ))}
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

          <h4 className="mt-3 bg-neutral-200 px-1 font-bold">ENVASADO</h4>
          <div className="grid grid-cols-3 gap-0 border border-neutral-600 text-[10px]">
            <div className="border-r p-1">
              <div className="text-neutral-600">FECHA DE INICIO</div>
              <div>{c.envasado.fechaInicio}</div>
            </div>
            <div className="border-r p-1">
              <div className="text-neutral-600">FECHA DE TERMINACION</div>
              <div>{c.envasado.fechaTerminacion}</div>
            </div>
            <div className="p-1">
              <div className="text-neutral-600">OPERARIOS INTERVINIENTES</div>
              <div>{oaOperariosText(c)}</div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-[58%_1fr] gap-2">
            <div className="border border-neutral-600 p-2">
              <h4 className="mb-1 bg-neutral-200 px-1 font-bold">RENDIMIENTOS</h4>
              <p className="text-[10px]">
                Producción Teórica (unidades): {c.rendimientos.produccionTeoricaUnidades ?? ""}
              </p>
              <p className="text-[10px]">Contenido Teórico: {c.rendimientos.contenidoTeorico}</p>
              <table className="mt-2 w-full border-collapse text-[10px]">
                <thead>
                  <tr className="bg-neutral-100">
                    <th className="border p-1 text-left">Fecha</th>
                    <th className="border p-1 text-left">Cant. Unidades</th>
                  </tr>
                </thead>
                <tbody>
                  {(c.rendimientos.cargasParciales ?? []).map((row) => (
                    <tr key={row.id}>
                      <td className="border p-1">{row.fecha}</td>
                      <td className="border p-1">{row.cantidadUnidades ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[10px]">
                Rendimiento A: {c.rendimientos.rendimientoA ?? ""}% · Teórico:{" "}
                {c.rendimientos.rangoTeorico}
              </p>
              {(c.rendimientos.cantidadUnidades != null ||
                c.rendimientos.unidadesDesechadas != null ||
                c.rendimientos.unidadesAceptadas != null) && (
                <p className="text-[10px]">
                  Llenadas: {c.rendimientos.cantidadUnidades ?? ""} · Desechadas:{" "}
                  {c.rendimientos.unidadesDesechadas ?? ""} · Aceptadas:{" "}
                  {c.rendimientos.unidadesAceptadas ?? ""}
                </p>
              )}
            </div>
            <div className="border border-neutral-600 p-2">
              <h4 className="mb-1 bg-neutral-200 px-1 font-bold">OBSERVACIONES</h4>
              <p className="whitespace-pre-wrap text-[10px]">{c.observaciones}</p>
            </div>
          </div>

          <h4 className="mt-3 bg-neutral-200 px-1 font-bold">
            CONTROLES EN PROCESO — Control de peso/volumen
          </h4>
          <p className="text-[10px]">CONTROL ENVASAMIENTO: {c.controlesPeso.limiteTexto}</p>
          <table className="mt-1 w-full border-collapse text-[10px]">
            <thead>
              <tr className="bg-neutral-100">
                {["FECHA", "INICIO", "FIRMA", "MEDIO", "FIRMA", "FINAL", "FIRMA"].map((h, i) => (
                  <th key={`${h}-${i}`} className="border p-1 text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(c.controlesPeso.filas ?? []).map((f) => (
                <tr key={f.id}>
                  <td className="border p-1">{f.fecha}</td>
                  <td className="border p-1">{f.inicio}</td>
                  <td className="border p-1"> </td>
                  <td className="border p-1">{f.medio}</td>
                  <td className="border p-1"> </td>
                  <td className="border p-1">{f.final}</td>
                  <td className="border p-1"> </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 className="mt-3 bg-neutral-200 px-1 font-bold">
            CONTROLES EN PROCESO — Etiquetado / Codificado
          </h4>
          <p className="text-[10px]">{c.etiquetadoCodificadoLegalText}</p>
          <div className="mt-1 grid grid-cols-2 gap-1 text-[10px]">
            <div>Lote codificado: {c.etiquetadoCodificado.loteCodificado}</div>
            <div>Vencimiento codificado: {c.etiquetadoCodificado.vencimientoCodificado}</div>
            <div>Fecha del control: {c.etiquetadoCodificado.fechaControl}</div>
            <div>Responsable: {c.etiquetadoCodificado.responsable}</div>
            <div>Observaciones: {c.etiquetadoCodificado.observaciones}</div>
            <div>Resultado: {c.etiquetadoCodificado.resultado}</div>
            <div>Fecha responsable: {c.etiquetadoCodificado.fechaResponsable}</div>
            <div>Notas: {c.etiquetadoCodificado.notas}</div>
          </div>

          <h4 className="mt-3 bg-neutral-200 px-1 font-bold">ANALISIS DE PRODUCTO TERMINADO</h4>
          <div className="flex gap-2 text-[10px]">
            <div className="flex-1 border p-1">
              RESULTADO: {c.analisisProductoTerminado.resultado}
            </div>
            <div className="h-14 w-[30%] border p-1">FIRMA</div>
          </div>

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
