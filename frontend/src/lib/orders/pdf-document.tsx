import React from "react";
import {
  Document,
  Image,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { OaContent, OeContent, OperationalOrderRecord } from "@/lib/orders/types";
import { sanitizeLegalPrintValue } from "@/lib/orders/oa-simple-form";

const LOGO_CANDIDATES = [
  join(process.cwd(), "public", "brand", "laboratorio-genus-logo.jpg"),
  join(process.cwd(), "frontend", "public", "brand", "laboratorio-genus-logo.jpg"),
];
const LOGO_PATH = LOGO_CANDIDATES.find((p) => existsSync(p)) ?? null;

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 28,
    paddingHorizontal: 28,
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#111",
  },
  headerRow: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#333",
    marginBottom: 6,
  },
  logoBox: {
    width: "28%",
    padding: 8,
    borderRightWidth: 1,
    borderRightColor: "#333",
    justifyContent: "center",
  },
  logoText: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  logoImage: {
    width: 78,
    height: 32,
    objectFit: "contain",
  },
  titleBox: {
    width: "36%",
    padding: 8,
    borderRightWidth: 1,
    borderRightColor: "#333",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e8e8e8",
  },
  title: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
  },
  titleOa: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
  },
  typeBox: {
    width: "36%",
    padding: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    marginTop: 8,
    marginBottom: 3,
    padding: 3,
    backgroundColor: "#d9d9d9",
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
  },
  row: { flexDirection: "row" },
  cell: {
    borderWidth: 0.5,
    borderColor: "#555",
    padding: 3,
  },
  th: {
    backgroundColor: "#efefef",
    fontFamily: "Helvetica-Bold",
  },
  label: { fontSize: 7, color: "#333", marginBottom: 1 },
  value: { fontFamily: "Helvetica-Bold", fontSize: 8 },
  meta: { fontSize: 6.5, color: "#444", marginTop: 6 },
  metaFixed: {
    fontSize: 6.5,
    color: "#444",
    position: "absolute",
    bottom: 14,
    left: 28,
    right: 28,
  },
  signBox: {
    borderWidth: 1,
    borderColor: "#555",
    minHeight: 30,
    padding: 3,
    marginTop: 3,
  },
  signLabel: { fontSize: 7, marginBottom: 10 },
  muted: { color: "#666", fontSize: 7 },
  sideBySide: {
    flexDirection: "row",
    marginTop: 4,
  },
  sidePanel: {
    borderWidth: 0.5,
    borderColor: "#555",
    padding: 4,
  },
});

function GenusLogo() {
  if (LOGO_PATH) {
    // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image has no DOM alt attribute
    return <Image src={LOGO_PATH} style={styles.logoImage} />;
  }
  return <Text style={styles.logoText}>LABORATORIO GENUS</Text>;
}

function SignatureBlock({ label }: { label: string }) {
  return (
    <View style={styles.signBox}>
      <Text style={styles.signLabel}>{label}</Text>
      <Text style={styles.muted}> </Text>
    </View>
  );
}

function FieldCell({
  label,
  value,
  width,
}: {
  label: string;
  value: string | number | null | undefined;
  width: string | number;
}) {
  return (
    <View style={[styles.cell, { width }]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{sanitizeLegalPrintValue(value)}</Text>
    </View>
  );
}

function OePdfBody({
  order,
  content,
}: {
  order: OperationalOrderRecord;
  content: OeContent;
}) {
  const h = content.header;
  return (
    <>
      <View style={styles.headerRow}>
        <View style={styles.logoBox}>
          <Text style={styles.logoText}>Laboratorio Genus</Text>
        </View>
        <View style={styles.titleBox}>
          <Text style={styles.title}>OE</Text>
        </View>
        <View style={styles.typeBox}>
          <Text>PT</Text>
        </View>
      </View>

      <View style={styles.row}>
        <View style={[styles.cell, { width: "34%" }]}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>{h.productName}</Text>
        </View>
        <View style={[styles.cell, { width: "12%" }]}>
          <Text>Código</Text>
          <Text>{h.code}</Text>
        </View>
        <View style={[styles.cell, { width: "14%" }]}>
          <Text>Fecha</Text>
          <Text>{h.date}</Text>
        </View>
        <View style={[styles.cell, { width: "12%" }]}>
          <Text>Cant. Kg</Text>
          <Text>{h.quantityKg ?? ""}</Text>
        </View>
        <View style={[styles.cell, { width: "14%" }]}>
          <Text>N° de Lote</Text>
          <Text>{h.lot}</Text>
        </View>
        <View style={[styles.cell, { width: "14%" }]}>
          <Text>VIGENCIA</Text>
          <Text>{h.vigencia}</Text>
        </View>
      </View>
      <View style={styles.row}>
        <View style={[styles.cell, { width: "50%" }]}>
          <Text>Cliente: {h.client}</Text>
        </View>
        <View style={[styles.cell, { width: "50%" }]}>
          <Text>Equipo calefactor N°: {h.equipoCalefactor}</Text>
        </View>
      </View>
      <View style={styles.row}>
        <View style={[styles.cell, { width: "100%" }]}>
          <Text>Envase cubica: {h.envaseCubica}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>MATERIAS PRIMAS</Text>
      <View style={[styles.row, styles.th]} wrap={false}>
        {["Materia prima", "Código", "Fórmula %", "kg a pesar", "AJUSTE", "LOTE Nº"].map(
          (label, i) => (
            <View
              key={label}
              style={[
                styles.cell,
                styles.th,
                { width: i === 0 ? "28%" : i === 1 ? "14%" : "14.5%" },
              ]}
            >
              <Text>{label}</Text>
            </View>
          )
        )}
      </View>
      {content.materials.map((m) => (
        <View key={m.id} style={styles.row} wrap={false}>
          <View style={[styles.cell, { width: "28%" }]}>
            <Text>{m.materiaPrima}</Text>
          </View>
          <View style={[styles.cell, { width: "14%" }]}>
            <Text>{m.codigo}</Text>
          </View>
          <View style={[styles.cell, { width: "14.5%" }]}>
            <Text>{m.formulaPct ?? ""}</Text>
          </View>
          <View style={[styles.cell, { width: "14.5%" }]}>
            <Text>{m.kgAPesar ?? ""}</Text>
          </View>
          <View style={[styles.cell, { width: "14.5%" }]}>
            <Text>{m.ajuste ?? ""}</Text>
          </View>
          <View style={[styles.cell, { width: "14.5%" }]}>
            <Text>{m.lote}</Text>
          </View>
        </View>
      ))}
      <View style={styles.row} wrap={false}>
        <View style={[styles.cell, { width: "42%" }]}>
          <Text>Total expresado en kg</Text>
        </View>
        <View style={[styles.cell, { width: "14.5%" }]}>
          <Text>{content.totals.formulaPctSum ?? ""}</Text>
        </View>
        <View style={[styles.cell, { width: "14.5%" }]}>
          <Text>{content.totals.kgSum ?? ""}</Text>
        </View>
        <View style={[styles.cell, { width: "29%" }]}>
          <Text>Firma:</Text>
        </View>
      </View>

      <View style={[styles.row, { marginTop: 6 }]}>
        <View style={[styles.cell, { width: "50%" }]}>
          <Text>LIMPIEZA Equipo utilizado</Text>
          <SignatureBlock label="Firma" />
        </View>
        <View style={[styles.cell, { width: "50%" }]}>
          <Text>Retira muestras p/C.C.</Text>
          <SignatureBlock label="Firma" />
        </View>
      </View>

      <Text style={styles.sectionTitle}>PROCEDIMIENTO DE ELABORACIÓN</Text>
      {content.procedureSteps.map((s) => (
        <Text key={s.id} style={{ marginBottom: 2 }}>
          {s.text}
        </Text>
      ))}

      <Text style={styles.sectionTitle}>Control de proceso</Text>
      <Text>Fecha: {content.processControl.date}</Text>
      <View style={[styles.row, styles.th, { marginTop: 3 }]}>
        <View style={[styles.cell, styles.th, { width: "34%" }]}>
          <Text>Ensayo</Text>
        </View>
        <View style={[styles.cell, styles.th, { width: "33%" }]}>
          <Text>Especifica</Text>
        </View>
        <View style={[styles.cell, styles.th, { width: "33%" }]}>
          <Text>Resultados</Text>
        </View>
      </View>
      {[
        ["Aspecto:", content.processControl.aspectoSpec, content.processControl.aspecto],
        ["Color:", content.processControl.colorSpec, content.processControl.color],
        ["Olor:", content.processControl.olorSpec, content.processControl.olor],
        ["pH:", content.processControl.phSpec, content.processControl.ph],
        [
          content.processControl.viscosidadSpec,
          "",
          content.processControl.viscosidad,
        ],
      ].map(([a, b, c]) => (
        <View key={String(a)} style={styles.row} wrap={false}>
          <View style={[styles.cell, { width: "34%" }]}>
            <Text>{a}</Text>
          </View>
          <View style={[styles.cell, { width: "33%" }]}>
            <Text>{b}</Text>
          </View>
          <View style={[styles.cell, { width: "33%" }]}>
            <Text>{c}</Text>
          </View>
        </View>
      ))}
      <Text>
        Cant real: {content.processControl.cantidadReal ?? ""} · Merma %:{" "}
        {content.processControl.mermaPct ?? ""} · Cant obt.:{" "}
        {content.processControl.cantidadObtenida ?? ""} · Fecha:{" "}
        {content.processControl.fechaFin}
      </Text>

      <Text style={styles.sectionTitle}>Control de calidad</Text>
      <View style={styles.row}>
        <View style={[styles.cell, { width: "40%" }]}>
          <Text>Ensayo: {content.qualityControl.ensayo}</Text>
        </View>
        <View style={[styles.cell, { width: "30%" }]}>
          <Text>Resultado: {content.qualityControl.resultado}</Text>
        </View>
        <View style={[styles.cell, { width: "15%" }]}>
          <Text>Firma</Text>
        </View>
        <View style={[styles.cell, { width: "15%" }]}>
          <Text>Fecha: {content.qualityControl.fecha}</Text>
        </View>
      </View>

      <View style={[styles.row, { marginTop: 10 }]}>
        <View style={{ width: "33%", paddingRight: 4 }}>
          <SignatureBlock label="Firma Producción" />
        </View>
        <View style={{ width: "34%", paddingHorizontal: 2 }}>
          <SignatureBlock label="Firma Control de Calidad" />
        </View>
        <View style={{ width: "33%", paddingLeft: 4 }}>
          <SignatureBlock label="Firma Dirección Técnica" />
        </View>
      </View>

      <Text style={styles.meta}>
        {order.orderNumber} · plantilla v{order.templateVersion} · rev {order.revision} ·
        generado {new Date().toISOString()} · id {order.id}
      </Text>
    </>
  );
}

function oaOperariosText(content: OaContent): string {
  const fromList = (content.envasado.operariosList ?? [])
    .map((o) => o.nombre.trim())
    .filter(Boolean);
  if (fromList.length > 0) return fromList.join(", ");
  return content.envasado.operarios?.trim() ?? "";
}

function OaPdfBody({
  order,
  content,
}: {
  order: OperationalOrderRecord;
  content: OaContent;
}) {
  const h = content.header;
  const cargas = content.rendimientos.cargasParciales ?? [];
  const pesoFilas = content.controlesPeso.filas ?? [];
  const etiq = content.etiquetadoCodificado;
  const matCols: { key: string; width: string }[] = [
    { key: "Nº", width: "6%" },
    { key: "Codigo", width: "12%" },
    { key: "Nombre", width: "22%" },
    { key: "Recibidos", width: "12%" },
    { key: "Desechados", width: "12%" },
    { key: "Usados", width: "12%" },
    { key: "Fecha", width: "12%" },
    { key: "Responsable", width: "12%" },
  ];

  return (
    <>
      <View style={styles.headerRow}>
        <View style={styles.logoBox}>
          <GenusLogo />
        </View>
        <View style={[styles.titleBox, { width: "72%", borderRightWidth: 0 }]}>
          <Text style={styles.titleOa}>ORDEN DE ACONDICIONAMIENTO</Text>
        </View>
      </View>

      <View style={styles.row}>
        <FieldCell label="PRODUCTO" value={h.productName} width="55%" />
        <FieldCell label="CLIENTE" value={h.client} width="45%" />
      </View>
      <View style={styles.row}>
        <FieldCell label="LOTE" value={h.lot} width="25%" />
        <FieldCell label="ANALISIS" value={h.analisis} width="25%" />
        <FieldCell label="CODIGO PRODUCTO" value={h.productCode} width="25%" />
        <FieldCell label="VTO" value={h.vto} width="25%" />
      </View>
      <View style={styles.row}>
        <FieldCell label="APROBO" value={h.aprobo} width="50%" />
        <FieldCell label="FECHA DE EMISION" value={h.fechaEmision} width="50%" />
      </View>

      <Text style={styles.sectionTitle}>ANALISIS DE GRANEL</Text>
      <View style={styles.row}>
        <View style={[styles.cell, { width: "70%" }]}>
          <Text style={styles.label}>RESULTADO</Text>
          <Text style={styles.value}>{content.analisisGranel.resultado}</Text>
        </View>
        <View style={[styles.cell, { width: "30%" }]}>
          <SignatureBlock label="FIRMA" />
        </View>
      </View>

      <Text style={styles.sectionTitle}>
        SUMINISTRO DE MATERIALES DE ACONDICIONAMIENTO
      </Text>
      <Text style={{ marginBottom: 2 }}>FECHA: {content.materialsFecha}</Text>
      <View style={[styles.row, styles.th]} wrap={false}>
        {matCols.map((col) => (
          <View key={col.key} style={[styles.cell, styles.th, { width: col.width }]}>
            <Text>{col.key}</Text>
          </View>
        ))}
      </View>
      {content.materials.map((m) => (
        <View key={m.id} style={styles.row} wrap={false}>
          <View style={[styles.cell, { width: "6%" }]}>
            <Text>{m.nro}</Text>
          </View>
          <View style={[styles.cell, { width: "12%" }]}>
            <Text>{m.codigo}</Text>
          </View>
          <View style={[styles.cell, { width: "22%" }]}>
            <Text>{m.nombreInsumo}</Text>
          </View>
          <View style={[styles.cell, { width: "12%" }]}>
            <Text>{m.recibidos}</Text>
          </View>
          <View style={[styles.cell, { width: "12%" }]}>
            <Text>{m.desechados}</Text>
          </View>
          <View style={[styles.cell, { width: "12%" }]}>
            <Text>{m.usados}</Text>
          </View>
          <View style={[styles.cell, { width: "12%" }]}>
            <Text>{m.fecha}</Text>
          </View>
          <View style={[styles.cell, { width: "12%" }]}>
            <Text>{m.responsable}</Text>
          </View>
        </View>
      ))}

      <Text style={styles.sectionTitle}>ENVASADO</Text>
      <View style={styles.row}>
        <FieldCell
          label="FECHA DE INICIO"
          value={content.envasado.fechaInicio}
          width="35%"
        />
        <FieldCell
          label="FECHA DE TERMINACION"
          value={content.envasado.fechaTerminacion}
          width="35%"
        />
        <View style={[styles.cell, { width: "30%" }]}>
          <Text style={styles.label}>OPERARIOS INTERVINIENTES</Text>
          <Text style={styles.value}>{oaOperariosText(content)}</Text>
        </View>
      </View>

      <View style={styles.sideBySide}>
        <View style={[styles.sidePanel, { width: "58%", marginRight: 4 }]}>
          <Text style={[styles.sectionTitle, { marginTop: 0 }]}>RENDIMIENTOS</Text>
          <Text>
            Producción Teórica (unidades):{" "}
            {content.rendimientos.produccionTeoricaUnidades ?? ""}
          </Text>
          <Text>Contenido Teórico: {content.rendimientos.contenidoTeorico}</Text>
          <View style={[styles.row, styles.th, { marginTop: 4 }]} wrap={false}>
            <View style={[styles.cell, styles.th, { width: "50%" }]}>
              <Text>Fecha</Text>
            </View>
            <View style={[styles.cell, styles.th, { width: "50%" }]}>
              <Text>Cant. Unidades</Text>
            </View>
          </View>
          {cargas.map((c) => (
            <View key={c.id} style={styles.row} wrap={false}>
              <View style={[styles.cell, { width: "50%" }]}>
                <Text>{c.fecha}</Text>
              </View>
              <View style={[styles.cell, { width: "50%" }]}>
                <Text>{c.cantidadUnidades ?? ""}</Text>
              </View>
            </View>
          ))}
          <Text style={{ marginTop: 4 }}>
            TOTAL UNIDADES LLENADAS: {content.rendimientos.cantidadUnidades ?? ""} ·
            DESECHADAS: {content.rendimientos.unidadesDesechadas ?? ""} · ACEPTADAS:{" "}
            {content.rendimientos.unidadesAceptadas ?? ""}
          </Text>
          <Text style={{ marginTop: 2 }}>
            Rendimiento A: {content.rendimientos.rendimientoA ?? ""}% · Teórico:{" "}
            {content.rendimientos.rangoTeorico}
          </Text>
        </View>
        <View style={[styles.sidePanel, { width: "42%" }]}>
          <Text style={[styles.sectionTitle, { marginTop: 0 }]}>OBSERVACIONES</Text>
          <Text>{content.observaciones}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>CONTROLES EN PROCESO — Control de peso/volumen</Text>
      <Text>CONTROL ENVASAMIENTO: {content.controlesPeso.limiteTexto}</Text>
      <View style={[styles.row, styles.th, { marginTop: 3 }]} wrap={false}>
        {["FECHA", "INICIO", "FIRMA", "MEDIO", "FIRMA", "FINAL", "FIRMA"].map((label, i) => (
          <View
            key={`${label}-${i}`}
            style={[styles.cell, styles.th, { width: i === 0 ? "16%" : "14%" }]}
          >
            <Text>{label}</Text>
          </View>
        ))}
      </View>
      {pesoFilas.map((f) => (
        <View key={f.id} style={styles.row} wrap={false}>
          <View style={[styles.cell, { width: "16%" }]}>
            <Text>{f.fecha}</Text>
          </View>
          <View style={[styles.cell, { width: "14%" }]}>
            <Text>{f.inicio}</Text>
          </View>
          <View style={[styles.cell, { width: "14%" }]}>
            <Text> </Text>
          </View>
          <View style={[styles.cell, { width: "14%" }]}>
            <Text>{f.medio}</Text>
          </View>
          <View style={[styles.cell, { width: "14%" }]}>
            <Text> </Text>
          </View>
          <View style={[styles.cell, { width: "14%" }]}>
            <Text>{f.final}</Text>
          </View>
          <View style={[styles.cell, { width: "14%" }]}>
            <Text> </Text>
          </View>
        </View>
      ))}

      <Text style={styles.sectionTitle}>CONTROLES EN PROCESO — Etiquetado / Codificado</Text>
      <Text style={{ marginBottom: 3 }}>{content.etiquetadoCodificadoLegalText}</Text>
      <View style={styles.row}>
        <FieldCell label="Lote codificado" value={etiq.loteCodificado} width="25%" />
        <FieldCell
          label="Vencimiento codificado"
          value={etiq.vencimientoCodificado}
          width="25%"
        />
        <FieldCell label="Fecha del control" value={etiq.fechaControl} width="25%" />
        <FieldCell label="Responsable" value={etiq.responsable} width="25%" />
      </View>
      <View style={styles.row}>
        <FieldCell label="Observaciones" value={etiq.observaciones} width="40%" />
        <FieldCell label="Resultado" value={etiq.resultado} width="20%" />
        <FieldCell label="Fecha responsable" value={etiq.fechaResponsable} width="20%" />
        <FieldCell label="Notas" value={etiq.notas} width="20%" />
      </View>

      <Text style={styles.sectionTitle}>ANALISIS DE PRODUCTO TERMINADO</Text>
      <View style={styles.row}>
        <View style={[styles.cell, { width: "70%" }]}>
          <Text style={styles.label}>RESULTADO</Text>
          <Text style={styles.value}>{content.analisisProductoTerminado.resultado}</Text>
        </View>
        <View style={[styles.cell, { width: "30%" }]}>
          <SignatureBlock label="FIRMA" />
        </View>
      </View>

      <View style={[styles.row, { marginTop: 6 }]} wrap={false}>
        <View style={{ width: "33%", paddingRight: 2 }}>
          <SignatureBlock label="AUTORIZACION PRODUCCION" />
        </View>
        <View style={{ width: "34%", paddingHorizontal: 2 }}>
          <SignatureBlock label="AUTORIZACION CONTROL CALIDAD" />
        </View>
        <View style={{ width: "33%", paddingLeft: 2 }}>
          <SignatureBlock label="AUTORIZACION DIRECCION TECNICA" />
        </View>
      </View>

      <Text style={styles.metaFixed} fixed>
        {order.orderNumber} · plantilla v{order.templateVersion} · rev {order.revision} ·
        generado {new Date().toISOString()} · id {order.id}
      </Text>
    </>
  );
}

export function OperationalOrderPdfDocument({ order }: { order: OperationalOrderRecord }) {
  const content = order.formData;
  return (
    <Document
      title={order.orderNumber}
      author="Laboratorio Genus"
      subject={`${order.type} ${order.product}`}
    >
      <Page size="A4" style={styles.page} wrap>
        {content.kind === "OE" ? (
          <OePdfBody order={order} content={content} />
        ) : (
          <OaPdfBody order={order} content={content} />
        )}
      </Page>
    </Document>
  );
}

/** Verifica que el PDF no contenga firmas digitales rellenadas. */
export function assertBlankSignatures(order: OperationalOrderRecord): void {
  const sigs = order.formData.signatures;
  for (const value of Object.values(sigs)) {
    if (value != null) {
      throw new Error("Las firmas deben permanecer vacías (firma física post-impresión).");
    }
  }
}
