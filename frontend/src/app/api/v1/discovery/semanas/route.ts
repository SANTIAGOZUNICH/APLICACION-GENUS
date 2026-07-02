import { discoveryErrorResponse, canRunDiscovery, discoveryNotAvailableResponse } from "@/lib/discovery/discovery-route-helpers";
import { semanasDiscoveryService } from "@/lib/discovery/semanas-discovery.service";

export async function GET() {
  if (!canRunDiscovery()) {
    return discoveryNotAvailableResponse({
      tabs: [],
      tabDiscoveries: [],
      blocksSummary: {
        ELABORACION: 0,
        ACONDICIONAMIENTO: 0,
        ENTREGAS: 0,
        DESARROLLO: 0,
        OTRO: 0,
      },
      rowsRead: 0,
      rowsMappable: 0,
    });
  }

  try {
    const result = await semanasDiscoveryService.discover();
    return Response.json(result);
  } catch (error) {
    return discoveryErrorResponse(error, "DISCOVERY_SEMANAS_FAILED");
  }
}
