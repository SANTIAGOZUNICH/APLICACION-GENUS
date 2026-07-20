import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { OaContent, OeContent, OperationalOrderRecord } from "@/lib/orders/types";

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
  meta: { fontSize: 7, color: "#444", marginTop: 10 },
  signBox: {
    borderWidth: 1,
    borderColor: "#555",
    minHeight: 36,
    padding: 4,
    marginTop: 4,
  },
  signLabel: { fontSize: 7, marginBottom: 12 },
  muted: { color: "#666", fontSize: 7 },
});

function SignatureBlock({ label }: { label: string }) {
  return (
    <View style={styles.signBox}>
      <Text style={styles.signLabel}>{label}</Text>
      <Text style={styles.muted}> </Text>
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
            <Text>{m.ajuste}</Text>
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

function OaPdfBody({
  order,
  content,
}: {
  order: OperationalOrderRecord;
  content: OaContent;
}) {
  const h = content.header;
  return (
    <>
      <View style={styles.headerRow}>
        <View style={styles.logoBox}>
          <Text style={styles.logoText}>Laboratorio Genus</Text>
        </View>
        <View style={[styles.titleBox, { width: "72%" }]}>
          <Text style={styles.title}>ORDEN DE ACONDICIONAMIENTO</Text>
        </View>
      </View>

      <View style={styles.row}>
        <View style={[styles.cell, { width: "100%" }]}>
          <Text>
            PRODUCTO: {h.productName} CLIENTE: {h.client}
          </Text>
        </View>
      </View>
      <View style={styles.row}>
        <View style={[styles.cell, { width: "25%" }]}>
          <Text>LOTE: {h.lot}</Text>
        </View>
        <View style={[styles.cell, { width: "25%" }]}>
          <Text>ANALISIS: {h.analisis}</Text>
        </View>
        <View style={[styles.cell, { width: "25%" }]}>
          <Text>CODIGO PRODUCTO: {h.productCode}</Text>
        </View>
        <View style={[styles.cell, { width: "25%" }]}>
          <Text>VTO.: {h.vto}</Text>
        </View>
      </View>
      <View style={styles.row}>
        <View style={[styles.cell, { width: "50%" }]}>
          <Text>APROBO: {h.aprobo}</Text>
        </View>
        <View style={[styles.cell, { width: "50%" }]}>
          <Text>FECHA DE EMISION: {h.fechaEmision}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>ANALISIS DE GRANEL</Text>
      <View style={styles.row}>
        <View style={[styles.cell, { width: "70%" }]}>
          <Text>RESULTADO: {content.analisisGranel.resultado}</Text>
        </View>
        <View style={[styles.cell, { width: "30%" }]}>
          <SignatureBlock label="FIRMA" />
        </View>
      </View>

      <Text style={styles.sectionTitle}>
        SUMINISTRO DE MATERIALES DE ACONDICIONAMIENTO · FECHA: {content.materialsFecha}
      </Text>
      <View style={[styles.row, styles.th]} wrap={false}>
        {["Nº", "Codigo", "Nombre del insumo", "Recibidos", "Desechados", "Usados", "Fecha", "Responsable"].map(
          (label) => (
            <View key={label} style={[styles.cell, styles.th, { width: "12.5%" }]}>
              <Text>{label}</Text>
            </View>
          )
        )}
      </View>
      {content.materials.map((m) => (
        <View key={m.id} style={styles.row} wrap={false}>
          <View style={[styles.cell, { width: "12.5%" }]}>
            <Text>{m.nro}</Text>
          </View>
          <View style={[styles.cell, { width: "12.5%" }]}>
            <Text>{m.codigo}</Text>
          </View>
          <View style={[styles.cell, { width: "12.5%" }]}>
            <Text>{m.nombreInsumo}</Text>
          </View>
          <View style={[styles.cell, { width: "12.5%" }]}>
            <Text>{m.recibidos}</Text>
          </View>
          <View style={[styles.cell, { width: "12.5%" }]}>
            <Text>{m.desechados}</Text>
          </View>
          <View style={[styles.cell, { width: "12.5%" }]}>
            <Text>{m.usados}</Text>
          </View>
          <View style={[styles.cell, { width: "12.5%" }]}>
            <Text>{m.fecha}</Text>
          </View>
          <View style={[styles.cell, { width: "12.5%" }]}>
            <Text>{m.responsable}</Text>
          </View>
        </View>
      ))}

      <Text style={styles.sectionTitle}>ENVASADO</Text>
      <Text>FECHA DE INICIO: {content.envasado.fechaInicio}</Text>
      <Text>FECHA DE TERMINACION: {content.envasado.fechaTerminacion}</Text>
      <Text>OPERARIOS INTERVINENTES: {content.envasado.operarios}</Text>

      <Text style={styles.sectionTitle}>RENDIMIENTOS</Text>
      <Text>
        Producción Teórica (unidades): {content.rendimientos.produccionTeoricaUnidades ?? ""} ·
        Contenido Teórico: {content.rendimientos.contenidoTeorico}
      </Text>
      <Text>
        Fecha: {content.rendimientos.fecha} · Cant. Unidades:{" "}
        {content.rendimientos.cantidadUnidades ?? ""} · Rendimiento A:{" "}
        {content.rendimientos.rendimientoA ?? ""}% · Teórico: {content.rendimientos.rangoTeorico}
      </Text>
      <Text style={{ marginTop: 4 }}>OBSERVACIONES: {content.observaciones}</Text>

      <Text style={styles.sectionTitle}>CONTROLES EN PROCESO — Control de peso/volumen</Text>
      <Text>CONTROL ENVASAMIENTO: {content.controlesPeso.limiteTexto}</Text>
      <Text>
        FECHA {content.controlesPeso.fecha} · INICIO {content.controlesPeso.inicio} · MEDIO{" "}
        {content.controlesPeso.medio} · FINAL {content.controlesPeso.final}
      </Text>
      <View style={styles.row}>
        <View style={{ width: "33%", paddingRight: 2 }}>
          <SignatureBlock label="FIRMA INICIO" />
        </View>
        <View style={{ width: "34%", paddingHorizontal: 2 }}>
          <SignatureBlock label="FIRMA MEDIO" />
        </View>
        <View style={{ width: "33%", paddingLeft: 2 }}>
          <SignatureBlock label="FIRMA FINAL" />
        </View>
      </View>

      <Text style={styles.sectionTitle}>CONTROLES EN PROCESO — Etiquetado / Codificado</Text>
      <Text>{content.etiquetadoCodificadoLegalText}</Text>
      <Text>
        Notas: {content.etiquetadoCodificado.notas} · Fecha responsable:{" "}
        {content.etiquetadoCodificado.fechaResponsable}
      </Text>

      <Text style={styles.sectionTitle}>ANALISIS DE PRODUCTO TERMINADO</Text>
      <View style={styles.row}>
        <View style={[styles.cell, { width: "70%" }]}>
          <Text>RESULTADO: {content.analisisProductoTerminado.resultado}</Text>
        </View>
        <View style={[styles.cell, { width: "30%" }]}>
          <SignatureBlock label="FIRMA" />
        </View>
      </View>

      <View style={[styles.row, { marginTop: 10 }]}>
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

      <Text style={styles.meta}>
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
