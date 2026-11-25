import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import type {
  PersistedMediaAsset,
  PersistedProjectData,
  TimelineTrack,
} from "@/types/timeline";

const globalForPrisma = globalThis as unknown as {
  prismaClient?: PrismaClient;
};

/**
 * Returns a lazy singleton PrismaClient configured with @prisma/adapter-pg for Neon/PostgreSQL.
 */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prismaClient) {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL environment variable is not configured."
      );
    }
    const adapter = new PrismaPg({ connectionString });
    globalForPrisma.prismaClient = new PrismaClient({ adapter });
  }
  return globalForPrisma.prismaClient;
}

/**
 * Defensively validates and strips runtime-only blobUrl fields before persisting project metadata.
 */
export function sanitizeProjectData(raw: unknown): PersistedProjectData {
  if (!raw || typeof raw !== "object") {
    return { mediaAssets: {}, tracks: [] };
  }

  const record = raw as {
    mediaAssets?: Record<string, unknown>;
    tracks?: unknown;
  };

  const sanitizedAssets: Record<string, PersistedMediaAsset> = {};
  if (record.mediaAssets && typeof record.mediaAssets === "object") {
    for (const [assetId, assetValue] of Object.entries(record.mediaAssets)) {
      if (!assetValue || typeof assetValue !== "object") {
        continue;
      }
      const assetObj = assetValue as Record<string, unknown>;
      const cleanAsset: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(assetObj)) {
        if (key !== "blobUrl") {
          cleanAsset[key] = val;
        }
      }
      sanitizedAssets[assetId] = cleanAsset as unknown as PersistedMediaAsset;
    }
  }

  const tracks = Array.isArray(record.tracks)
    ? (record.tracks as TimelineTrack[])
    : [];

  return {
    mediaAssets: sanitizedAssets,
    tracks,
  };
}
