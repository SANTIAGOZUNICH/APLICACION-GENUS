/**
 * Borrar Blob primero; si falla, conservar metadata y propagar error.
 */

export type BlobStorageLike = {
  delete: (key: string) => Promise<void>;
};

export type BlobSafeResult =
  | { ok: true; deletedKeys: string[] }
  | { ok: false; error: string; deletedKeys: string[]; failedKey: string };

export async function deleteBlobsThenMetadata(params: {
  storage: BlobStorageLike;
  keys: string[];
  afterBlobsDeleted: () => Promise<void>;
}): Promise<BlobSafeResult> {
  const deletedKeys: string[] = [];
  for (const key of params.keys) {
    if (!key?.trim()) continue;
    try {
      await params.storage.delete(key);
      deletedKeys.push(key);
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Error al borrar archivo en Blob. Se conservó la metadata.",
        deletedKeys,
        failedKey: key,
      };
    }
  }
  await params.afterBlobsDeleted();
  return { ok: true, deletedKeys };
}
