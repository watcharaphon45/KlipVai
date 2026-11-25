"use client";

import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  Film,
  Image as ImageIcon,
  Music,
  Type,
} from "lucide-react";
import { useTimelineStore } from "@/store/useTimelineStore";
import {
  pxToTime,
  snapToPlayhead,
  timeToPx,
} from "@/core/timeline/timelineMath";
import type { TimelineItem } from "@/types/timeline";

interface TimelineClipProps {
  item: TimelineItem;
  trackLocked: boolean;
  pixelsPerSecond: number;
  onMoveStart?: (
    item: TimelineItem,
    e: React.PointerEvent<HTMLDivElement>
  ) => void;
}

function getClipColors(type: TimelineItem["type"]): string {
  switch (type) {
    case "video":
      return "bg-indigo-600/85 border-indigo-400/70 hover:bg-indigo-600";
    case "audio":
      return "bg-emerald-600/85 border-emerald-400/70 hover:bg-emerald-600";
    case "image":
      return "bg-amber-600/85 border-amber-400/70 hover:bg-amber-600";
    case "text":
      return "bg-violet-600/85 border-violet-400/70 hover:bg-violet-600";
  }
}

function ClipTypeIcon({ type }: { type: TimelineItem["type"] }) {
  switch (type) {
    case "video":
      return <Film className="h-3.5 w-3.5 shrink-0" />;
    case "audio":
      return <Music className="h-3.5 w-3.5 shrink-0" />;
    case "image":
      return <ImageIcon className="h-3.5 w-3.5 shrink-0" />;
    case "text":
      return <Type className="h-3.5 w-3.5 shrink-0" />;
  }
}

export function TimelineClip({
  item,
  trackLocked,
  pixelsPerSecond,
  onMoveStart,
}: TimelineClipProps) {
  const mediaAssets = useTimelineStore((s) => s.mediaAssets);
  const selectedItemId = useTimelineStore((s) => s.selectedItemId);
  const selectItem = useTimelineStore((s) => s.selectItem);
  const moveItem = useTimelineStore((s) => s.moveItem);
  const trimItemLeftFromAnchor = useTimelineStore(
    (s) => s.trimItemLeftFromAnchor
  );
  const trimItemRight = useTimelineStore((s) => s.trimItemRight);

  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  const asset = item.assetId ? mediaAssets[item.assetId] : undefined;
  const isMissing = asset?.status === "MISSING";
  const isSelected = selectedItemId === item.id;

  const leftPx = timeToPx(item.start, pixelsPerSecond);
  const widthPx = Math.max(8, timeToPx(item.duration, pixelsPerSecond));
  const label = item.type === "text" ? item.text || item.name : item.name;

  const startGesture = (
    e: React.PointerEvent<HTMLDivElement>,
    mode: "move" | "trim-left" | "trim-right"
  ): void => {
    if (e.button !== 0) {
      return;
    }
    e.stopPropagation();
    selectItem(item.id);

    if (trackLocked) {
      return;
    }

    e.preventDefault();
    cleanupRef.current?.();

    const startClientX = e.clientX;
    const initialStart = item.start;
    const initialDuration = item.duration;
    const initialTrimStart = item.trimStart;
    let hasMoved = false;
    let pausedTemporal = false;

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const deltaX = moveEvent.clientX - startClientX;
      if (!hasMoved && Math.abs(deltaX) < 1) {
        return;
      }

      const deltaSec = pxToTime(deltaX, pixelsPerSecond);

      if (mode === "move") {
        const rawStart = Math.max(0, initialStart + deltaSec);
        const playheadTime = useTimelineStore.getState().currentTime;
        const snappedStart = snapToPlayhead(rawStart, playheadTime);
        moveItem(item.id, snappedStart);
      } else if (mode === "trim-left") {
        trimItemLeftFromAnchor(
          item.id,
          {
            start: initialStart,
            duration: initialDuration,
            trimStart: initialTrimStart,
          },
          deltaSec
        );
      } else {
        trimItemRight(item.id, initialDuration + deltaSec);
      }

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
      if (pausedTemporal) {
        useTimelineStore.temporal.getState().resume();
        pausedTemporal = false;
      }
      cleanupRef.current = null;
    };

    const onPointerUp = (): void => {
      cleanup();
    };

    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  return (
    <div
      onPointerDown={(e) => {
        if (onMoveStart) {
          onMoveStart(item, e);
          return;
        }
        startGesture(e, "move");
      }}
      style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
      className={`group absolute bottom-1 top-1 flex touch-none select-none items-center overflow-hidden rounded-md border text-xs text-white transition-shadow ${
        isMissing
          ? "missing-clip-pattern border-red-500"
          : getClipColors(item.type)
      } ${trackLocked ? "cursor-not-allowed opacity-80" : "cursor-grab active:cursor-grabbing"} ${
        isSelected ? "z-10 ring-2 ring-white shadow-md" : ""
      }`}
      title={`${label} (${item.duration.toFixed(2)}s)`}
    >
      {/* Left trim handle */}
      {!trackLocked && (
        <div
          onPointerDown={(e) => startGesture(e, "trim-left")}
          className="absolute bottom-0 left-0 top-0 z-10 w-3.5 touch-none cursor-ew-resize bg-white/0 transition-colors hover:bg-white/35 sm:w-2"
          title="Trim left edge"
        />
      )}

      {/* Clip content */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5">
        {isMissing ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-200" />
        ) : (
          <ClipTypeIcon type={item.type} />
        )}
        <span className="truncate font-medium">{label}</span>

        {isMissing && widthPx > 85 && (
          <span className="ml-auto shrink-0 rounded bg-red-950/90 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-red-200">
            MISSING
          </span>
        )}
        {!isMissing && widthPx > 110 && (
          <span className="ml-auto shrink-0 font-mono text-[10px] text-white/80">
            {item.duration.toFixed(1)}s
          </span>
        )}
      </div>

      {/* Right trim handle */}
      {!trackLocked && (
        <div
          onPointerDown={(e) => startGesture(e, "trim-right")}
          className="absolute bottom-0 right-0 top-0 z-10 w-3.5 touch-none cursor-ew-resize bg-white/0 transition-colors hover:bg-white/35 sm:w-2"
          title="Trim right edge"
        />
      )}
    </div>
  );
}
