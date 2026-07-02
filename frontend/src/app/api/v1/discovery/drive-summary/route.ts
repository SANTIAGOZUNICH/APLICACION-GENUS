import { discoveryErrorResponse, canRunDiscovery, discoveryNotAvailableResponse } from "@/lib/discovery/discovery-route-helpers";
import { discoveryService } from "@/lib/discovery/discovery-service";

export async function GET() {
  if (!canRunDiscovery()) {
    return discoveryNotAvailableResponse({
      foldersScanned: 0,
      folderIndexCount: 0,
      documentsByAlias: {},
      formatsDetected: {},
      googleSheetsCount: 0,
      excelCount: 0,
      criticalSheets: [],
      oeIndexCount: 0,
    });
  }

  try {
    const summary = await discoveryService.getDriveSummary();
    return Response.json(summary);
  } catch (error) {
    return discoveryErrorResponse(error, "DISCOVERY_DRIVE_SUMMARY_FAILED");
  }
}
