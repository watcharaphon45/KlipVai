import { FFmpeg } from "@ffmpeg/ffmpeg";
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

interface WorkerScope {
  onmessage: ((event: MessageEvent<ExportWorkerInboundMessage>) => void) | null;
  postMessage: (message: ExportWorkerOutboundMessage) => void;
}

const workerScope = globalThis as unknown as WorkerScope;

let ffmpegSingleton: FFmpeg | null = null;
let currentOrigin = "";

function postOutbound(message: ExportWorkerOutboundMessage): void {
  workerScope.postMessage(message);
}

async function getLoadedFFmpeg(origin: string): Promise<FFmpeg> {
  if (ffmpegSingleton && ffmpegSingleton.loaded && currentOrigin === origin) {
    return ffmpegSingleton;
  }

  if (ffmpegSingleton) {
    ffmpegSingleton.terminate();
    ffmpegSingleton = null;
  }

  const instance = new FFmpeg();
  instance.on("log", ({ message }) => {
    postOutbound({ type: "LOG", payload: { message } });
  });
  instance.on("progress", ({ progress, time }) => {
    const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
    const timeSec = Number.isFinite(time) ? time / 1_000_000 : 0;
    postOutbound({
      type: "PROGRESS",
      payload: { progress: clamped, timeSec },
    });
  });

  await instance.load({
    coreURL: `${origin}/ffmpeg/ffmpeg-core.esm.js`,
    wasmURL: `${origin}/ffmpeg/ffmpeg-core.wasm`,
  });

  ffmpegSingleton = instance;
  currentOrigin = origin;
  return instance;
}

async function runExport(payload: ExportStartPayload): Promise<void> {
  const { tracks, mediaAssets, blobs, canvas, origin } = payload;
  const memfsFilesToClean = new Set<string>();

  postOutbound({
    type: "STATUS",
    payload: { stage: "loading_ffmpeg", message: "Loading FFmpeg.wasm core..." },
  });

  const ffmpeg = await getLoadedFFmpeg(origin);

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
      await ffmpeg.writeFile(memfsName, bytes);
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
        const exitCode = await ffmpeg.ffprobe([
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
          probeFile,
        ]);
        if (exitCode === 0) {
          const rawProbe = await ffmpeg.readFile(probeFile);
          const textProbe =
            typeof rawProbe === "string"
              ? rawProbe
              : new TextDecoder().decode(rawProbe);
          videoHasAudio[assetId] = textProbe.trim().length > 0;
        } else {
          videoHasAudio[assetId] = false;
        }
      } catch {
        videoHasAudio[assetId] = false;
      }
    }

    const plan = buildFFmpegCommand({
      tracks,
      mediaAssets,
      canvas,
      videoHasAudio,
    });

    if (plan.needsFont) {
      const fontResponse = await fetch(`${origin}/fonts/${plan.fontFilename}`);
      if (!fontResponse.ok) {
        throw new Error(
          `Failed to load local font "${plan.fontFilename}" (${fontResponse.status}).`
        );
      }
      const fontBytes = new Uint8Array(await fontResponse.arrayBuffer());
      await ffmpeg.writeFile(plan.fontFilename, fontBytes);
      memfsFilesToClean.add(plan.fontFilename);
    }

    const encoder = new TextEncoder();
    for (const textFile of plan.textFiles) {
      await ffmpeg.writeFile(
        textFile.filename,
        encoder.encode(textFile.content)
      );
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

    const execCode = await ffmpeg.exec(plan.args);
    if (execCode !== 0) {
      throw new Error(`FFmpeg exited with non-zero code ${execCode}.`);
    }

    postOutbound({
      type: "STATUS",
      payload: {
        stage: "reading_output",
        message: "Finalizing MP4 output...",
      },
    });

    const rawOutput = await ffmpeg.readFile(plan.outputFilename);
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
    // Strictly clean up all temporary files from FFmpeg MEMFS
    for (const filename of memfsFilesToClean) {
      try {
        await ffmpeg.deleteFile(filename);
      } catch {
        // Continue deleting remaining files even if one was not created
      }
    }
  }
}

workerScope.onmessage = (event: MessageEvent<ExportWorkerInboundMessage>) => {
  const message = event.data;

  if (message.type === "CANCEL_EXPORT") {
    if (ffmpegSingleton) {
      ffmpegSingleton.terminate();
      ffmpegSingleton = null;
    }
    postOutbound({
      type: "ERROR",
      payload: { message: "Export cancelled by user." },
    });
    return;
  }

  if (message.type === "START_EXPORT") {
    void runExport(message.payload).catch((error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown export error.";
      postOutbound({
        type: "ERROR",
        payload: { message: errorMessage },
      });
    });
  }
};
