import type { MediaAsset, MediaType } from "@/types/timeline";

export const RELINK_DURATION_TOLERANCE_SEC = 0.05;

const METADATA_TIMEOUT_MS = 15_000;

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v"]);
const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".aac",
  ".m4a",
  ".ogg",
  ".flac",
]);
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".heic",
  ".heif",
]);

export interface ExtractedMediaMetadata {
  type: MediaType;
  duration: number;
  width?: number;
  height?: number;
  size: number;
  mimeType: string;
  name: string;
}

export interface RelinkMatchResult {
  isValid: boolean;
  reason?: string;
  extracted?: ExtractedMediaMetadata;
}

/**
 * Detects whether a File is video, audio, or image using MIME type and extension fallback.
 */
export function detectMediaType(file: File): MediaType | null {
  const mime = file.type.toLowerCase();
  if (mime.startsWith("video/")) {
    return "video";
  }
  if (mime.startsWith("audio/")) {
    return "audio";
  }
  if (mime.startsWith("image/")) {
    return "image";
  }

  const lowerName = file.name.toLowerCase();
  const dotIndex = lowerName.lastIndexOf(".");
  if (dotIndex === -1) {
    return null;
  }

  const ext = lowerName.slice(dotIndex);
  if (VIDEO_EXTENSIONS.has(ext)) {
    return "video";
  }
  if (AUDIO_EXTENSIONS.has(ext)) {
    return "audio";
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return "image";
  }

  return null;
}

function loadVideoElementMetadata(
  objectUrl: string
): Promise<{ duration: number; width?: number; height?: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("Timed out while reading video metadata."));
      }
    }, METADATA_TIMEOUT_MS);

    const cleanup = (): void => {
      window.clearTimeout(timeoutId);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("error", onError);
      video.removeAttribute("src");
      video.load();
    };

    const onLoadedMetadata = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const width = video.videoWidth > 0 ? video.videoWidth : undefined;
      const height = video.videoHeight > 0 ? video.videoHeight : undefined;
      cleanup();
      resolve({ duration, width, height });
    };

    const onError = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error("Failed to decode video metadata."));
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("error", onError);
    video.src = objectUrl;
  });
}

function loadAudioElementMetadata(
  objectUrl: string
): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";

    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("Timed out while reading audio metadata."));
      }
    }, METADATA_TIMEOUT_MS);

    const cleanup = (): void => {
      window.clearTimeout(timeoutId);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("error", onError);
      audio.removeAttribute("src");
      audio.load();
    };

    const onLoadedMetadata = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      cleanup();
      resolve({ duration });
    };

    const onError = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error("Failed to decode audio metadata."));
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("error", onError);
    audio.src = objectUrl;
  });
}

function loadImageElementMetadata(
  objectUrl: string
): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("Timed out while reading image metadata."));
      }
    }, METADATA_TIMEOUT_MS);

    const cleanup = (): void => {
      window.clearTimeout(timeoutId);
      img.onload = null;
      img.onerror = null;
    };

    img.onload = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      const width = img.naturalWidth > 0 ? img.naturalWidth : undefined;
      const height = img.naturalHeight > 0 ? img.naturalHeight : undefined;
      cleanup();
      resolve({ width, height });
    };

    img.onerror = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error("Failed to decode image metadata."));
    };

    img.src = objectUrl;
  });
}

/**
 * Extracts duration, dimensions, size, and MIME type from a media File using off-screen HTML5 elements.
 */
export async function extractVideoMetadata(
  file: File
): Promise<ExtractedMediaMetadata> {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error(
      "Media metadata extraction is only available in a browser environment."
    );
  }

  const type = detectMediaType(file);
  if (!type) {
    throw new Error(`Unsupported media file type: ${file.name}`);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    if (type === "video") {
      const { duration, width, height } =
        await loadVideoElementMetadata(objectUrl);
      return {
        type: "video",
        duration,
        width,
        height,
        size: file.size,
        mimeType: file.type || "video/mp4",
        name: file.name,
      };
    }

    if (type === "audio") {
      const { duration } = await loadAudioElementMetadata(objectUrl);
      return {
        type: "audio",
        duration,
        size: file.size,
        mimeType: file.type || "audio/mpeg",
        name: file.name,
      };
    }

    const { width, height } = await loadImageElementMetadata(objectUrl);
    return {
      type: "image",
      duration: 0,
      width,
      height,
      size: file.size,
      mimeType: file.type || "image/png",
      name: file.name,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export const extractMediaMetadata = extractVideoMetadata;

/**
 * Validates whether a user-selected candidate File matches a MISSING MediaAsset.
 */
export async function matchRelinkFile(
  asset: MediaAsset,
  candidateFile: File
): Promise<RelinkMatchResult> {
  if (candidateFile.size !== asset.fileSize) {
    return {
      isValid: false,
      reason: `File size mismatch: expected ${asset.fileSize} bytes, got ${candidateFile.size} bytes.`,
    };
  }

  const candidateType = detectMediaType(candidateFile);
  if (candidateType !== asset.type) {
    return {
      isValid: false,
      reason: `Media type mismatch: expected ${asset.type}, got ${candidateType ?? "unknown"}.`,
    };
  }

  let extracted: ExtractedMediaMetadata;
  try {
    extracted = await extractVideoMetadata(candidateFile);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown metadata read error.";
    return {
      isValid: false,
      reason: `Unable to read media metadata: ${message}`,
    };
  }

  if (asset.type === "video" || asset.type === "audio") {
    const diff = Math.abs(extracted.duration - asset.duration);
    if (diff > RELINK_DURATION_TOLERANCE_SEC) {
      return {
        isValid: false,
        reason: `Duration mismatch: expected ${asset.duration.toFixed(2)}s (±${RELINK_DURATION_TOLERANCE_SEC}s), got ${extracted.duration.toFixed(2)}s.`,
        extracted,
      };
    }
  }

  return {
    isValid: true,
    extracted,
  };
}
