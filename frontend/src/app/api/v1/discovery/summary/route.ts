import { discoveryErrorResponse, canRunDiscovery, discoveryNotAvailableResponse } from "@/lib/discovery/discovery-route-helpers";
import { discoveryService } from "@/lib/discovery/discovery-service";

export async function GET() {
  if (!canRunDiscovery()) {
    return discoveryNotAvailableResponse({
      oes: { count: 0, status: "not_connected", warnings: [] },
      lotes: { status: "not_connected", rowsRead: 0, rowsMappable: 0, warnings: [] },
      pedidos: { status: "not_connected", rowsRead: 0, rowsMappable: 0, warnings: [] },
      schemaWarnings: [],
      readyForUiMapping: false,
      blockers: ["Drive no configurado"],
    });
  }

  try {
    const summary = await discoveryService.getDiscoverySummary();
    return Response.json(summary);
  } catch (error) {
    return discoveryErrorResponse(error, "DISCOVERY_SUMMARY_FAILED");
  }
}
