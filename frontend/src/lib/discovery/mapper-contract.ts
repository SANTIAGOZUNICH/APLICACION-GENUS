import { normalizeSheetLabel } from "@/lib/mappers/sheet-field-resolver";

/** Mapper contract — expected fields and alias candidates before UI mapping. */
export interface MapperFieldContract {
  field: string;
  required: boolean;
  aliases: string[];
  description: string;
}

export const OE_MAPPER_CONTRACT: MapperFieldContract[] = [
  {
    field: "oeId",
    required: true,
    aliases: [
      "oe_id",
      "oeid",
      "id_oe",
      "nro_oe",
      "numero_oe",
      "orden_elaboracion",
      "orden",
      "oe",
    ],
    description: "Identificador de orden de elaboración",
  },
  {
    field: "producto",
    required: true,
    aliases: [
      "producto",
      "descripcion",
      "descripcion_producto",
      "granel",
      "nombre_producto",
      "nombre",
    ],
    description: "Producto / granel",
  },
  {
    field: "cliente",
    required: true,
    aliases: ["cliente", "cliente_nombre", "marca", "cliente_id", "nombre_cliente"],
    description: "Cliente o marca",
  },
  {
    field: "lote",
    required: false,
    aliases: [
      "lote_id",
      "lote",
      "lote_granel",
      "nro_lote",
      "numero_lote",
      "lote_granel_id",
    ],
    description: "Lote granel asociado",
  },
  {
    field: "estado",
    required: false,
    aliases: ["estado", "estado_oe", "status", "estado_orden"],
    description: "Estado operativo de la OE",
  },
  {
    field: "responsable",
    required: false,
    aliases: ["responsable", "operario", "usuario", "elaborador"],
    description: "Responsable de elaboración",
  },
  {
    field: "batch",
    required: false,
    aliases: ["batch", "tamano_batch", "cantidad", "kg", "tamano_de_batch", "volumen"],
    description: "Tamaño de batch",
  },
  {
    field: "fecha",
    required: false,
    aliases: ["fecha", "fecha_inicio", "fecha_oe", "inicio", "fecha_elaboracion"],
    description: "Fecha de la orden",
  },
];

export const LOTES_MAPPER_CONTRACT: MapperFieldContract[] = [
  {
    field: "lote",
    required: true,
    aliases: [
      "loteid",
      "lote_id",
      "id_lote",
      "codigo",
      "codigo_lote",
      "nrolote",
      "nro_lote",
      "numero_lote",
      "lote",
      "asignacion",
      "asignacion_lote",
      "nro",
      "id",
    ],
    description: "Identificador de lote",
  },
  {
    field: "producto",
    required: true,
    aliases: ["producto", "itemid", "item_id", "sku", "pt", "descripcion", "granel"],
    description: "Producto / SKU / PT",
  },
  {
    field: "cliente",
    required: false,
    aliases: ["cliente", "cliente_nombre", "marca", "nombre_cliente"],
    description: "Cliente",
  },
  {
    field: "fecha",
    required: false,
    aliases: ["fecha", "fecha_vencimiento", "fechavencimiento", "vencimiento"],
    description: "Fecha o vencimiento",
  },
  {
    field: "granel",
    required: false,
    aliases: ["granel", "lote_granel", "codigo_granel"],
    description: "Código granel",
  },
  {
    field: "estado",
    required: false,
    aliases: ["estado", "status", "estado_lote", "disposicion"],
    description: "Estado del lote",
  },
  {
    field: "ubicacion",
    required: false,
    aliases: ["ubicacion", "ubicación", "deposito", "depósito", "sector", "posicion"],
    description: "Ubicación física",
  },
  {
    field: "observaciones",
    required: false,
    aliases: ["observaciones", "obs", "notas", "comentarios", "observacion"],
    description: "Observaciones",
  },
];

export const PEDIDOS_MAPPER_CONTRACT: MapperFieldContract[] = [
  {
    field: "pedido",
    required: true,
    aliases: [
      "pedidoid",
      "pedido_id",
      "pedido",
      "id_pedido",
      "nro_pedido",
      "numero_pedido",
      "nro",
      "numero",
      "id",
      "pedido_nro",
      "n_pedido",
      "orden",
      "oc",
      "orden_compra",
    ],
    description: "Identificador de pedido",
  },
  {
    field: "cliente",
    required: true,
    aliases: ["cliente", "cliente_id", "cliente_nombre", "nombre_cliente", "razon_social", "marca"],
    description: "Cliente",
  },
  {
    field: "producto",
    required: true,
    aliases: ["producto", "producto_id", "sku", "pt", "descripcion", "articulo"],
    description: "Producto / SKU",
  },
  {
    field: "estado",
    required: false,
    aliases: ["estado", "estado_pedido", "status", "situacion"],
    description: "Estado del pedido",
  },
  {
    field: "cantidad",
    required: false,
    aliases: ["cantidad", "cantidad_pedida", "qty", "total", "unidades"],
    description: "Cantidad pedida",
  },
  {
    field: "fecha",
    required: false,
    aliases: ["fecha", "fecha_pedido", "fecha_compromiso", "fechapedido", "compromiso", "entrega"],
    description: "Fecha o compromiso",
  },
  {
    field: "prioridad",
    required: false,
    aliases: ["prioridad", "urgencia", "prioridad_pedido"],
    description: "Prioridad",
  },
  {
    field: "sector",
    required: false,
    aliases: ["sector", "area", "departamento", "zona"],
    description: "Sector responsable",
  },
  {
    field: "observaciones",
    required: false,
    aliases: ["observaciones", "obs", "notas", "comentarios"],
    description: "Observaciones",
  },
];

function aliasSet(aliases: string[]): Set<string> {
  return new Set(aliases.map(normalizeSheetLabel));
}

export function matchContractFields(
  contract: MapperFieldContract[],
  keys: string[],
  valuesByKey?: Record<string, string>
): { detected: import("@/types/discovery/discovery.types").DiscoveryFieldMatch[]; missing: string[] } {
  const normalizedKeys = keys.map((k) => normalizeSheetLabel(k));
  const valueMap = valuesByKey ?? {};

  const detected = contract.map((fieldDef) => {
    const aliases = aliasSet(fieldDef.aliases);
    let matchedVia: string | undefined;
    let valueSample: string | undefined;

    for (const key of normalizedKeys) {
      if (aliases.has(key)) {
        matchedVia = key;
        valueSample = valueMap[key]?.slice(0, 80);
        break;
      }
    }

    if (!matchedVia) {
      for (const alias of fieldDef.aliases) {
        const normalized = normalizeSheetLabel(alias);
        if (valueMap[normalized]) {
          matchedVia = normalized;
          valueSample = valueMap[normalized]?.slice(0, 80);
          break;
        }
      }
    }

    return {
      field: fieldDef.field,
      required: fieldDef.required,
      matched: Boolean(matchedVia),
      matchedVia,
      valueSample,
    };
  });

  const missing = detected
    .filter((item) => !item.matched)
    .map((item) => item.field);

  return { detected, missing };
}
