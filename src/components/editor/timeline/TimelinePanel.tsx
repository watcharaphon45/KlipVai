"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import {
  Pause,
  Play,
  Plus,
  Redo2,
  Scissors,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  MAX_PIXELS_PER_SECOND,
  MIN_PIXELS_PER_SECOND,
  useTimelineStore,
} from "@/store/useTimelineStore";
import {
  formatTimecode,
  isItemCompatibleWithTrack,
  pxToTime,
  snapClipStart,
  timeToPx,
} from "@/core/timeline/timelineMath";
import { RelinkBanner } from "@/components/editor/timeline/RelinkBanner";
import { TimeRuler } from "@/components/editor/timeline/TimeRuler";
import { TrackRow } from "@/components/editor/timeline/TrackRow";
import { Playhead } from "@/components/editor/timeline/Playhead";
import type { TimelineItem } from "@/types/timeline";

const MIN_TIMELINE_SECONDS = 30;

export function TimelinePanel() {
  const tracks = useTimelineStore((s) => s.tracks);
  const currentTime = useTimelineStore((s) => s.currentTime);
  const duration = useTimelineStore((s) => s.duration);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const pixelsPerSecond = useTimelineStore((s) => s.pixelsPerSecond);
  const selectedItemId = useTimelineStore((s) => s.selectedItemId);

  const togglePlay = useTimelineStore((s) => s.togglePlay);
  const setIsPlaying = useTimelineStore((s) => s.setIsPlaying);
  const setCurrentTime = useTimelineStore((s) => s.setCurrentTime);
  const setPixelsPerSecond = useTimelineStore((s) => s.setPixelsPerSecond);
  const splitItemAtPlayhead = useTimelineStore((s) => s.splitItemAtPlayhead);
  const removeItem = useTimelineStore((s) => s.removeItem);
  const addTrack = useTimelineStore((s) => s.addTrack);
  const reorderTracks = useTimelineStore((s) => s.reorderTracks);
  const addItem = useTimelineStore((s) => s.addItem);
  const moveItem = useTimelineStore((s) => s.moveItem);
  const selectItem = useTimelineStore((s) => s.selectItem);

  const pastCount = useStore(
    useTimelineStore.temporal,
    (s) => s.pastStates.length
  );
  const futureCount = useStore(
    useTimelineStore.temporal,
    (s) => s.futureStates.length
  );
  const undo = useStore(useTimelineStore.temporal, (s) => s.undo);
  const redo = useStore(useTimelineStore.temporal, (s) => s.redo);

  const laneRef = useRef<HTMLDivElement | null>(null);
  const trackRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const clipMoveCleanupRef = useRef<(() => void) | null>(null);

  const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null);
  const [dropTargetTrackId, setDropTargetTrackId] = useState<string | null>(
    null
  );
  const [clipTargetTrackId, setClipTargetTrackId] = useState<string | null>(
    null
  );

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
      clipMoveCleanupRef.current?.();
      clipMoveCleanupRef.current = null;
    };
  }, []);

  const sortedTracks = useMemo(
    () => [...tracks].sort((a, b) => b.zIndex - a.zIndex),
    [tracks]
  );

  const handleStartTrackDrag = (
    trackId: string,
    e: React.PointerEvent<HTMLButtonElement>
  ): void => {
    if (e.button !== 0 || sortedTracks.length <= 1) {
      return;
    }
    e.preventDefault();
    dragCleanupRef.current?.();

    setDraggingTrackId(trackId);
    setDropTargetTrackId(trackId);
    let latestTargetId = trackId;

    const resolveTargetTrackId = (clientY: number): string => {
      const firstId = sortedTracks[0]?.id ?? trackId;
      const lastId = sortedTracks[sortedTracks.length - 1]?.id ?? trackId;

      const firstRect = trackRowRefs.current
        .get(firstId)
        ?.getBoundingClientRect();
      if (firstRect && clientY < firstRect.top) {
        return firstId;
      }

      const lastRect = trackRowRefs.current
        .get(lastId)
        ?.getBoundingClientRect();
      if (lastRect && clientY > lastRect.bottom) {
        return lastId;
      }

      for (const t of sortedTracks) {
        const rect = trackRowRefs.current.get(t.id)?.getBoundingClientRect();
        if (rect && clientY >= rect.top && clientY <= rect.bottom) {
          return t.id;
        }
      }
      return latestTargetId;
    };

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const nextTargetId = resolveTargetTrackId(moveEvent.clientY);
      if (nextTargetId !== latestTargetId) {
        latestTargetId = nextTargetId;
        setDropTargetTrackId(nextTargetId);
      }
    };

    const cleanup = (): void => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      dragCleanupRef.current = null;
    };

    const onPointerUp = (): void => {
      cleanup();
      setDraggingTrackId(null);
      setDropTargetTrackId(null);

      if (latestTargetId && latestTargetId !== trackId) {
        const visualIds = sortedTracks.map((t) => t.id);
        const fromIdx = visualIds.indexOf(trackId);
        const toIdx = visualIds.indexOf(latestTargetId);
        if (fromIdx !== -1 && toIdx !== -1) {
          const nextVisualIds = [...visualIds];
          const [moved] = nextVisualIds.splice(fromIdx, 1);
          nextVisualIds.splice(toIdx, 0, moved);
          // Reverse visual top-to-bottom order into bottom-to-top zIndex order (0..N-1)
          reorderTracks([...nextVisualIds].reverse());
        }
      }
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const handleStartClipMove = (
    item: TimelineItem,
    e: React.PointerEvent<HTMLDivElement>
  ): void => {
    if (e.button !== 0) {
      return;
    }
    e.stopPropagation();
    selectItem(item.id);

    const ownerTrack = useTimelineStore
      .getState()
      .tracks.find((t) => t.id === item.trackId);
    if (!ownerTrack || ownerTrack.isLocked) {
      return;
    }

    e.preventDefault();
    clipMoveCleanupRef.current?.();

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const initialStart = item.start;
    let currentTrackId = item.trackId;
    let hasMoved = false;
    let pausedTemporal = false;

    const findHoveredTrackId = (clientY: number): string | null => {
      for (const track of sortedTracks) {
        const rect = trackRowRefs.current.get(track.id)?.getBoundingClientRect();
        if (rect && clientY >= rect.top && clientY <= rect.bottom) {
          return track.id;
        }
      }
      return null;
    };

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const deltaX = moveEvent.clientX - startClientX;
      const deltaY = moveEvent.clientY - startClientY;
      if (!hasMoved && Math.abs(deltaX) < 1 && Math.abs(deltaY) < 4) {
        return;
      }

      const state = useTimelineStore.getState();
      const hoveredId = findHoveredTrackId(moveEvent.clientY);
      let targetTrackId = currentTrackId;

      if (hoveredId) {
        const hoveredTrack = state.tracks.find((t) => t.id === hoveredId);
        if (
          hoveredTrack &&
          !hoveredTrack.isLocked &&
          isItemCompatibleWithTrack(item.type, hoveredTrack.type)
        ) {
          targetTrackId = hoveredTrack.id;
        }
      }

      setClipTargetTrackId(
        targetTrackId !== item.trackId ? targetTrackId : null
      );

      const targetTrack = state.tracks.find((t) => t.id === targetTrackId);
      const targetSiblings = targetTrack
        ? targetTrack.items.filter((i) => i.id !== item.id)
        : [];

      const rawStart = Math.max(
        0,
        initialStart + pxToTime(deltaX, pixelsPerSecond)
      );
      const snappedStart = snapClipStart(
        rawStart,
        item.duration,
        state.currentTime,
        targetSiblings
      );

      moveItem(item.id, snappedStart, targetTrackId);
      currentTrackId = targetTrackId;

      if (!hasMoved) {
        hasMoved = true;
        useTimelineStore.temporal.getState().pause();
        pausedTemporal = true;
      }
    };

    const cleanup = (): void => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      setClipTargetTrackId(null);
      if (pausedTemporal) {
        useTimelineStore.temporal.getState().resume();
        pausedTemporal = false;
      }
      clipMoveCleanupRef.current = null;
    };

    const onPointerUp = (): void => {
      cleanup();
    };

    clipMoveCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const totalDurationSec = Math.max(MIN_TIMELINE_SECONDS, duration + 10);
  const totalWidthPx = Math.max(
    900,
    Math.ceil(timeToPx(totalDurationSec, pixelsPerSecond))
  );

  // Playback timer loop
  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    let rafId = 0;
    let lastTimestamp = performance.now();

    const tick = (now: number): void => {
      const dt = (now - lastTimestamp) / 1000;
      lastTimestamp = now;

      const state = useTimelineStore.getState();
      if (!state.isPlaying) {
        return;
      }

      if (state.duration <= 0) {
        state.setIsPlaying(false);
        return;
      }

      const nextTime = state.currentTime + dt;
      if (nextTime >= state.duration) {
        state.setCurrentTime(state.duration);
        state.setIsPlaying(false);
        return;
      }

      state.setCurrentTime(nextTime);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying]);

  // Global keyboard shortcuts for timeline
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          useTimelineStore.temporal.getState().redo();
        } else {
          useTimelineStore.temporal.getState().undo();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        useTimelineStore.temporal.getState().redo();
        return;
      }

      if (e.key.toLowerCase() === "s" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        splitItemAtPlayhead();
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        const currentSelected = useTimelineStore.getState().selectedItemId;
        if (currentSelected) {
          e.preventDefault();
          removeItem(currentSelected);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [removeItem, splitItemAtPlayhead, togglePlay]);

  const handleAddSampleTextClip = (): void => {
    let textTrack = tracks.find((t) => t.type === "text" && !t.isLocked);
    if (!textTrack) {
      textTrack = addTrack("text", "Text Layer");
    }

    const created = addItem(textTrack.id, {
      type: "text",
      name: "Text Overlay",
      start: currentTime,
      duration: 3,
      trimStart: 0,
      volume: 1,
      x: 540,
      y: 960,
      scale: 1,
      rotation: 0,
      opacity: 1,
      text: "สวัสดี KlipVai",
      textStyle: {
        fontFamily: "Kanit",
        fontSize: 64,
        fill: "#ffffff",
        stroke: "#000000",
        strokeWidth: 4,
        align: "center",
        fontWeight: "bold",
      },
    });

    if (created) {
      selectItem(created.id);
    }
  };

  return (
    <section className="flex h-[42dvh] min-h-[220px] max-h-[320px] shrink-0 flex-col border-t border-zinc-800 bg-zinc-950 lg:h-80 lg:max-h-none">
      <RelinkBanner />

      {/* Timeline toolbar */}
      <div className="no-scrollbar flex items-center justify-between gap-2 overflow-x-auto whitespace-nowrap border-b border-zinc-800 bg-zinc-900/90 px-2.5 py-1.5 sm:px-3">
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={togglePlay}
            className="inline-flex h-7 w-7 items-center justify-center rounded bg-zinc-800 text-zinc-100 transition-colors hover:bg-zinc-700"
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setIsPlaying(false);
              setCurrentTime(0);
            }}
            className="rounded px-2 py-1 font-mono text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
            title="Click to jump to 00:00.00"
          >
            {formatTimecode(currentTime)}{" "}
            <span className="text-zinc-500">/ {formatTimecode(duration)}</span>
          </button>

          <div className="mx-1 h-4 w-px bg-zinc-700" />

          <button
            type="button"
            onClick={() => splitItemAtPlayhead()}
            disabled={!selectedItemId}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
            title="Split selected clip at playhead (S)"
          >
            <Scissors className="h-3.5 w-3.5" />
            Split
          </button>

          <button
            type="button"
            onClick={() => {
              if (selectedItemId) {
                removeItem(selectedItemId);
              }
            }}
            disabled={!selectedItemId}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-rose-300 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            title="Delete selected clip (Delete)"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>

          <div className="mx-1 h-4 w-px bg-zinc-700" />

          <button
            type="button"
            onClick={() => undo()}
            disabled={pastCount === 0}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-300 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => redo()}
            disabled={futureCount === 0}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-300 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Add tracks & zoom */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => addTrack("video")}
            className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            <Plus className="h-3 w-3" /> Video
          </button>
          <button
            type="button"
            onClick={() => addTrack("overlay")}
            className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            <Plus className="h-3 w-3" /> Overlay
          </button>
          <button
            type="button"
            onClick={() => addTrack("audio")}
            className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            <Plus className="h-3 w-3" /> Audio
          </button>
          <button
            type="button"
            onClick={handleAddSampleTextClip}
            className="inline-flex items-center gap-1 rounded border border-violet-500/40 bg-violet-500/15 px-2 py-1 text-[11px] text-violet-200 hover:bg-violet-500/25"
          >
            <Type className="h-3 w-3" /> + Text Clip
          </button>

          <div className="mx-1 h-4 w-px bg-zinc-700" />

          <button
            type="button"
            onClick={() => setPixelsPerSecond(pixelsPerSecond - 15)}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>

          <input
            type="range"
            min={MIN_PIXELS_PER_SECOND}
            max={MAX_PIXELS_PER_SECOND}
            value={pixelsPerSecond}
            onChange={(e) => setPixelsPerSecond(Number(e.target.value))}
            className="h-1 w-20 accent-indigo-500"
            aria-label="Timeline zoom"
          />

          <button
            type="button"
            onClick={() => setPixelsPerSecond(pixelsPerSecond + 15)}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            title="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable multi-track container */}
      <div className="relative flex-1 overflow-auto">
        <div className="relative min-h-full w-max">
          {/* Ruler row */}
          <div className="sticky top-0 z-20 flex bg-zinc-900">
            <div className="sticky left-0 z-30 flex h-8 w-[124px] shrink-0 items-center border-b border-r border-zinc-800 bg-zinc-900 px-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 md:w-52 md:px-3">
              Tracks ({tracks.length})
            </div>
            <div ref={laneRef} className="relative shrink-0">
              <TimeRuler
                totalDurationSec={totalDurationSec}
                pixelsPerSecond={pixelsPerSecond}
                totalWidthPx={totalWidthPx}
                laneRef={laneRef}
              />
            </div>
          </div>

          {/* Playhead spanning ruler + tracks */}
          <div
            style={{ width: `${totalWidthPx}px` }}
            className="pointer-events-none absolute bottom-0 left-[124px] top-0 z-30 md:left-52"
          >
            <Playhead
              pixelsPerSecond={pixelsPerSecond}
              totalWidthPx={totalWidthPx}
              laneRef={laneRef}
            />
          </div>

          {/* Track rows */}
          {sortedTracks.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-zinc-500">
              No tracks yet. Import a media file or click &ldquo;+ Video&rdquo; /
              &ldquo;+ Text Clip&rdquo; above.
            </div>
          ) : (
            sortedTracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                pixelsPerSecond={pixelsPerSecond}
                totalWidthPx={totalWidthPx}
                rowRef={(el) => {
                  if (el) {
                    trackRowRefs.current.set(track.id, el);
                  } else {
                    trackRowRefs.current.delete(track.id);
                  }
                }}
                isDragging={draggingTrackId === track.id}
                isDropTarget={
                  draggingTrackId !== null &&
                  draggingTrackId !== track.id &&
                  dropTargetTrackId === track.id
                }
                isClipDropTarget={clipTargetTrackId === track.id}
                onGripPointerDown={handleStartTrackDrag}
                onClipMoveStart={handleStartClipMove}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}
