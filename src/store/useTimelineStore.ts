import { create } from "zustand";
import { temporal } from "zundo";
import { v4 as uuidv4 } from "uuid";
import type {
  MediaAsset,
  PersistedMediaAsset,
  PersistedProjectData,
  ProjectCanvasConfig,
  ProjectState,
  TimelineItem,
  TimelineTrack,
  TrackType,
} from "@/types/timeline";
import {
  deleteMediaFromLocal,
  loadMediaFromLocal,
  saveMediaToLocal,
} from "@/core/storage/localDb";
import { normalizeMediaFileForBrowser } from "@/core/storage/heicConverter";
import {
  extractVideoMetadata,
  matchRelinkFile,
  type RelinkMatchResult,
} from "@/core/storage/relinkMatcher";
import {
  TIME_EPSILON,
  findNextAvailableStart,
  isItemCompatibleWithTrack,
  resolveNonOverlappingStart,
} from "@/core/timeline/timelineMath";

export const MIN_CLIP_DURATION = 0.1;
export const DEFAULT_PIXELS_PER_SECOND = 50;
export const MIN_PIXELS_PER_SECOND = 10;
export const MAX_PIXELS_PER_SECOND = 300;
export const DEFAULT_CANVAS_CONFIG: ProjectCanvasConfig = {
  width: 1080,
  height: 1920,
  fps: 30,
};

function calculateProjectDuration(tracks: TimelineTrack[]): number {
  let maxEnd = 0;
  for (const track of tracks) {
    for (const item of track.items) {
      const itemEnd = item.start + item.duration;
      if (itemEnd > maxEnd) {
        maxEnd = itemEnd;
      }
    }
  }
  return maxEnd;
}

function safeRevokeBlobUrl(blobUrl?: string): void {
  if (blobUrl && typeof URL !== "undefined") {
    URL.revokeObjectURL(blobUrl);
  }
}

function revokeAllAssetUrls(mediaAssets: Record<string, MediaAsset>): void {
  for (const asset of Object.values(mediaAssets)) {
    safeRevokeBlobUrl(asset.blobUrl);
  }
}

function createInitialState(): ProjectState {
  return {
    projectId: null,
    projectName: "Untitled Project",
    mediaAssets: {},
    tracks: [],
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    pixelsPerSecond: DEFAULT_PIXELS_PER_SECOND,
    selectedItemId: null,
    selectedTrackId: null,
    canvas: { ...DEFAULT_CANVAS_CONFIG },
  };
}

export interface TimelineActions {
  // Project & Hydration
  setProjectMeta: (projectId: string | null, projectName: string) => void;
  serializeProjectData: () => PersistedProjectData;
  loadProjectData: (
    projectId: string | null,
    projectName: string,
    data: PersistedProjectData
  ) => Promise<void>;
  verifyAndHydrateAssets: () => Promise<void>;
  resetProject: () => void;

  // Media Assets
  importMediaFile: (file: File) => Promise<MediaAsset>;
  addMediaAsset: (asset: MediaAsset) => void;
  removeMediaAsset: (assetId: string) => Promise<void>;
  relinkAsset: (assetId: string, file: File) => Promise<RelinkMatchResult>;

  // Tracks
  addTrack: (type: TrackType, name?: string) => TimelineTrack;
  removeTrack: (trackId: string) => void;
  updateTrack: (
    trackId: string,
    patch: Partial<Omit<TimelineTrack, "id" | "items">>
  ) => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackHide: (trackId: string) => void;
  toggleTrackLock: (trackId: string) => void;
  reorderTracks: (orderedTrackIds: string[]) => void;

  // Timeline Items
  addItem: (
    trackId: string,
    itemInput: Omit<TimelineItem, "id" | "trackId"> & { id?: string }
  ) => TimelineItem | null;
  updateItem: (
    itemId: string,
    patch: Partial<Omit<TimelineItem, "id" | "trackId">>
  ) => void;
  moveItem: (itemId: string, newStart: number, targetTrackId?: string) => void;
  trimItemLeft: (itemId: string, deltaSec: number) => void;
  trimItemLeftFromAnchor: (
    itemId: string,
    anchor: { start: number; duration: number; trimStart: number },
    totalDeltaSec: number
  ) => void;
  trimItemRight: (itemId: string, newDuration: number) => void;
  splitItemAtPlayhead: (itemId?: string) => [TimelineItem, TimelineItem] | null;
  removeItem: (itemId: string) => void;
  copySelectedItem: (itemId?: string) => TimelineItem | null;
  pasteClipboardItem: (options?: {
    targetTrackId?: string;
    atTime?: number;
  }) => TimelineItem | null;
  duplicateSelectedItem: (itemId?: string) => TimelineItem | null;

  // Playback, Zoom, Selection
  setCurrentTime: (time: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  togglePlay: () => void;
  setPixelsPerSecond: (pps: number) => void;
  selectItem: (itemId: string | null) => void;
  selectTrack: (trackId: string | null) => void;
  setCanvasFps: (fps: number) => void;
}

export interface TimelineStoreExtras {
  clipboardItem: TimelineItem | null;
}

export type TimelineStore = ProjectState & TimelineStoreExtras & TimelineActions;

function cloneTimelineItem(item: TimelineItem): TimelineItem {
  return {
    ...item,
    textStyle: item.textStyle ? { ...item.textStyle } : undefined,
  };
}

function getDefaultTrackTypeForItem(itemType: TimelineItem["type"]): TrackType {
  if (itemType === "audio") {
    return "audio";
  }
  if (itemType === "text") {
    return "text";
  }
  if (itemType === "image") {
    return "overlay";
  }
  return "video";
}

export const useTimelineStore = create<TimelineStore>()(
  temporal(
    (set, get) => ({
      ...createInitialState(),
      clipboardItem: null,

      setProjectMeta: (projectId, projectName) => {
        set({ projectId, projectName });
      },

      serializeProjectData: () => {
        const { mediaAssets, tracks } = get();
        const persistedAssets: Record<string, PersistedMediaAsset> = {};

        for (const [assetId, asset] of Object.entries(mediaAssets)) {
          const { blobUrl: _omitted, ...persisted } = asset;
          void _omitted;
          persistedAssets[assetId] = persisted;
        }

        return {
          mediaAssets: persistedAssets,
          tracks,
        };
      },

      loadProjectData: async (projectId, projectName, data) => {
        revokeAllAssetUrls(get().mediaAssets);

        const hydratedAssets: Record<string, MediaAsset> = {};
        const entries = Object.entries(data.mediaAssets);

        for (const [assetId, persisted] of entries) {
          const blob = await loadMediaFromLocal(assetId);
          if (blob) {
            hydratedAssets[assetId] = {
              ...persisted,
              status: "READY",
              blobUrl: URL.createObjectURL(blob),
            };
          } else {
            hydratedAssets[assetId] = {
              ...persisted,
              status: "MISSING",
              blobUrl: undefined,
            };
          }
        }

        const tracks = data.tracks.map((track) => ({
          ...track,
          items: track.items.map((item) => ({ ...item })),
        }));

        set({
          projectId,
          projectName,
          mediaAssets: hydratedAssets,
          tracks,
          currentTime: 0,
          duration: calculateProjectDuration(tracks),
          isPlaying: false,
          selectedItemId: null,
          selectedTrackId: null,
          clipboardItem: null,
        });

        useTimelineStore.temporal.getState().clear();
      },

      verifyAndHydrateAssets: async () => {
        const currentAssets = get().mediaAssets;
        const updates: Record<string, MediaAsset> = {};
        let hasChanges = false;

        for (const [assetId, asset] of Object.entries(currentAssets)) {
          if (asset.status === "READY" && asset.blobUrl) {
            continue;
          }

          const blob = await loadMediaFromLocal(assetId);
          if (blob) {
            safeRevokeBlobUrl(asset.blobUrl);
            updates[assetId] = {
              ...asset,
              status: "READY",
              blobUrl: URL.createObjectURL(blob),
            };
            hasChanges = true;
          } else if (asset.status !== "MISSING" || asset.blobUrl !== undefined) {
            safeRevokeBlobUrl(asset.blobUrl);
            updates[assetId] = {
              ...asset,
              status: "MISSING",
              blobUrl: undefined,
            };
            hasChanges = true;
          }
        }

        if (hasChanges) {
          set((state) => ({
            mediaAssets: {
              ...state.mediaAssets,
              ...updates,
            },
          }));
        }
      },

      resetProject: () => {
        revokeAllAssetUrls(get().mediaAssets);
        set({
          ...createInitialState(),
          clipboardItem: null,
        });
        useTimelineStore.temporal.getState().clear();
      },

      importMediaFile: async (file) => {
        const normalizedFile = await normalizeMediaFileForBrowser(file);
        const extracted = await extractVideoMetadata(normalizedFile);
        const assetId = uuidv4();

        await saveMediaToLocal(assetId, normalizedFile, {
          fileName: extracted.name,
          mimeType: extracted.mimeType,
        });

        const blobUrl = URL.createObjectURL(normalizedFile);
        const newAsset: MediaAsset = {
          id: assetId,
          name: extracted.name,
          type: extracted.type,
          mimeType: extracted.mimeType,
          fileSize: extracted.size,
          duration: extracted.duration,
          width: extracted.width,
          height: extracted.height,
          status: "READY",
          blobUrl,
        };

        set((state) => ({
          mediaAssets: {
            ...state.mediaAssets,
            [assetId]: newAsset,
          },
        }));

        return newAsset;
      },

      addMediaAsset: (asset) => {
        set((state) => ({
          mediaAssets: {
            ...state.mediaAssets,
            [asset.id]: asset,
          },
        }));
      },

      removeMediaAsset: async (assetId) => {
        const existing = get().mediaAssets[assetId];
        if (existing) {
          safeRevokeBlobUrl(existing.blobUrl);
        }

        await deleteMediaFromLocal(assetId);

        set((state) => {
          const nextAssets = { ...state.mediaAssets };
          delete nextAssets[assetId];

          let selectedRemoved = false;
          const nextTracks = state.tracks.map((track) => {
            const filteredItems = track.items.filter((item) => {
              const keep = item.assetId !== assetId;
              if (!keep && item.id === state.selectedItemId) {
                selectedRemoved = true;
              }
              return keep;
            });
            return {
              ...track,
              items: filteredItems,
            };
          });

          return {
            mediaAssets: nextAssets,
            tracks: nextTracks,
            duration: calculateProjectDuration(nextTracks),
            selectedItemId: selectedRemoved ? null : state.selectedItemId,
          };
        });
      },

      relinkAsset: async (assetId, file) => {
        const existing = get().mediaAssets[assetId];
        if (!existing) {
          return {
            isValid: false,
            reason: `Asset "${assetId}" was not found in the current project.`,
          };
        }

        const matchResult = await matchRelinkFile(existing, file);
        if (!matchResult.isValid) {
          return matchResult;
        }

        await saveMediaToLocal(assetId, file, {
          fileName: file.name,
          mimeType: matchResult.extracted?.mimeType ?? existing.mimeType,
        });

        safeRevokeBlobUrl(existing.blobUrl);
        const blobUrl = URL.createObjectURL(file);

        set((state) => {
          const currentAsset = state.mediaAssets[assetId];
          if (!currentAsset) {
            safeRevokeBlobUrl(blobUrl);
            return state;
          }

          return {
            mediaAssets: {
              ...state.mediaAssets,
              [assetId]: {
                ...currentAsset,
                status: "READY",
                blobUrl,
              },
            },
          };
        });

        return matchResult;
      },

      addTrack: (type, name) => {
        const currentTracks = get().tracks;
        const maxZIndex = currentTracks.reduce(
          (max, track) => Math.max(max, track.zIndex),
          -1
        );
        const newTrack: TimelineTrack = {
          id: uuidv4(),
          name: name ?? `${type.toUpperCase()} ${currentTracks.length + 1}`,
          type,
          zIndex: maxZIndex + 1,
          isMuted: false,
          isHidden: false,
          isLocked: false,
          items: [],
        };

        set((state) => ({
          tracks: [...state.tracks, newTrack],
        }));

        return newTrack;
      },

      removeTrack: (trackId) => {
        set((state) => {
          const targetTrack = state.tracks.find((t) => t.id === trackId);
          if (!targetTrack) {
            return state;
          }

          const removedItemIds = new Set(targetTrack.items.map((i) => i.id));
          const nextTracks = state.tracks
            .filter((t) => t.id !== trackId)
            .map((track, idx) => ({ ...track, zIndex: idx }));

          return {
            tracks: nextTracks,
            duration: calculateProjectDuration(nextTracks),
            selectedTrackId:
              state.selectedTrackId === trackId ? null : state.selectedTrackId,
            selectedItemId:
              state.selectedItemId && removedItemIds.has(state.selectedItemId)
                ? null
                : state.selectedItemId,
          };
        });
      },

      updateTrack: (trackId, patch) => {
        set((state) => ({
          tracks: state.tracks.map((track) =>
            track.id === trackId ? { ...track, ...patch } : track
          ),
        }));
      },

      toggleTrackMute: (trackId) => {
        set((state) => ({
          tracks: state.tracks.map((track) =>
            track.id === trackId ? { ...track, isMuted: !track.isMuted } : track
          ),
        }));
      },

      toggleTrackHide: (trackId) => {
        set((state) => ({
          tracks: state.tracks.map((track) =>
            track.id === trackId
              ? { ...track, isHidden: !track.isHidden }
              : track
          ),
        }));
      },

      toggleTrackLock: (trackId) => {
        set((state) => ({
          tracks: state.tracks.map((track) =>
            track.id === trackId
              ? { ...track, isLocked: !track.isLocked }
              : track
          ),
        }));
      },

      reorderTracks: (orderedTrackIds) => {
        set((state) => {
          const trackMap = new Map(state.tracks.map((t) => [t.id, t]));
          const reordered: TimelineTrack[] = [];

          for (const id of orderedTrackIds) {
            const track = trackMap.get(id);
            if (track) {
              reordered.push(track);
              trackMap.delete(id);
            }
          }

          for (const remaining of trackMap.values()) {
            reordered.push(remaining);
          }

          const nextTracks = reordered.map((track, index) => ({
            ...track,
            zIndex: index,
          }));

          return { tracks: nextTracks };
        });
      },

      addItem: (trackId, itemInput) => {
        const targetTrack = get().tracks.find((t) => t.id === trackId);
        if (!targetTrack || targetTrack.isLocked) {
          return null;
        }

        const clampedDuration = Math.max(MIN_CLIP_DURATION, itemInput.duration);
        const resolvedStart = findNextAvailableStart(
          targetTrack.items,
          Math.max(0, itemInput.start),
          clampedDuration
        );

        const newItem: TimelineItem = {
          ...itemInput,
          id: itemInput.id ?? uuidv4(),
          trackId,
          start: resolvedStart,
          duration: clampedDuration,
          trimStart: Math.max(0, itemInput.trimStart),
        };

        set((state) => {
          const nextTracks = state.tracks.map((track) =>
            track.id === trackId
              ? { ...track, items: [...track.items, newItem] }
              : track
          );
          return {
            tracks: nextTracks,
            duration: calculateProjectDuration(nextTracks),
          };
        });

        return newItem;
      },

      updateItem: (itemId, patch) => {
        set((state) => {
          let updated = false;
          const nextTracks = state.tracks.map((track) => {
            if (track.isLocked) {
              return track;
            }
            const hasItem = track.items.some((item) => item.id === itemId);
            if (!hasItem) {
              return track;
            }
            updated = true;
            return {
              ...track,
              items: track.items.map((item) =>
                item.id === itemId ? { ...item, ...patch } : item
              ),
            };
          });

          if (!updated) {
            return state;
          }

          return {
            tracks: nextTracks,
            duration: calculateProjectDuration(nextTracks),
          };
        });
      },

      moveItem: (itemId, newStart, targetTrackId) => {
        const clampedStart = Math.max(0, newStart);

        set((state) => {
          const sourceTrack = state.tracks.find((t) =>
            t.items.some((i) => i.id === itemId)
          );
          if (!sourceTrack || sourceTrack.isLocked) {
            return state;
          }

          const destinationId = targetTrackId ?? sourceTrack.id;
          const destinationTrack = state.tracks.find(
            (t) => t.id === destinationId
          );
          if (!destinationTrack || destinationTrack.isLocked) {
            return state;
          }

          const itemToMove = sourceTrack.items.find((i) => i.id === itemId);
          if (!itemToMove) {
            return state;
          }

          if (
            destinationId !== sourceTrack.id &&
            !isItemCompatibleWithTrack(itemToMove.type, destinationTrack.type)
          ) {
            return state;
          }

          const destSiblings = destinationTrack.items.filter(
            (i) => i.id !== itemId
          );
          const resolvedStart = resolveNonOverlappingStart(
            destSiblings,
            clampedStart,
            itemToMove.duration
          );

          const movedItem: TimelineItem = {
            ...itemToMove,
            trackId: destinationId,
            start: resolvedStart,
          };

          const nextTracks = state.tracks.map((track) => {
            if (track.id === sourceTrack.id && track.id === destinationId) {
              return {
                ...track,
                items: track.items.map((i) =>
                  i.id === itemId ? movedItem : i
                ),
              };
            }
            if (track.id === sourceTrack.id) {
              return {
                ...track,
                items: track.items.filter((i) => i.id !== itemId),
              };
            }
            if (track.id === destinationId) {
              return {
                ...track,
                items: [...track.items, movedItem],
              };
            }
            return track;
          });

          return {
            tracks: nextTracks,
            duration: calculateProjectDuration(nextTracks),
          };
        });
      },

      trimItemLeft: (itemId, deltaSec) => {
        if (!Number.isFinite(deltaSec) || deltaSec === 0) {
          return;
        }

        set((state) => {
          let changed = false;
          const nextTracks = state.tracks.map((track) => {
            if (track.isLocked) {
              return track;
            }
            const itemIndex = track.items.findIndex((i) => i.id === itemId);
            if (itemIndex === -1) {
              return track;
            }

            const item = track.items[itemIndex];
            const prevEnd = track.items.reduce((maxEnd, sibling) => {
              if (sibling.id === item.id) {
                return maxEnd;
              }
              const siblingEnd = sibling.start + sibling.duration;
              if (siblingEnd <= item.start + TIME_EPSILON) {
                return Math.max(maxEnd, siblingEnd);
              }
              return maxEnd;
            }, 0);

            const minDelta = Math.max(
              prevEnd - item.start,
              -item.start,
              -item.trimStart
            );
            const maxDelta = item.duration - MIN_CLIP_DURATION;
            const clampedDelta = Math.min(Math.max(deltaSec, minDelta), maxDelta);

            if (clampedDelta === 0) {
              return track;
            }

            changed = true;
            const updatedItem: TimelineItem = {
              ...item,
              start: item.start + clampedDelta,
              duration: item.duration - clampedDelta,
              trimStart: item.trimStart + clampedDelta,
            };

            const nextItems = [...track.items];
            nextItems[itemIndex] = updatedItem;
            return { ...track, items: nextItems };
          });

          if (!changed) {
            return state;
          }

          return {
            tracks: nextTracks,
            duration: calculateProjectDuration(nextTracks),
          };
        });
      },

      trimItemLeftFromAnchor: (itemId, anchor, totalDeltaSec) => {
        if (!Number.isFinite(totalDeltaSec)) {
          return;
        }

        set((state) => {
          let changed = false;
          const nextTracks = state.tracks.map((track) => {
            if (track.isLocked) {
              return track;
            }
            const itemIndex = track.items.findIndex((i) => i.id === itemId);
            if (itemIndex === -1) {
              return track;
            }

            const item = track.items[itemIndex];
            const prevEnd = track.items.reduce((maxEnd, sibling) => {
              if (sibling.id === item.id) {
                return maxEnd;
              }
              const siblingEnd = sibling.start + sibling.duration;
              if (siblingEnd <= anchor.start + TIME_EPSILON) {
                return Math.max(maxEnd, siblingEnd);
              }
              return maxEnd;
            }, 0);

            const minDelta = Math.max(
              prevEnd - anchor.start,
              -anchor.start,
              -anchor.trimStart
            );
            const maxDelta = anchor.duration - MIN_CLIP_DURATION;
            const clampedDelta = Math.min(
              Math.max(totalDeltaSec, minDelta),
              maxDelta
            );

            const nextStart = anchor.start + clampedDelta;
            const nextDuration = anchor.duration - clampedDelta;
            const nextTrimStart = anchor.trimStart + clampedDelta;

            if (
              item.start === nextStart &&
              item.duration === nextDuration &&
              item.trimStart === nextTrimStart
            ) {
              return track;
            }

            changed = true;
            const nextItems = [...track.items];
            nextItems[itemIndex] = {
              ...item,
              start: nextStart,
              duration: nextDuration,
              trimStart: nextTrimStart,
            };
            return { ...track, items: nextItems };
          });

          if (!changed) {
            return state;
          }

          return {
            tracks: nextTracks,
            duration: calculateProjectDuration(nextTracks),
          };
        });
      },

      trimItemRight: (itemId, newDuration) => {
        if (!Number.isFinite(newDuration)) {
          return;
        }

        set((state) => {
          let changed = false;
          const nextTracks = state.tracks.map((track) => {
            if (track.isLocked) {
              return track;
            }
            const itemIndex = track.items.findIndex((i) => i.id === itemId);
            if (itemIndex === -1) {
              return track;
            }

            const item = track.items[itemIndex];
            const asset = item.assetId
              ? state.mediaAssets[item.assetId]
              : undefined;

            let mediaMaxDuration = Number.POSITIVE_INFINITY;
            if (
              asset &&
              (asset.type === "video" || asset.type === "audio") &&
              asset.duration > 0
            ) {
              mediaMaxDuration = Math.max(
                MIN_CLIP_DURATION,
                asset.duration - item.trimStart
              );
            }

            const nextStart = track.items.reduce((minStart, sibling) => {
              if (sibling.id === item.id) {
                return minStart;
              }
              if (sibling.start >= item.start + item.duration - TIME_EPSILON) {
                return Math.min(minStart, sibling.start);
              }
              return minStart;
            }, Number.POSITIVE_INFINITY);

            const gapMaxDuration = Number.isFinite(nextStart)
              ? Math.max(MIN_CLIP_DURATION, nextStart - item.start)
              : Number.POSITIVE_INFINITY;

            const maxDuration = Math.min(mediaMaxDuration, gapMaxDuration);

            const clampedDuration = Math.min(
              Math.max(MIN_CLIP_DURATION, newDuration),
              maxDuration
            );

            if (clampedDuration === item.duration) {
              return track;
            }

            changed = true;
            const nextItems = [...track.items];
            nextItems[itemIndex] = {
              ...item,
              duration: clampedDuration,
            };
            return { ...track, items: nextItems };
          });

          if (!changed) {
            return state;
          }

          return {
            tracks: nextTracks,
            duration: calculateProjectDuration(nextTracks),
          };
        });
      },

      splitItemAtPlayhead: (itemId) => {
        const state = get();
        const targetItemId = itemId ?? state.selectedItemId;
        if (!targetItemId) {
          return null;
        }

        const { currentTime } = state;
        const ownerTrack = state.tracks.find((track) =>
          track.items.some((item) => item.id === targetItemId)
        );
        if (!ownerTrack || ownerTrack.isLocked) {
          return null;
        }

        const targetItem = ownerTrack.items.find(
          (item) => item.id === targetItemId
        );
        if (!targetItem) {
          return null;
        }

        const itemEnd = targetItem.start + targetItem.duration;
        if (
          currentTime <= targetItem.start + MIN_CLIP_DURATION ||
          currentTime >= itemEnd - MIN_CLIP_DURATION
        ) {
          return null;
        }

        const splitOffset = currentTime - targetItem.start;

        const leftClip: TimelineItem = {
          ...targetItem,
          duration: splitOffset,
        };

        const rightClip: TimelineItem = {
          ...targetItem,
          id: uuidv4(),
          start: currentTime,
          duration: targetItem.duration - splitOffset,
          trimStart: targetItem.trimStart + splitOffset,
        };

        set((prev) => {
          const nextTracks = prev.tracks.map((track) => {
            if (track.id !== ownerTrack.id) {
              return track;
            }
            const nextItems: TimelineItem[] = [];
            for (const item of track.items) {
              if (item.id === targetItem.id) {
                nextItems.push(leftClip, rightClip);
              } else {
                nextItems.push(item);
              }
            }
            return { ...track, items: nextItems };
          });

          return {
            tracks: nextTracks,
            duration: calculateProjectDuration(nextTracks),
            selectedItemId: rightClip.id,
          };
        });

        return [leftClip, rightClip];
      },

      removeItem: (itemId) => {
        set((state) => {
          let removed = false;
          const nextTracks = state.tracks.map((track) => {
            if (track.isLocked) {
              return track;
            }
            const filtered = track.items.filter((item) => item.id !== itemId);
            if (filtered.length !== track.items.length) {
              removed = true;
              return { ...track, items: filtered };
            }
            return track;
          });

          if (!removed) {
            return state;
          }

          return {
            tracks: nextTracks,
            duration: calculateProjectDuration(nextTracks),
            selectedItemId:
              state.selectedItemId === itemId ? null : state.selectedItemId,
          };
        });
      },

      copySelectedItem: (itemId) => {
        const state = get();
        const targetId = itemId ?? state.selectedItemId;
        if (!targetId) {
          return null;
        }

        for (const track of state.tracks) {
          const found = track.items.find((item) => item.id === targetId);
          if (found) {
            const copied = cloneTimelineItem(found);
            set({ clipboardItem: copied });
            return copied;
          }
        }
        return null;
      },

      pasteClipboardItem: (options) => {
        const state = get();
        const clipboard = state.clipboardItem;
        if (!clipboard) {
          return null;
        }

        const candidateTrackIds = [
          options?.targetTrackId,
          state.selectedTrackId,
          clipboard.trackId,
        ].filter((id): id is string => Boolean(id));

        let destinationTrack: TimelineTrack | undefined;

        for (const candidateId of candidateTrackIds) {
          const found = state.tracks.find(
            (t) =>
              t.id === candidateId &&
              !t.isLocked &&
              isItemCompatibleWithTrack(clipboard.type, t.type)
          );
          if (found) {
            destinationTrack = found;
            break;
          }
        }

        if (!destinationTrack) {
          destinationTrack = state.tracks.find(
            (t) =>
              !t.isLocked && isItemCompatibleWithTrack(clipboard.type, t.type)
          );
        }

        if (!destinationTrack) {
          const defaultType = getDefaultTrackTypeForItem(clipboard.type);
          destinationTrack = state.addTrack(defaultType);
        }

        const { id: _oldId, trackId: _oldTrackId, ...rest } =
          cloneTimelineItem(clipboard);
        void _oldId;
        void _oldTrackId;

        const pasted = get().addItem(destinationTrack.id, {
          ...rest,
          start: options?.atTime ?? state.currentTime,
        });

        if (pasted) {
          set({
            selectedItemId: pasted.id,
            selectedTrackId: destinationTrack.id,
          });
        }
        return pasted;
      },

      duplicateSelectedItem: (itemId) => {
        const state = get();
        const targetId = itemId ?? state.selectedItemId;
        if (!targetId) {
          return null;
        }

        for (const track of state.tracks) {
          if (track.isLocked) {
            continue;
          }
          const found = track.items.find((item) => item.id === targetId);
          if (found) {
            const { id: _oldId, trackId: _oldTrackId, ...rest } =
              cloneTimelineItem(found);
            void _oldId;
            void _oldTrackId;

            const duplicated = get().addItem(track.id, {
              ...rest,
              start: found.start + found.duration,
            });
            if (duplicated) {
              set({
                selectedItemId: duplicated.id,
                selectedTrackId: track.id,
              });
            }
            return duplicated;
          }
        }
        return null;
      },

      setCurrentTime: (time) => {
        set({ currentTime: Math.max(0, time) });
      },

      setIsPlaying: (isPlaying) => {
        set({ isPlaying });
      },

      togglePlay: () => {
        set((state) => ({ isPlaying: !state.isPlaying }));
      },

      setPixelsPerSecond: (pps) => {
        const clamped = Math.min(
          Math.max(pps, MIN_PIXELS_PER_SECOND),
          MAX_PIXELS_PER_SECOND
        );
        set({ pixelsPerSecond: clamped });
      },

      selectItem: (itemId) => {
        set({ selectedItemId: itemId });
      },

      selectTrack: (trackId) => {
        set({ selectedTrackId: trackId });
      },

      setCanvasFps: (fps) => {
        if (!Number.isFinite(fps) || fps <= 0) {
          return;
        }
        set((state) => ({
          canvas: {
            ...state.canvas,
            fps: Math.round(fps),
          },
        }));
      },
    }),
    {
      partialize: (state) => ({ tracks: state.tracks }),
      limit: 50,
      equality: (pastState, currentState) =>
        pastState.tracks === currentState.tracks,
    }
  )
);

export const getTemporalStore = () => useTimelineStore.temporal;
