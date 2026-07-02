import { discoveryErrorResponse, canRunDiscovery, discoveryNotAvailableResponse } from "@/lib/discovery/discovery-route-helpers";
import { discoveryService } from "@/lib/discovery/discovery-service";
import { PEDIDOS_MAPPER_CONTRACT, matchContractFields } from "@/lib/discovery/mapper-contract";

export async function GET() {
  if (!canRunDiscovery()) {
    return discoveryNotAvailableResponse({
      connected: false,
      connectionStatus: "not_connected",
      workbookSheets: [],
      detectedHeaderRows: [],
      headers: [],
      sampleRows: [],
      fieldsDetected: matchContractFields(PEDIDOS_MAPPER_CONTRACT, [], {}).detected,
      fieldsMissing: PEDIDOS_MAPPER_CONTRACT.map((f) => f.field),
      rowsRead: 0,
      rowsMappable: 0,
    });
  }

  try {
    const result = await discoveryService.getPedidosSchema();
    return Response.json(result);
  } catch (error) {
    return discoveryErrorResponse(error, "DISCOVERY_PEDIDOS_SCHEMA_FAILED");
  }
}
