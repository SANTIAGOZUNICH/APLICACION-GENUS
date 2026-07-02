import { discoveryErrorResponse, canRunDiscovery, discoveryNotAvailableResponse } from "@/lib/discovery/discovery-route-helpers";
import { discoveryService } from "@/lib/discovery/discovery-service";

export async function GET() {
  if (!canRunDiscovery()) {
    return discoveryNotAvailableResponse({
      samplesRequested: 5,
      samples: [],
      oeIndexCount: 0,
    });
  }

  try {
    const result = await discoveryService.getOeSchemas();
    return Response.json(result);
  } catch (error) {
    return discoveryErrorResponse(error, "DISCOVERY_OE_SCHEMAS_FAILED");
  }
}
