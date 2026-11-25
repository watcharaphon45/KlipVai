import Dexie, { type EntityTable } from "dexie";

export interface StoredMediaRecord {
  assetId: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: number;
}

class KlipVaiLocalDb extends Dexie {
  mediaFiles!: EntityTable<StoredMediaRecord, "assetId">;

  constructor() {
    super("KlipVaiLocalDb");
    this.version(1).stores({
      mediaFiles: "assetId, createdAt",
    });
  }
}

let dbInstance: KlipVaiLocalDb | null = null;

/**
 * Returns the lazy singleton Dexie instance for browser IndexedDB access.
 */
export function getLocalDb(): KlipVaiLocalDb {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is only available in a browser environment.");
  }
  if (!dbInstance) {
    dbInstance = new KlipVaiLocalDb();
  }
  return dbInstance;
}

/**
 * Stores or updates a media binary Blob in IndexedDB keyed by assetId.
 */
export async function saveMediaToLocal(
  assetId: string,
  file: Blob,
  metadata?: { fileName?: string; mimeType?: string }
): Promise<void> {
  const db = getLocalDb();
  const fileName =
    metadata?.fileName ?? (file instanceof File ? file.name : assetId);
  const mimeType = metadata?.mimeType ?? file.type;

  await db.mediaFiles.put({
    assetId,
    blob: file,
    fileName,
    mimeType,
    fileSize: file.size,
    createdAt: Date.now(),
  });
}

/**
 * Loads a media Blob from IndexedDB by assetId, or returns null if missing.
 */
export async function loadMediaFromLocal(assetId: string): Promise<Blob | null> {
  const db = getLocalDb();
  const record = await db.mediaFiles.get(assetId);
  return record?.blob ?? null;
}

/**
 * Deletes a media Blob from IndexedDB by assetId.
 */
export async function deleteMediaFromLocal(assetId: string): Promise<void> {
  const db = getLocalDb();
  await db.mediaFiles.delete(assetId);
}

/**
 * Checks whether a media Blob exists in IndexedDB for the given assetId.
 */
export async function hasMediaInLocal(assetId: string): Promise<boolean> {
  const db = getLocalDb();
  const record = await db.mediaFiles.get(assetId);
  return record !== undefined;
}

/**
 * Bulk loads multiple media Blobs from IndexedDB, returning a Map of found assets.
 */
export async function loadMultipleMediaFromLocal(
  assetIds: string[]
): Promise<Map<string, Blob>> {
  const result = new Map<string, Blob>();
  if (assetIds.length === 0) {
    return result;
  }

  const db = getLocalDb();
  const records = await db.mediaFiles.bulkGet(assetIds);
  for (const record of records) {
    if (record) {
      result.set(record.assetId, record.blob);
    }
  }
  return result;
}

/**
 * Removes all locally cached media Blobs from IndexedDB.
 */
export async function clearAllLocalMedia(): Promise<void> {
  const db = getLocalDb();
  await db.mediaFiles.clear();
}
