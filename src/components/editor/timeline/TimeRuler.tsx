"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTimelineStore } from "@/store/useTimelineStore";
import {
  formatTimecode,
  getRulerIntervals,
  pxToTime,
  timeToPx,
} from "@/core/timeline/timelineMath";

interface TimeRulerProps {
  totalDurationSec: number;
  pixelsPerSecond: number;
  totalWidthPx: number;
  laneRef: React.RefObject<HTMLDivElement | null>;
}

interface RulerTick {
  timeSec: number;
  leftPx: number;
  isMajor: boolean;
  label?: string;
}

export function TimeRuler({
  totalDurationSec,
  pixelsPerSecond,
  totalWidthPx,
  laneRef,
}: TimeRulerProps) {
  const setCurrentTime = useTimelineStore((s) => s.setCurrentTime);
  const setIsPlaying = useTimelineStore((s) => s.setIsPlaying);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  const ticks = useMemo<RulerTick[]>(() => {
    const { majorStepSec, minorDivisions } =
      getRulerIntervals(pixelsPerSecond);
    const minorStepSec = majorStepSec / minorDivisions;
    const maxSec = Math.max(
      totalDurationSec,
      pxToTime(totalWidthPx, pixelsPerSecond)
    );
    const totalMinorSteps = Math.ceil(maxSec / minorStepSec);
    const result: RulerTick[] = [];

    for (let i = 0; i <= totalMinorSteps; i += 1) {
      const timeSec = Number((i * minorStepSec).toFixed(4));
      const isMajor = i % minorDivisions === 0;
      result.push({
        timeSec,
        leftPx: timeToPx(timeSec, pixelsPerSecond),
        isMajor,
        label: isMajor ? formatTimecode(timeSec) : undefined,
      });
    }
    return result;
  }, [pixelsPerSecond, totalDurationSec, totalWidthPx]);

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
      onPointerDown={handlePointerDown}
      style={{ width: `${totalWidthPx}px` }}
      className="relative h-8 shrink-0 touch-none cursor-pointer select-none border-b border-zinc-800 bg-zinc-900/90"
      title="Click or drag to scrub playhead"
    >
      {ticks.map((tick, index) => (
        <div
          key={`${tick.timeSec}-${index}`}
          style={{ left: `${tick.leftPx}px` }}
          className="pointer-events-none absolute bottom-0 top-0"
        >
          {tick.isMajor ? (
            <>
              <div className="absolute bottom-0 h-3 w-px bg-zinc-400" />
              <span className="absolute left-1 top-1 whitespace-nowrap font-mono text-[10px] text-zinc-400">
                {tick.label}
              </span>
            </>
          ) : (
            <div className="absolute bottom-0 h-1.5 w-px bg-zinc-700" />
          )}
        </div>
      ))}
    </div>
  );
}
