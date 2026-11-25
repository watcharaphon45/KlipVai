import type {
  MediaAsset,
  ProjectCanvasConfig,
  TimelineTrack,
} from "@/types/timeline";
import { computeFittedLogicalSize } from "@/core/canvas/syncEngine";

export const DEFAULT_EXPORT_FONT_FILENAME = "Kanit-Regular.ttf";
export const DEFAULT_OUTPUT_FILENAME = "output.mp4";

export interface FFmpegCommandPlan {
  args: string[];
  outputFilename: string;
  totalDuration: number;
  requiredAssets: Array<{ assetId: string; memfsName: string }>;
  textFiles: Array<{ filename: string; content: string }>;
  needsFont: boolean;
  fontFilename: string;
}

function getSafeExtension(asset: MediaAsset): string {
  const dotIdx = asset.name.lastIndexOf(".");
  if (dotIdx !== -1) {
    const ext = asset.name.slice(dotIdx).toLowerCase();
    if (/^\.[a-z0-9]{1,8}$/.test(ext)) {
      return ext;
    }
  }
  if (asset.type === "video") {
    return ".mp4";
  }
  if (asset.type === "audio") {
    return ".mp3";
  }
  return ".png";
}

/**
 * Generates an ASCII-safe filename for FFmpeg MEMFS so Thai/space characters never break CLI parsing.
 */
export function buildMemfsFilename(asset: MediaAsset): string {
  const safeId = asset.id.replace(/[^a-zA-Z0-9_-]/g, "");
  return `asset_${safeId}${getSafeExtension(asset)}`;
}

/**
 * Returns unique MISSING or unresolvable MediaAssets referenced by non-hidden tracks.
 */
export function findMissingActiveAssets(
  tracks: TimelineTrack[],
  mediaAssets: Record<string, MediaAsset>
): MediaAsset[] {
  const missingMap = new Map<string, MediaAsset>();

  for (const track of tracks) {
    if (track.isHidden) {
      continue;
    }
    for (const item of track.items) {
      if (item.type === "text" || !item.assetId) {
        continue;
      }
      const asset = mediaAssets[item.assetId];
      if (!asset) {
        missingMap.set(item.assetId, {
          id: item.assetId,
          name: item.name,
          type: item.type,
          mimeType: "",
          fileSize: 0,
          duration: item.duration,
          status: "MISSING",
        });
      } else if (asset.status === "MISSING") {
        missingMap.set(asset.id, asset);
      }
    }
  }

  return Array.from(missingMap.values());
}

/**
 * Returns unique assetIds needed from IndexedDB for rendering non-hidden tracks.
 */
export function getRequiredAssetIds(tracks: TimelineTrack[]): string[] {
  const ids = new Set<string>();
  for (const track of tracks) {
    if (track.isHidden) {
      continue;
    }
    for (const item of track.items) {
      if (item.type === "text" || !item.assetId) {
        continue;
      }
      if (item.type === "audio" && (track.isMuted || item.volume <= 0)) {
        continue;
      }
      ids.add(item.assetId);
    }
  }
  return Array.from(ids);
}

function toEvenDimension(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function normalizeHexColor(color: string | undefined, fallback: string): string {
  if (!color) {
    return fallback;
  }
  const trimmed = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

/**
 * Translates multi-track timeline state into FFmpeg CLI arguments and -filter_complex graph.
 */
export function buildFFmpegCommand(options: {
  tracks: TimelineTrack[];
  mediaAssets: Record<string, MediaAsset>;
  canvas: ProjectCanvasConfig;
  videoHasAudio?: Record<string, boolean>;
  fontFilename?: string;
  outputFilename?: string;
}): FFmpegCommandPlan {
  const {
    tracks,
    mediaAssets,
    canvas,
    videoHasAudio = {},
    fontFilename = DEFAULT_EXPORT_FONT_FILENAME,
    outputFilename = DEFAULT_OUTPUT_FILENAME,
  } = options;

  const visibleTracks = [...tracks]
    .filter((t) => !t.isHidden && t.items.length > 0)
    .sort((a, b) => a.zIndex - b.zIndex);

  let totalDuration = 0;
  for (const track of visibleTracks) {
    for (const item of track.items) {
      const end = item.start + item.duration;
      if (end > totalDuration) {
        totalDuration = end;
      }
    }
  }

  if (totalDuration <= 0) {
    throw new Error("Timeline has no active clips to export.");
  }

  const inputArgs: string[] = [];
  const requiredAssetMap = new Map<string, string>();
  const filterParts: string[] = [];
  const textFiles: Array<{ filename: string; content: string }> = [];
  const audioLabels: string[] = [];

  let nextInputIdx = 0;
  let videoStep = 0;
  let vclipCounter = 0;
  let aclipCounter = 0;
  let textCounter = 0;
  let needsFont = false;

  filterParts.push(
    `color=c=black:s=${canvas.width}x${canvas.height}:r=${canvas.fps}:d=${totalDuration.toFixed(3)}[base0]`
  );

  for (const track of visibleTracks) {
    const sortedItems = [...track.items].sort((a, b) => a.start - b.start);

    for (const item of sortedItems) {
      const start = Math.max(0, item.start);
      const dur = Math.max(0.1, item.duration);
      const end = start + dur;
      const trimStart = Math.max(0, item.trimStart);

      if (item.type === "text") {
        const textContent = item.text ?? item.name;
        if (!textContent.trim()) {
          continue;
        }
        needsFont = true;
        const textFilename = `text_${textCounter}.txt`;
        textCounter += 1;
        textFiles.push({ filename: textFilename, content: textContent });

        const fontSize = Math.max(
          12,
          Math.round((item.textStyle?.fontSize ?? 64) * item.scale)
        );
        const fillHex = normalizeHexColor(item.textStyle?.fill, "#ffffff");
        const opacity = Math.min(1, Math.max(0, item.opacity)).toFixed(3);
        const borderW = Math.max(
          0,
          Math.round((item.textStyle?.strokeWidth ?? 0) * item.scale)
        );
        const borderHex = normalizeHexColor(
          item.textStyle?.stroke,
          "#000000"
        );

        const drawParts = [
          `fontfile=${fontFilename}`,
          `textfile=${textFilename}`,
          `fontsize=${fontSize}`,
          `fontcolor=${fillHex}@${opacity}`,
        ];
        if (borderW > 0) {
          drawParts.push(`borderw=${borderW}`, `bordercolor=${borderHex}@${opacity}`);
        }
        drawParts.push(
          `x=${Math.round(item.x)}-text_w/2`,
          `y=${Math.round(item.y)}-text_h/2`,
          `enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`
        );

        const inLabel = `base${videoStep}`;
        const outLabel = `base${videoStep + 1}`;
        videoStep += 1;
        filterParts.push(`[${inLabel}]drawtext=${drawParts.join(":")}[${outLabel}]`);
        continue;
      }

      if (!item.assetId) {
        continue;
      }
      const asset = mediaAssets[item.assetId];
      if (!asset || asset.status === "MISSING") {
        throw new Error(`Missing media asset "${item.name}" cannot be exported.`);
      }

      const memfsName = buildMemfsFilename(asset);
      requiredAssetMap.set(asset.id, memfsName);

      const isAudioOnly = item.type === "audio";
      const trackAllowsAudio = !track.isMuted && item.volume > 0;
      const shouldIncludeAudio =
        trackAllowsAudio &&
        (isAudioOnly || (item.type === "video" && videoHasAudio[asset.id] === true));

      if (isAudioOnly && !shouldIncludeAudio) {
        continue;
      }

      const inputIdx = nextInputIdx;
      nextInputIdx += 1;

      inputArgs.push("-i", memfsName);

      // Visual pipeline for video/image
      if (item.type === "video" || item.type === "image") {
        const fitted = computeFittedLogicalSize(
          item.width ?? asset.width,
          item.height ?? asset.height,
          canvas.width,
          canvas.height
        );
        const scaledW = toEvenDimension(fitted.width * item.scale);
        const scaledH = toEvenDimension(fitted.height * item.scale);

        const vFilters: string[] = [];
        if (item.type === "video") {
          vFilters.push(
            `trim=start=${trimStart.toFixed(3)}:duration=${dur.toFixed(3)}`,
            `setpts=PTS-STARTPTS+${start.toFixed(3)}/TB`
          );
        } else {
          vFilters.push("setpts=0");
        }

        vFilters.push(
          `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=decrease`,
          "format=rgba"
        );

        if (item.opacity < 1) {
          const alpha = Math.min(1, Math.max(0, item.opacity)).toFixed(3);
          vFilters.push(`colorchannelmixer=aa=${alpha}`);
        }

        if (Math.abs(item.rotation) > 0.01) {
          const radians = ((item.rotation * Math.PI) / 180).toFixed(5);
          vFilters.push(`rotate=${radians}:c=none:ow=rotw(iw):oh=roth(ih)`);
        }

        const vClipLabel = `vclip_${vclipCounter}`;
        vclipCounter += 1;
        filterParts.push(`[${inputIdx}:v]${vFilters.join(",")}[${vClipLabel}]`);

        const inBase = `base${videoStep}`;
        const outBase = `base${videoStep + 1}`;
        videoStep += 1;
        const eofMode =
          item.type === "image"
            ? "eof_action=repeat:shortest=0"
            : "eof_action=pass";
        filterParts.push(
          `[${inBase}][${vClipLabel}]overlay=x=${Math.round(item.x)}-overlay_w/2:y=${Math.round(item.y)}-overlay_h/2:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})':${eofMode}[${outBase}]`
        );
      }

      // Audio pipeline for audio or video-with-audio
      if (shouldIncludeAudio) {
        const delayMs = Math.max(0, Math.round(start * 1000));
        const vol = Math.max(0, item.volume).toFixed(3);
        const aLabel = `aclip_${aclipCounter}`;
        aclipCounter += 1;
        filterParts.push(
          `[${inputIdx}:a]atrim=start=${trimStart.toFixed(3)}:duration=${dur.toFixed(3)},asetpts=PTS-STARTPTS,volume=${vol},adelay=${delayMs}|${delayMs}[${aLabel}]`
        );
        audioLabels.push(`[${aLabel}]`);
      }
    }
  }

  if (audioLabels.length === 1) {
    filterParts.push(`${audioLabels[0]}anull[aout]`);
  } else if (audioLabels.length > 1) {
    filterParts.push(
      `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0[aout]`
    );
  }

  const finalVideoLabel = `[base${videoStep}]`;
  const args: string[] = [
    ...inputArgs,
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    finalVideoLabel,
  ];

  if (audioLabels.length > 0) {
    args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "128k", "-ar", "44100");
  } else {
    args.push("-an");
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(canvas.fps),
    "-t",
    totalDuration.toFixed(3),
    "-movflags",
    "+faststart",
    outputFilename
  );

  return {
    args,
    outputFilename,
    totalDuration,
    requiredAssets: Array.from(requiredAssetMap.entries()).map(
      ([assetId, memfsName]) => ({ assetId, memfsName })
    ),
    textFiles,
    needsFont,
    fontFilename,
  };
}
