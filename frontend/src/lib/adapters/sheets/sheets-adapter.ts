import "server-only";

/**
 * @deprecated E7 legacy adapter — use DriveAdapter via adapter-factory.
 * Kept for backward compatibility during transition.
 */
export { driveAdapter as sheetsAdapter } from "@/lib/adapters/drive/drive-adapter";
