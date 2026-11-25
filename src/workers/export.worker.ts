import {
  buildFFmpegCommand,
  buildMemfsFilename,
  getRequiredAssetIds,
} from "@/core/ffmpeg/commandBuilder";
import type {
  ExportStartPayload,
  ExportWorkerInboundMessage,
  ExportWorkerOutboundMessage,
} from "@/core/ffmpeg/exportTypes";

interface FFmpegCoreFS {
  writeFile: (path: string, data: Uint8Array) => void;
  readFile: (path: string, options?: { encoding?: string }) => Uint8Array | string;
  unlink: (path: string) => void;
}

interface FFmpegCoreModule {
  FS: FFmpegCoreFS;
  exec: (...args: string[]) => number;
  ffprobe: (...args: string[]) => number;
  reset: () => void;
  setTimeout: (timeout: number) => void;
  setLogger: (callback: (data: { type: string; message: string }) => void) => void;
  setProgress: (
    callback: (data: { progress: number; time: number }) => void
  ) => void;
}

type FFmpegCoreFactory = (config: {
  mainScriptUrlOrBlob: string;
}) => Promise<FFmpegCoreModule>;

interface WorkerScope {
  onmessage: ((event: MessageEvent<ExportWorkerInboundMessage>) => void) | null;
  postMessage: (message: ExportWorkerOutboundMessage) => void;
}

const workerScope = globalThis as unknown as WorkerScope;

let coreSingleton: FFmpegCoreModule | null = null;
let currentOrigin = "";
let activeExportDurationSec = 0;
let recentLogs: string[] = [];

function postOutbound(message: ExportWorkerOutboundMessage): void {
  workerScope.postMessage(message);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== "{}") {
      return serialized;
    }
  } catch {
    // Ignore serialization error
  }
  return "Unknown export error.";
}

async function getLoadedCore(origin: string): Promise<FFmpegCoreModule> {
  if (coreSingleton && currentOrigin === origin) {
    return coreSingleton;
  }

  const coreURL = `${origin}/ffmpeg/ffmpeg-core.esm.js`;
  const wasmURL = `${origin}/ffmpeg/ffmpeg-core.wasm`;

  const imported = (await import(
    /* webpackIgnore: true */ coreURL
  )) as { default?: FFmpegCoreFactory };

  const createFFmpegCore = imported.default;
  if (typeof createFFmpegCore !== "function") {
    throw new Error(`Failed to load FFmpeg core factory from ${coreURL}`);
  }

  const core = await createFFmpegCore({
    mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL }))}`,
  });

  core.setLogger(({ message }) => {
    recentLogs.push(message);
    if (recentLogs.length > 40) {
      recentLogs = recentLogs.slice(-40);
    }
    postOutbound({ type: "LOG", payload: { message } });
  });

  core.setProgress(({ progress, time }) => {
    const timeSec = Number.isFinite(time) && time > 0 ? time / 1_000_000 : 0;
    const computedProgress =
      activeExportDurationSec > 0 && timeSec > 0
        ? timeSec / activeExportDurationSec
        : Number.isFinite(progress)
          ? progress
          : 0;
    const clamped = Math.min(1, Math.max(0, computedProgress));
    postOutbound({
      type: "PROGRESS",
      payload: { progress: clamped, timeSec },
    });
  });

  coreSingleton = core;
  currentOrigin = origin;
  return core;
}

async function runExport(payload: ExportStartPayload): Promise<void> {
  const { tracks, mediaAssets, blobs, canvas, origin } = payload;
  const memfsFilesToClean = new Set<string>();
  recentLogs = [];
  activeExportDurationSec = 0;

  postOutbound({
    type: "STATUS",
    payload: { stage: "loading_ffmpeg", message: "Loading FFmpeg.wasm core..." },
  });

  const core = await getLoadedCore(origin);

  try {
    postOutbound({
      type: "STATUS",
      payload: {
        stage: "writing_files",
        message: "Writing media assets into FFmpeg virtual filesystem...",
      },
    });

    const requiredAssetIds = getRequiredAssetIds(tracks);
    const assetMemfsNames = new Map<string, string>();

    for (const assetId of requiredAssetIds) {
      const asset = mediaAssets[assetId];
      const blob = blobs[assetId];
      if (!asset || !blob) {
        throw new Error(`Missing Blob data for asset "${assetId}".`);
      }
      const memfsName = buildMemfsFilename(asset);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      core.FS.writeFile(memfsName, bytes);
      memfsFilesToClean.add(memfsName);
      assetMemfsNames.set(assetId, memfsName);
    }

    // Probe video assets to detect whether they contain an audio stream
    const videoHasAudio: Record<string, boolean> = {};
    for (const [assetId, memfsName] of assetMemfsNames.entries()) {
      const asset = mediaAssets[assetId];
      if (!asset || asset.type !== "video") {
        continue;
      }

      const probeFile = `probe_${assetId.replace(/[^a-zA-Z0-9_-]/g, "")}.txt`;
      memfsFilesToClean.add(probeFile);
      try {
        core.setTimeout(-1);
        const exitCode = core.ffprobe(
          "-v",
          "error",
          "-select_streams",
          "a",
          "-show_entries",
          "stream=index",
          "-of",
          "csv=p=0",
          memfsName,
          "-o",
          probeFile
        );
        core.reset();
        if (exitCode === 0) {
          const rawProbe = core.FS.readFile(probeFile);
          const textProbe =
            typeof rawProbe === "string"
              ? rawProbe
              : new TextDecoder().decode(rawProbe);
          videoHasAudio[assetId] = textProbe.trim().length > 0;
        } else {
          videoHasAudio[assetId] = false;
        }
      } catch {
        core.reset();
        videoHasAudio[assetId] = false;
      }
    }

    const plan = buildFFmpegCommand({
      tracks,
      mediaAssets,
      canvas,
      videoHasAudio,
    });
    activeExportDurationSec = plan.totalDuration;

    if (plan.needsFont) {
      const fontResponse = await fetch(`${origin}/fonts/${plan.fontFilename}`);
      if (!fontResponse.ok) {
        throw new Error(
          `Failed to load local font "${plan.fontFilename}" (${fontResponse.status}).`
        );
      }
      const fontBytes = new Uint8Array(await fontResponse.arrayBuffer());
      core.FS.writeFile(plan.fontFilename, fontBytes);
      memfsFilesToClean.add(plan.fontFilename);
    }

    const encoder = new TextEncoder();
    for (const textFile of plan.textFiles) {
      core.FS.writeFile(textFile.filename, encoder.encode(textFile.content));
      memfsFilesToClean.add(textFile.filename);
    }

    memfsFilesToClean.add(plan.outputFilename);

    postOutbound({
      type: "STATUS",
      payload: {
        stage: "rendering",
        message: "Rendering 1080×1920 MP4 video...",
      },
    });

    core.setTimeout(-1);
    const execCode = core.exec(...plan.args);
    core.reset();

    if (execCode !== 0) {
      const tail = recentLogs.slice(-6).join(" | ");
      throw new Error(
        `FFmpeg exited with code ${execCode}.${tail ? ` Logs: ${tail}` : ""}`
      );
    }

    postOutbound({
      type: "STATUS",
      payload: {
        stage: "reading_output",
        message: "Finalizing MP4 output...",
      },
    });

    const rawOutput = core.FS.readFile(plan.outputFilename);
    const outputBytes =
      typeof rawOutput === "string"
        ? new TextEncoder().encode(rawOutput)
        : new Uint8Array(rawOutput);
    const outputBlob = new Blob([outputBytes], { type: "video/mp4" });

    postOutbound({
      type: "COMPLETE",
      payload: { outputBlob, durationSec: plan.totalDuration },
    });
  } finally {
    activeExportDurationSec = 0;
    // Strictly clean up all temporary files from FFmpeg MEMFS
    for (const filename of memfsFilesToClean) {
      try {
        core.FS.unlink(filename);
      } catch {
        // Continue deleting remaining files even if one was not created
      }
    }
  }
}

workerScope.onmessage = (event: MessageEvent<ExportWorkerInboundMessage>) => {
  const message = event.data;

  if (message.type === "CANCEL_EXPORT") {
    coreSingleton = null;
    postOutbound({
      type: "ERROR",
      payload: { message: "Export cancelled by user." },
    });
    return;
  }

  if (message.type === "START_EXPORT") {
    void runExport(message.payload).catch((error: unknown) => {
      postOutbound({
        type: "ERROR",
        payload: { message: formatError(error) },
      });
    });
  }
};
