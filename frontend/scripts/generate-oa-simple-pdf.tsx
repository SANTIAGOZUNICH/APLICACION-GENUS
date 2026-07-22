import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { OperationalOrderPdfDocument } from "../src/lib/orders/pdf-document";
import {
  initOaSimpleFormFromLegal,
  mapOASimpleFormToLegalDocument,
} from "../src/lib/orders/oa-simple-form";
import { buildCremaFacialLaudeOaSampleOrderContent } from "../src/lib/orders/seed-templates";
import type { OaContent, OperationalOrderRecord } from "../src/lib/orders/types";

async function main() {
  const sample = buildCremaFacialLaudeOaSampleOrderContent() as OaContent;
  const simple = initOaSimpleFormFromLegal(sample, { fechaJornada: "2026-07-21" });
  simple.fechaJornada = "2026-07-21";
  simple.todoMismoDia = true;
  simple.operarios = [{ id: "1", nombre: "Operario Demo", sector: "Masivo" }];
  simple.totalUnidadesLlenadas = 1000;
  simple.unidadesDesechadas = 10;
  simple.produccionTeoricaUnidades = 1000;
  simple.contenidoTeorico = "50 g";
  simple.materials[0].recibidos = "1100";
  simple.materials[0].usados = "1000";
  simple.controles[0].inicio = "50";
  simple.controles[0].medio = "50.2";
  simple.controles[0].final = "49.8";
  simple.analisisGranel.estado = "APROBADO";
  const legal = mapOASimpleFormToLegalDocument(simple, sample);
  const order: OperationalOrderRecord = {
    id: "oa-simple-demo",
    orderNumber: "OA-2026-SIMPLE",
    type: "OA",
    templateId: "seed",
    templateVersion: 1,
    templateSnapshot: legal,
    product: legal.header.productName,
    client: legal.header.client,
    code: legal.header.productCode,
    lot: legal.header.lot,
    assignedSector: "ENVASADO_MASIVO",
    status: "COMPLETA",
    formData: legal,
    completionPercentage: 100,
    revision: 1,
    version: 1,
    linkedWorkItemId: null,
    reviewedAt: null,
    reviewedBy: null,
    completedAt: new Date().toISOString(),
    completedBy: "demo",
    createdBy: "demo",
    updatedBy: "demo",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const out =
    process.env.COMPARISON_OUT_DIR || "/opt/cursor/artifacts/oe-oa-pdf-comparison";
  mkdirSync(out, { recursive: true });
  const buf = await renderToBuffer(
    React.createElement(OperationalOrderPdfDocument, { order })
  );
  const path = join(out, "OA-SIMPLE-CARGA-propagada.pdf");
  writeFileSync(path, buf);
  console.log(
    JSON.stringify(
      {
        file: path,
        emision: legal.header.fechaEmision,
        mat: legal.materialsFecha,
        inicio: legal.envasado.fechaInicio,
        term: legal.envasado.fechaTerminacion,
        rend: legal.rendimientos.fecha,
        ctrl: legal.controlesPeso.fecha,
        cod: legal.etiquetadoCodificado.fechaControl,
        resp: legal.materials[0]?.responsable,
        desechados: legal.materials[0]?.desechados,
        carga: legal.rendimientos.cargasParciales[0],
        rendimiento: legal.rendimientos.rendimientoA,
      },
      null,
      2
    )
  );
}

void main();
