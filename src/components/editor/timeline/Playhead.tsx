"use client";

import { useEffect, useRef } from "react";
import { useTimelineStore } from "@/store/useTimelineStore";
import { pxToTime, timeToPx } from "@/core/timeline/timelineMath";

interface PlayheadProps {
  pixelsPerSecond: number;
  totalWidthPx: number;
  laneRef: React.RefObject<HTMLDivElement | null>;
}

export function Playhead({
  pixelsPerSecond,
  totalWidthPx,
  laneRef,
}: PlayheadProps) {
  const currentTime = useTimelineStore((s) => s.currentTime);
  const setCurrentTime = useTimelineStore((s) => s.setCurrentTime);
  const setIsPlaying = useTimelineStore((s) => s.setIsPlaying);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  const leftPx = Math.min(
    totalWidthPx,
    Math.max(0, timeToPx(currentTime, pixelsPerSecond))
  );

  const seekFromClientX = (clientX: number): void => {
    const laneEl = laneRef.current;
    if (!laneEl) {
      return;
    }
    const rect = laneEl.getBoundingClientRect();
    const pointerX = Math.max(0, clientX - rect.left);
    setCurrentTime(pxToTime(pointerX, pixelsPerSecond));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    cleanupRef.current?.();

    setIsPlaying(false);
    seekFromClientX(e.clientX);

    const onPointerMove = (moveEvent: PointerEvent): void => {
      seekFromClientX(moveEvent.clientX);
    };

    const onPointerUp = (): void => {
      cleanup();
    };

    const cleanup = (): void => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      cleanupRef.current = null;
    };

    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  return (
    <div
      style={{ left: `${leftPx}px` }}
      className="pointer-events-none absolute bottom-0 top-0 z-30 w-0"
    >
      {/* Playhead top handle */}
      <div
        onPointerDown={handlePointerDown}
        className="pointer-events-auto -ml-3 flex h-6 w-6 touch-none cursor-ew-resize items-start justify-center"
        title="Drag playhead"
      >
        <div className="h-3.5 w-3 rounded-t-sm bg-rose-500 shadow-sm ring-1 ring-rose-300/60" />
      </div>

      {/* Playhead vertical line */}
      <div className="absolute bottom-0 top-3.5 -ml-[1px] w-[2px] bg-rose-500/90 shadow-[0_0_6px_rgba(244,63,94,0.6)]" />
    </div>
  );
}
