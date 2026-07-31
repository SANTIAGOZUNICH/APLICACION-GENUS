import React from "react";
import { Document, Image, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import {
  MP_LABEL_HEIGHT_PT,
  MP_LABEL_MARGIN_X_PT,
  MP_LABEL_WIDTH_PT,
  mmToPt,
  type MpAprobadoLabelData,
} from "@/lib/inventory/mp-aprobado-label";
import { LABORATORIO_GENUS_LOGO_THERMAL_DATA_URI } from "@/lib/inventory/laboratorio-genus-logo-thermal-data-uri";

/**
 * PDF de una página — etiqueta APROBADO MATERIA PRIMA (75×50 mm).
 * Escala proporcional del diseño 100×67; márgenes L/R = 2 mm (ancho seguro 71 mm).
 */
const S = 0.75; // 75/100
const BORDER = 1.6 * S;
const INNER = 0.7 * S;
const MARGIN_Y_PT = mmToPt(1.6);

const styles = StyleSheet.create({
  page: {
    width: MP_LABEL_WIDTH_PT,
    height: MP_LABEL_HEIGHT_PT,
    padding: 0,
    margin: 0,
    backgroundColor: "#ffffff",
    fontFamily: "Helvetica",
    color: "#000000",
  },
  frame: {
    flex: 1,
    marginLeft: MP_LABEL_MARGIN_X_PT,
    marginRight: MP_LABEL_MARGIN_X_PT,
    marginTop: MARGIN_Y_PT,
    marginBottom: 0,
    borderWidth: BORDER,
    borderColor: "#000000",
    flexDirection: "column",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 5 * S,
    paddingTop: 3 * S,
    paddingBottom: 2 * S,
    minHeight: 28 * S,
  },
  logo: {
    width: 78 * S,
    height: 28 * S,
    objectFit: "contain",
  },
  aprobado: {
    flex: 1,
    textAlign: "right",
    fontSize: 18 * S,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.6 * S,
    paddingLeft: 4 * S,
  },
  materiaBar: {
    backgroundColor: "#000000",
    paddingVertical: 3.5 * S,
    alignItems: "center",
    justifyContent: "center",
  },
  materiaText: {
    color: "#ffffff",
    fontSize: 10 * S,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.2 * S,
  },
  grid: {
    flex: 1,
    borderTopWidth: INNER,
    borderTopColor: "#000000",
  },
  row: {
    flexDirection: "row",
    flexGrow: 1,
    borderBottomWidth: INNER,
    borderBottomColor: "#000000",
  },
  rowLast: {
    flexDirection: "row",
    flexGrow: 1,
    borderBottomWidth: 0,
  },
  cell: {
    flexGrow: 1,
    flexBasis: 0,
    paddingTop: 2 * S,
    paddingHorizontal: 3 * S,
    paddingBottom: 2 * S,
    justifyContent: "flex-start",
  },
  cellBorderRight: {
    borderRightWidth: INNER,
    borderRightColor: "#000000",
  },
  fieldLabel: {
    fontSize: 5.5 * S,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.2 * S,
  },
  fieldValue: {
    flexGrow: 1,
    fontSize: 11 * S,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    textTransform: "uppercase",
    marginTop: 2 * S,
  },
  fieldValueSm: {
    flexGrow: 1,
    fontSize: 9.5 * S,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    textTransform: "uppercase",
    marginTop: 2 * S,
  },
  footerOutside: {
    marginTop: 2 * S,
    marginBottom: MARGIN_Y_PT * 0.5,
    marginLeft: MP_LABEL_MARGIN_X_PT,
    marginRight: MP_LABEL_MARGIN_X_PT,
    textAlign: "center",
    fontSize: 5.5 * S,
    fontFamily: "Helvetica",
    letterSpacing: 0.4 * S,
  },
});

function Cell({
  label,
  value,
  borderRight,
  compact,
  flex,
}: {
  label: string;
  value: string;
  borderRight?: boolean;
  compact?: boolean;
  flex?: number;
}) {
  return (
    <View
      style={[
        styles.cell,
        borderRight ? styles.cellBorderRight : {},
        flex != null ? { flex } : {},
      ]}
    >
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={compact ? styles.fieldValueSm : styles.fieldValue}>
        {value || " "}
      </Text>
    </View>
  );
}

type Props = {
  data: MpAprobadoLabelData;
  /** Override logo data URI (tests). */
  logoSrc?: string;
};

export function MpAprobadoLabelDocument({ data, logoSrc }: Props) {
  // PNG térmico preprocesado — sin filtros CSS ni transformaciones de color.
  const logo = logoSrc ?? LABORATORIO_GENUS_LOGO_THERMAL_DATA_URI;

  return (
    <Document
      title={`APROBADO MATERIA PRIMA — ${data.producto || data.sourceId}`}
      author="Laboratorio Genus"
      subject="Etiqueta HereLabel"
      creator="Genus OS"
    >
      <Page
        size={{ width: MP_LABEL_WIDTH_PT, height: MP_LABEL_HEIGHT_PT }}
        style={styles.page}
      >
        <View style={styles.frame}>
          <View style={styles.header}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image */}
            <Image src={logo} style={styles.logo} />
            <Text style={styles.aprobado}>APROBADO</Text>
          </View>

          <View style={styles.materiaBar}>
            <Text style={styles.materiaText}>MATERIA PRIMA</Text>
          </View>

          <View style={styles.grid}>
            <View style={styles.row}>
              <Cell label="PRODUCTO:" value={data.producto} borderRight flex={1.85} />
              <Cell label="PCC-ME Nº:" value={data.pccMeNro} compact flex={1} />
            </View>

            <View style={styles.row}>
              <Cell label="INGRESO:" value={data.ingreso} borderRight />
              <Cell label="Nº DE REMITO:" value={data.remitoNro} borderRight compact />
              <Cell label="CANTIDAD:" value={data.cantidad} />
            </View>

            <View style={styles.row}>
              <Cell label="PROVEEDOR:" value={data.proveedor} />
            </View>

            <View style={styles.rowLast}>
              <Cell label="Nº DE BULTOS:" value={data.bultos} borderRight />
              <Cell
                label="Nº DE LOTE PROVEEDOR:"
                value={data.loteProveedor}
                compact
              />
            </View>
          </View>
        </View>

        <Text style={styles.footerOutside}>FORM. APROBADO MATERIA PRIMA</Text>
      </Page>
    </Document>
  );
}
