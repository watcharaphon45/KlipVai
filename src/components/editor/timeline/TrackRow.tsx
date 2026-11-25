"use client";

import {
  Eye,
  EyeOff,
  Film,
  GripVertical,
  Layers,
  Lock,
  Music,
  Trash2,
  Type,
  Unlock,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useTimelineStore } from "@/store/useTimelineStore";
import { TimelineClip } from "@/components/editor/timeline/TimelineClip";
import type { TimelineItem, TimelineTrack } from "@/types/timeline";

interface TrackRowProps {
  track: TimelineTrack;
  pixelsPerSecond: number;
  totalWidthPx: number;
  rowRef?: (el: HTMLDivElement | null) => void;
  isDragging?: boolean;
  isDropTarget?: boolean;
  isClipDropTarget?: boolean;
  onGripPointerDown?: (
    trackId: string,
    e: React.PointerEvent<HTMLButtonElement>
  ) => void;
  onClipMoveStart?: (
    item: TimelineItem,
    e: React.PointerEvent<HTMLDivElement>
  ) => void;
}

function TrackIcon({ type }: { type: TimelineTrack["type"] }) {
  switch (type) {
    case "video":
      return <Film className="h-3.5 w-3.5 text-indigo-400" />;
    case "overlay":
      return <Layers className="h-3.5 w-3.5 text-amber-400" />;
    case "text":
      return <Type className="h-3.5 w-3.5 text-violet-400" />;
    case "audio":
      return <Music className="h-3.5 w-3.5 text-emerald-400" />;
  }
}

export function TrackRow({
  track,
  pixelsPerSecond,
  totalWidthPx,
  rowRef,
  isDragging = false,
  isDropTarget = false,
  isClipDropTarget = false,
  onGripPointerDown,
  onClipMoveStart,
}: TrackRowProps) {
  const selectedTrackId = useTimelineStore((s) => s.selectedTrackId);
  const selectTrack = useTimelineStore((s) => s.selectTrack);
  const selectItem = useTimelineStore((s) => s.selectItem);
  const toggleTrackMute = useTimelineStore((s) => s.toggleTrackMute);
  const toggleTrackHide = useTimelineStore((s) => s.toggleTrackHide);
  const toggleTrackLock = useTimelineStore((s) => s.toggleTrackLock);
  const removeTrack = useTimelineStore((s) => s.removeTrack);

  const isSelected = selectedTrackId === track.id;

  return (
    <div
      ref={rowRef}
      className={`flex h-14 border-b border-zinc-800/90 transition-colors ${
        isDragging ? "opacity-60" : ""
      } ${
        isDropTarget ? "bg-indigo-950/25 ring-2 ring-inset ring-indigo-500/80" : ""
      }`}
    >
      {/* Sticky left track header */}
      <div
        onClick={() => selectTrack(track.id)}
        className={`sticky left-0 z-20 flex w-[124px] shrink-0 flex-col justify-center gap-0.5 border-r border-zinc-800 px-1.5 py-1 transition-colors md:w-52 md:flex-row md:items-center md:justify-between md:px-2 md:py-0 ${
          isSelected ? "bg-zinc-800/95" : "bg-zinc-900/95"
        }`}
      >
        <div className="flex min-w-0 items-center gap-1 md:gap-1.5">
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              onGripPointerDown?.(track.id, e);
            }}
            onClick={(e) => e.stopPropagation()}
            className="touch-none shrink-0 cursor-grab rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 active:cursor-grabbing"
            title="Drag to reorder track layer"
            aria-label={`Reorder ${track.name}`}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <TrackIcon type={track.type} />
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium text-zinc-200 md:text-xs">
              {track.name}
            </p>
            <p className="hidden text-[10px] text-zinc-500 md:block">
              z:{track.zIndex}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleTrackMute(track.id);
            }}
            className={`rounded p-1 transition-colors ${
              track.isMuted
                ? "bg-rose-500/20 text-rose-400"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
            title={track.isMuted ? "Unmute track" : "Mute track"}
          >
            {track.isMuted ? (
              <VolumeX className="h-3.5 w-3.5" />
            ) : (
              <Volume2 className="h-3.5 w-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleTrackHide(track.id);
            }}
            className={`rounded p-1 transition-colors ${
              track.isHidden
                ? "bg-amber-500/20 text-amber-400"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
            title={track.isHidden ? "Show track" : "Hide track"}
          >
            {track.isHidden ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleTrackLock(track.id);
            }}
            className={`rounded p-1 transition-colors ${
              track.isLocked
                ? "bg-sky-500/20 text-sky-400"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
            title={track.isLocked ? "Unlock track" : "Lock track"}
          >
            {track.isLocked ? (
              <Lock className="h-3.5 w-3.5" />
            ) : (
              <Unlock className="h-3.5 w-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeTrack(track.id);
            }}
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-rose-500/20 hover:text-rose-400"
            title="Remove track"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Track lane */}
      <div
        onClick={() => {
          selectTrack(track.id);
          selectItem(null);
        }}
        style={{ width: `${totalWidthPx}px` }}
        className={`relative shrink-0 transition-colors ${
          isClipDropTarget
            ? "bg-emerald-950/25 ring-1 ring-inset ring-emerald-500/50"
            : "bg-zinc-950/60"
        } ${track.isHidden ? "opacity-45" : "opacity-100"} ${
          track.isLocked
            ? "bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[length:24px_100%]"
            : ""
        }`}
      >
        {track.items.map((item) => (
          <TimelineClip
            key={item.id}
            item={item}
            trackLocked={track.isLocked}
            pixelsPerSecond={pixelsPerSecond}
            onMoveStart={onClipMoveStart}
          />
        ))}
      </div>
    </div>
  );
}
