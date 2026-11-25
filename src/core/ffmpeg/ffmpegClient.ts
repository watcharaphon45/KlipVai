import { loadMultipleMediaFromLocal } from "@/core/storage/localDb";
import {
  findMissingActiveAssets,
  getRequiredAssetIds,
} from "@/core/ffmpeg/commandBuilder";
import type {
  ExportStage,
  ExportWorkerInboundMessage,
  ExportWorkerOutboundMessage,
} from "@/core/ffmpeg/exportTypes";
import type {
  MediaAsset,
  ProjectCanvasConfig,
  TimelineTrack,
} from "@/types/timeline";

export interface ExportVideoOptions {
  tracks: TimelineTrack[];
  mediaAssets: Record<string, MediaAsset>;
  canvas: ProjectCanvasConfig;
  onStatus?: (stage: ExportStage, message: string) => void;
  onProgress?: (progress: number, timeSec: number) => void;
  onLog?: (message: string) => void;
}

export interface ExportJobHandle {
  promise: Promise<{ blob: Blob; durationSec: number }>;
  cancel: () => void;
}

/**
 * Coordinates IndexedDB blob loading and spawns export.worker.ts to render MP4 off the main thread.
 */
export function exportProjectVideo(options: ExportVideoOptions): ExportJobHandle {
  const { tracks, mediaAssets, canvas, onStatus, onProgress, onLog } = options;

  let worker: Worker | null = null;
  let cancelled = false;
  let settled = false;
  let rejectFn: ((reason?: unknown) => void) | null = null;

  const promise = new Promise<{ blob: Blob; durationSec: number }>(
    (resolve, reject) => {
      rejectFn = reject;

      void (async () => {
        try {
          onStatus?.("preparing", "Validating timeline assets...");

          const missing = findMissingActiveAssets(tracks, mediaAssets);
          if (missing.length > 0) {
            throw new Error(
              `Cannot export while ${missing.length} active media file(s) are MISSING: ${missing
                .map((m) => m.name)
                .join(", ")}`
            );
          }

          const requiredIds = getRequiredAssetIds(tracks);
          const blobMap = await loadMultipleMediaFromLocal(requiredIds);

          if (cancelled) {
            throw new Error("Export cancelled by user.");
          }

          const blobs: Record<string, Blob> = {};
          for (const id of requiredIds) {
            const found = blobMap.get(id);
            if (!found) {
              const name = mediaAssets[id]?.name ?? id;
              throw new Error(
                `Media file "${name}" is missing from local IndexedDB.`
              );
            }
            blobs[id] = found;
          }

          worker = new Worker(
            new URL("../../workers/export.worker.ts", import.meta.url),
            { type: "module" }
          );

          worker.onmessage = (
            event: MessageEvent<ExportWorkerOutboundMessage>
          ) => {
            const msg = event.data;
            if (msg.type === "STATUS") {
              onStatus?.(msg.payload.stage, msg.payload.message);
            } else if (msg.type === "PROGRESS") {
              onProgress?.(msg.payload.progress, msg.payload.timeSec);
            } else if (msg.type === "LOG") {
              onLog?.(msg.payload.message);
            } else if (msg.type === "COMPLETE") {
              settled = true;
              worker?.terminate();
              worker = null;
              onStatus?.("complete", "Export complete!");
              resolve({
                blob: msg.payload.outputBlob,
                durationSec: msg.payload.durationSec,
              });
            } else if (msg.type === "ERROR") {
              settled = true;
              worker?.terminate();
              worker = null;
              reject(new Error(msg.payload.message));
            }
          };

          worker.onerror = (err) => {
            if (settled) {
              return;
            }
            settled = true;
            worker?.terminate();
            worker = null;
            reject(
              new Error(err.message || "Export Web Worker encountered an error.")
            );
          };

          const startMessage: ExportWorkerInboundMessage = {
            type: "START_EXPORT",
            payload: {
              tracks,
              mediaAssets,
              blobs,
              canvas,
              origin: window.location.origin,
            },
          };
          worker.postMessage(startMessage);
        } catch (error) {
          if (!settled) {
            settled = true;
            worker?.terminate();
            worker = null;
            reject(error);
          }
        }
      })();
    }
  );

  const cancel = (): void => {
    if (settled) {
      return;
    }
    cancelled = true;
    settled = true;
    if (worker) {
      const cancelMsg: ExportWorkerInboundMessage = { type: "CANCEL_EXPORT" };
      worker.postMessage(cancelMsg);
      worker.terminate();
      worker = null;
    }
    onStatus?.("cancelled", "Export cancelled.");
    rejectFn?.(new Error("Export cancelled by user."));
  };

  return { promise, cancel };
}

/**
 * Triggers a browser file download for an exported Blob and revokes the temporary URL cleanly.
 */
export function triggerVideoDownload(blob: Blob, filename: string): void {
  const safeName = filename.toLowerCase().endsWith(".mp4")
    ? filename
    : `${filename}.mp4`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
