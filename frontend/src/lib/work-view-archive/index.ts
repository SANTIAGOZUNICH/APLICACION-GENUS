/** Barrel client-safe: no reexportar el servicio (db/server-only). */
export {
  excludeArchivedFromView,
  onlyArchivedFromView,
  toArchivedIdSet,
} from "./filter";
export {
  archiveFromViewApi,
  fetchWorkViewArchivesApi,
  restoreToViewApi,
} from "./work-view-archive-client";
export {
  isWorkViewArchiveSector,
  VIEW_ARCHIVE_TOOLTIP,
  WORK_VIEW_ARCHIVE_SECTORS,
  type WorkViewArchiveActor,
  type WorkViewArchiveRecord,
  type WorkViewArchiveSector,
} from "./types";
