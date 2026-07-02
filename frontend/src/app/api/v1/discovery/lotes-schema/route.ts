import { discoveryErrorResponse, canRunDiscovery, discoveryNotAvailableResponse } from "@/lib/discovery/discovery-route-helpers";
import { discoveryService } from "@/lib/discovery/discovery-service";
import { LOTES_MAPPER_CONTRACT, matchContractFields } from "@/lib/discovery/mapper-contract";

export async function GET() {
  if (!canRunDiscovery()) {
    return discoveryNotAvailableResponse({
      connected: false,
      connectionStatus: "not_connected",
      tabs: [],
      detectedHeaderRows: [],
      headers: [],
      sampleRows: [],
      fieldsDetected: matchContractFields(LOTES_MAPPER_CONTRACT, [], {}).detected,
      fieldsMissing: LOTES_MAPPER_CONTRACT.map((f) => f.field),
      rowsRead: 0,
      rowsMappable: 0,
    });
  }

  try {
    const result = await discoveryService.getLotesSchema();
    return Response.json(result);
  } catch (error) {
    return discoveryErrorResponse(error, "DISCOVERY_LOTES_SCHEMA_FAILED");
  }
}
