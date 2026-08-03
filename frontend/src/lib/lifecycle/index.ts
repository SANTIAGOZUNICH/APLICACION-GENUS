export {
  canAnnul,
  canArchive,
  canDelete,
  canHardDelete,
  canRestore,
  getDeletionImpact,
  matchesVisibilityFilter,
  referencedBy,
  requireReasonFor,
  resolvePrimaryLifecycleAction,
  type DeletionImpact,
  type LifecycleAction,
  type LifecycleActor,
  type LifecycleDecision,
  type LifecycleEntityKind,
  type LifecycleEntityState,
  type LifecycleReference,
  type LifecycleVisibilityFilter,
} from "./policy";
export {
  clearLifecycleAuditForTests,
  listLifecycleAudit,
  recordLifecycleEvent,
  type LifecycleAuditEvent,
} from "./audit";
export {
  normalizeOptionalReason,
  sanitizeOptionalReason,
  SIN_MOTIVO_INFORMADO,
} from "./reason";
export { deleteBlobsThenMetadata, type BlobSafeResult, type BlobStorageLike } from "./blob-safe";
