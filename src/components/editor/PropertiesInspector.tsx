"use client";

import { RotateCcw, Sliders, X } from "lucide-react";
import { useTimelineStore } from "@/store/useTimelineStore";

interface PropertiesInspectorProps {
  className?: string;
  onClose?: () => void;
}

export function PropertiesInspector({
  className = "",
  onClose,
}: PropertiesInspectorProps) {
  const tracks = useTimelineStore((s) => s.tracks);
  const selectedItemId = useTimelineStore((s) => s.selectedItemId);
  const updateItem = useTimelineStore((s) => s.updateItem);

  let selectedEntry: {
    item: (typeof tracks)[number]["items"][number];
    isLocked: boolean;
  } | null = null;

  if (selectedItemId) {
    for (const track of tracks) {
      const found = track.items.find((item) => item.id === selectedItemId);
      if (found) {
        selectedEntry = { item: found, isLocked: track.isLocked };
        break;
      }
    }
  }

  return (
    <aside
      className={`flex w-full flex-col bg-zinc-900/95 lg:w-64 lg:shrink-0 lg:border-l lg:border-zinc-800 lg:bg-zinc-900/50 ${className}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <Sliders className="h-3.5 w-3.5 text-zinc-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Inspector
          </h2>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close inspector"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {!selectedEntry ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-zinc-500">
          Select a clip on the timeline or canvas to edit its properties.
        </div>
      ) : (
        <div className="flex-1 space-y-4 overflow-y-auto p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium text-zinc-100">
              {selectedEntry.item.name}
            </span>
            <button
              type="button"
              disabled={selectedEntry.isLocked}
              onClick={() =>
                updateItem(selectedEntry.item.id, {
                  x: 540,
                  y: 960,
                  scale: 1,
                  rotation: 0,
                  opacity: 1,
                })
              }
              className="inline-flex items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              title="Reset transform"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>

          {selectedEntry.isLocked && (
            <div className="rounded border border-sky-500/40 bg-sky-950/40 px-2 py-1 text-[11px] text-sky-300">
              Track is locked. Unlock to edit.
            </div>
          )}

          {/* Position */}
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[11px] text-zinc-400">Pos X</span>
              <input
                type="number"
                disabled={selectedEntry.isLocked}
                value={Math.round(selectedEntry.item.x)}
                onChange={(e) =>
                  updateItem(selectedEntry.item.id, {
                    x: Number(e.target.value) || 0,
                  })
                }
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100 disabled:opacity-40"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[11px] text-zinc-400">Pos Y</span>
              <input
                type="number"
                disabled={selectedEntry.isLocked}
                value={Math.round(selectedEntry.item.y)}
                onChange={(e) =>
                  updateItem(selectedEntry.item.id, {
                    y: Number(e.target.value) || 0,
                  })
                }
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100 disabled:opacity-40"
              />
            </label>
          </div>

          {/* Scale & Rotation */}
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[11px] text-zinc-400">Scale</span>
              <input
                type="number"
                step={0.05}
                min={0.05}
                max={5}
                disabled={selectedEntry.isLocked}
                value={selectedEntry.item.scale}
                onChange={(e) =>
                  updateItem(selectedEntry.item.id, {
                    scale: Math.max(0.05, Number(e.target.value) || 1),
                  })
                }
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100 disabled:opacity-40"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[11px] text-zinc-400">Rotation (°)</span>
              <input
                type="number"
                step={1}
                disabled={selectedEntry.isLocked}
                value={selectedEntry.item.rotation}
                onChange={(e) =>
                  updateItem(selectedEntry.item.id, {
                    rotation: Number(e.target.value) || 0,
                  })
                }
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100 disabled:opacity-40"
              />
            </label>
          </div>

          {/* Opacity */}
          <label className="block space-y-1">
            <div className="flex justify-between text-[11px] text-zinc-400">
              <span>Opacity</span>
              <span>{Math.round(selectedEntry.item.opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              disabled={selectedEntry.isLocked}
              value={selectedEntry.item.opacity}
              onChange={(e) =>
                updateItem(selectedEntry.item.id, {
                  opacity: Number(e.target.value),
                })
              }
              className="w-full accent-indigo-500 disabled:opacity-40"
            />
          </label>

          {/* Volume for video/audio */}
          {(selectedEntry.item.type === "video" ||
            selectedEntry.item.type === "audio") && (
            <label className="block space-y-1">
              <div className="flex justify-between text-[11px] text-zinc-400">
                <span>Volume</span>
                <span>{Math.round(selectedEntry.item.volume * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                disabled={selectedEntry.isLocked}
                value={selectedEntry.item.volume}
                onChange={(e) =>
                  updateItem(selectedEntry.item.id, {
                    volume: Number(e.target.value),
                  })
                }
                className="w-full accent-emerald-500 disabled:opacity-40"
              />
            </label>
          )}

          {/* Text properties */}
          {selectedEntry.item.type === "text" && (
            <div className="space-y-3 border-t border-zinc-800 pt-3">
              <label className="block space-y-1">
                <span className="text-[11px] text-zinc-400">Text Content</span>
                <textarea
                  rows={2}
                  disabled={selectedEntry.isLocked}
                  value={selectedEntry.item.text ?? ""}
                  onChange={(e) =>
                    updateItem(selectedEntry.item.id, {
                      text: e.target.value,
                    })
                  }
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100 disabled:opacity-40"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] text-zinc-400">Font Size</span>
                <input
                  type="number"
                  min={12}
                  max={240}
                  disabled={selectedEntry.isLocked}
                  value={selectedEntry.item.textStyle?.fontSize ?? 64}
                  onChange={(e) => {
                    const currentStyle = selectedEntry.item.textStyle ?? {
                      fontFamily: "Kanit",
                      fontSize: 64,
                      fill: "#ffffff",
                    };
                    updateItem(selectedEntry.item.id, {
                      textStyle: {
                        ...currentStyle,
                        fontSize: Math.max(12, Number(e.target.value) || 64),
                      },
                    });
                  }}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100 disabled:opacity-40"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400">Fill Color</span>
                  <input
                    type="color"
                    disabled={selectedEntry.isLocked}
                    value={selectedEntry.item.textStyle?.fill ?? "#ffffff"}
                    onChange={(e) => {
                      const currentStyle = selectedEntry.item.textStyle ?? {
                        fontFamily: "Kanit",
                        fontSize: 64,
                        fill: "#ffffff",
                      };
                      updateItem(selectedEntry.item.id, {
                        textStyle: {
                          ...currentStyle,
                          fill: e.target.value,
                        },
                      });
                    }}
                    className="h-8 w-full cursor-pointer rounded border border-zinc-700 bg-zinc-950 p-0.5 disabled:opacity-40"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400">
                    Stroke Color
                  </span>
                  <input
                    type="color"
                    disabled={selectedEntry.isLocked}
                    value={selectedEntry.item.textStyle?.stroke ?? "#000000"}
                    onChange={(e) => {
                      const currentStyle = selectedEntry.item.textStyle ?? {
                        fontFamily: "Kanit",
                        fontSize: 64,
                        fill: "#ffffff",
                      };
                      updateItem(selectedEntry.item.id, {
                        textStyle: {
                          ...currentStyle,
                          stroke: e.target.value,
                        },
                      });
                    }}
                    className="h-8 w-full cursor-pointer rounded border border-zinc-700 bg-zinc-950 p-0.5 disabled:opacity-40"
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
