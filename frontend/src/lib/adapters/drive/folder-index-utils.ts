import "server-only";

import type { FolderIndexEntry } from "@/lib/adapters/drive/types/document.types";
import { normalizeRelativePath } from "@/lib/adapters/drive/drive-folder-config";

export function pathsEqual(a: string, b: string): boolean {
  return normalizeRelativePath(a).toLowerCase() === normalizeRelativePath(b).toLowerCase();
}

export function isPathUnder(parentPath: string, childPath: string): boolean {
  const parent = normalizeRelativePath(parentPath).toLowerCase();
  const child = normalizeRelativePath(childPath).toLowerCase();
  if (!parent) return true;
  return child === parent || child.startsWith(`${parent}/`);
}

export function findFolderByRelativePath(
  index: FolderIndexEntry[],
  relativePath: string
): FolderIndexEntry | null {
  const target = normalizeRelativePath(relativePath).toLowerCase();
  return (
    index.find(
      (entry) => entry.relativePath.toLowerCase() === target
    ) ?? null
  );
}

export function findFoldersUnderPath(
  index: FolderIndexEntry[],
  rootPath: string
): FolderIndexEntry[] {
  return index.filter((entry) => isPathUnder(rootPath, entry.relativePath));
}

export function getMissingExpectedPaths(
  index: FolderIndexEntry[],
  expectedPaths: readonly string[]
): string[] {
  return expectedPaths.filter(
    (path) => !findFolderByRelativePath(index, path)
  );
}

export function getMaxDepthInIndex(index: FolderIndexEntry[]): number {
  if (index.length === 0) return 0;
  return Math.max(...index.map((entry) => entry.depth));
}
