import type {
  MediaAsset,
  TimelineItem,
  TimelineTrack,
} from "@/types/timeline";

export const LOGICAL_WIDTH = 1080;
export const LOGICAL_HEIGHT = 1920;
export const PROXY_SCALE = 0.5;
export const PROXY_WIDTH = 540;
export const PROXY_HEIGHT = 960;
export const SYNC_DRIFT_THRESHOLD_SEC = 0.1;
const PAUSED_DRIFT_THRESHOLD_SEC = 0.03;

export interface ActiveRenderEntry {
  item: TimelineItem;
  track: TimelineTrack;
  asset?: MediaAsset;
  targetMediaTime: number;
}

interface MediaElementEntry {
  itemId: string;
  assetId: string;
  blobUrl: string;
  kind: "video" | "audio" | "image";
  element: HTMLVideoElement | HTMLAudioElement | HTMLImageElement;
  cleanup: () => void;
}

/**
 * Computes active timeline entries at currentTime from visible tracks sorted bottom-to-top (zIndex ascending).
 */
export function getActiveEntries(
  tracks: TimelineTrack[],
  mediaAssets: Record<string, MediaAsset>,
  currentTime: number
): ActiveRenderEntry[] {
  const visibleTracks = [...tracks]
    .filter((track) => !track.isHidden)
    .sort((a, b) => a.zIndex - b.zIndex);

  const entries: ActiveRenderEntry[] = [];
  for (const track of visibleTracks) {
    for (const item of track.items) {
      if (
        currentTime >= item.start &&
        currentTime <= item.start + item.duration
      ) {
        const asset = item.assetId ? mediaAssets[item.assetId] : undefined;
        const targetMediaTime = Math.max(
          0,
          currentTime - item.start + item.trimStart
        );
        entries.push({ item, track, asset, targetMediaTime });
      }
    }
  }
  return entries;
}

/**
 * Fits natural media dimensions within the 1080x1920 logical canvas preserving aspect ratio.
 */
export function computeFittedLogicalSize(
  naturalWidth?: number,
  naturalHeight?: number,
  maxWidth = LOGICAL_WIDTH,
  maxHeight = LOGICAL_HEIGHT
): { width: number; height: number } {
  if (
    !naturalWidth ||
    !naturalHeight ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return { width: maxWidth, height: maxHeight };
  }

  const ratio = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight);
  return {
    width: Math.round(naturalWidth * ratio),
    height: Math.round(naturalHeight * ratio),
  };
}

/**
 * Manages off-screen HTML5 <video>, <audio>, and Image elements synchronized to timeline currentTime.
 */
export class CanvasSyncEngine {
  private entries = new Map<string, MediaElementEntry>();
  private onDrawableReady?: (
    itemId: string,
    element: HTMLVideoElement | HTMLImageElement
  ) => void;

  constructor(
    onDrawableReady?: (
      itemId: string,
      element: HTMLVideoElement | HTMLImageElement
    ) => void
  ) {
    this.onDrawableReady = onDrawableReady;
  }

  private createEntry(
    item: TimelineItem,
    asset: MediaAsset,
    blobUrl: string
  ): MediaElementEntry | null {
    if (typeof document === "undefined") {
      return null;
    }

    if (asset.type === "video") {
      const video = document.createElement("video");
      video.preload = "auto";
      video.playsInline = true;
      video.crossOrigin = "anonymous";
      video.src = blobUrl;

      const notifyReady = (): void => {
        if (video.readyState >= 2) {
          this.onDrawableReady?.(item.id, video);
        }
      };

      video.addEventListener("loadeddata", notifyReady);
      video.addEventListener("seeked", notifyReady);

      return {
        itemId: item.id,
        assetId: asset.id,
        blobUrl,
        kind: "video",
        element: video,
        cleanup: () => {
          video.removeEventListener("loadeddata", notifyReady);
          video.removeEventListener("seeked", notifyReady);
          video.pause();
          video.removeAttribute("src");
          video.load();
        },
      };
    }

    if (asset.type === "audio") {
      const audio = document.createElement("audio");
      audio.preload = "auto";
      audio.src = blobUrl;

      return {
        itemId: item.id,
        assetId: asset.id,
        blobUrl,
        kind: "audio",
        element: audio,
        cleanup: () => {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        },
      };
    }

    const img = new Image();
    const onLoad = (): void => {
      if (img.complete && img.naturalWidth > 0) {
        this.onDrawableReady?.(item.id, img);
      }
    };
    img.addEventListener("load", onLoad);
    img.src = blobUrl;

    return {
      itemId: item.id,
      assetId: asset.id,
      blobUrl,
      kind: "image",
      element: img,
      cleanup: () => {
        img.removeEventListener("load", onLoad);
        img.src = "";
      },
    };
  }

  /**
   * Synchronizes all active media elements to their target media time and play/pause state.
   */
  sync(activeEntries: ActiveRenderEntry[], isPlaying: boolean): void {
    const activeIds = new Set<string>();

    for (const { item, track, asset, targetMediaTime } of activeEntries) {
      if (item.type === "text" || !asset) {
        continue;
      }
      if (asset.status !== "READY" || !asset.blobUrl) {
        continue;
      }

      activeIds.add(item.id);

      let entry = this.entries.get(item.id);
      if (
        !entry ||
        entry.assetId !== asset.id ||
        entry.blobUrl !== asset.blobUrl
      ) {
        if (entry) {
          entry.cleanup();
          this.entries.delete(item.id);
        }
        const created = this.createEntry(item, asset, asset.blobUrl);
        if (!created) {
          continue;
        }
        entry = created;
        this.entries.set(item.id, entry);
      }

      if (entry.kind === "image") {
        const img = entry.element as HTMLImageElement;
        if (img.complete && img.naturalWidth > 0) {
          this.onDrawableReady?.(item.id, img);
        }
        continue;
      }

      const mediaEl = entry.element as HTMLVideoElement | HTMLAudioElement;
      const shouldMute = track.isMuted || item.volume <= 0;
      mediaEl.muted = shouldMute;
      mediaEl.volume = Math.min(1, Math.max(0, item.volume));

      const clampedTarget =
        Number.isFinite(mediaEl.duration) && mediaEl.duration > 0
          ? Math.min(targetMediaTime, Math.max(0, mediaEl.duration - 0.01))
          : targetMediaTime;

      const driftThreshold = isPlaying
        ? SYNC_DRIFT_THRESHOLD_SEC
        : PAUSED_DRIFT_THRESHOLD_SEC;

      if (
        mediaEl.readyState >= 1 &&
        Math.abs(mediaEl.currentTime - clampedTarget) > driftThreshold
      ) {
        mediaEl.currentTime = clampedTarget;
      }

      if (entry.kind === "video") {
        const videoEl = mediaEl as HTMLVideoElement;
        if (videoEl.readyState >= 2) {
          this.onDrawableReady?.(item.id, videoEl);
        }
      }

      if (isPlaying) {
        if (mediaEl.paused && mediaEl.readyState >= 2) {
          void mediaEl.play().catch(() => undefined);
        }
      } else if (!mediaEl.paused) {
        mediaEl.pause();
      }
    }

    // Pause any media elements that are not currently active
    for (const [itemId, entry] of this.entries.entries()) {
      if (activeIds.has(itemId)) {
        continue;
      }
      if (entry.kind === "video" || entry.kind === "audio") {
        const mediaEl = entry.element as HTMLVideoElement | HTMLAudioElement;
        if (!mediaEl.paused) {
          mediaEl.pause();
        }
      }
    }
  }

  /**
   * Disposes cached media elements for items that no longer exist on any track.
   */
  pruneRemovedItems(validItemIds: Set<string>): void {
    for (const [itemId, entry] of this.entries.entries()) {
      if (!validItemIds.has(itemId)) {
        entry.cleanup();
        this.entries.delete(itemId);
      }
    }
  }

  /**
   * Returns a snapshot of currently ready drawable elements keyed by itemId.
   */
  getDrawableSnapshot(): Record<string, HTMLVideoElement | HTMLImageElement> {
    const snapshot: Record<string, HTMLVideoElement | HTMLImageElement> = {};
    for (const [itemId, entry] of this.entries.entries()) {
      if (entry.kind === "video") {
        const video = entry.element as HTMLVideoElement;
        if (video.readyState >= 2) {
          snapshot[itemId] = video;
        }
      } else if (entry.kind === "image") {
        const img = entry.element as HTMLImageElement;
        if (img.complete && img.naturalWidth > 0) {
          snapshot[itemId] = img;
        }
      }
    }
    return snapshot;
  }

  /**
   * Releases all off-screen media elements.
   */
  disposeAll(): void {
    for (const entry of this.entries.values()) {
      entry.cleanup();
    }
    this.entries.clear();
  }
}
