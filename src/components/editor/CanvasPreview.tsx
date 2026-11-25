"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import {
  Group,
  Image as KonvaImage,
  Layer,
  Rect,
  Stage,
  Text as KonvaText,
  Transformer,
} from "react-konva";
import { useTimelineStore } from "@/store/useTimelineStore";
import {
  CanvasSyncEngine,
  PROXY_HEIGHT,
  PROXY_SCALE,
  PROXY_WIDTH,
  computeFittedLogicalSize,
  getActiveEntries,
} from "@/core/canvas/syncEngine";
import { formatTimecode } from "@/core/timeline/timelineMath";

export function CanvasPreview() {
  const tracks = useTimelineStore((s) => s.tracks);
  const mediaAssets = useTimelineStore((s) => s.mediaAssets);
  const currentTime = useTimelineStore((s) => s.currentTime);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const selectedItemId = useTimelineStore((s) => s.selectedItemId);
  const selectItem = useTimelineStore((s) => s.selectItem);
  const updateItem = useTimelineStore((s) => s.updateItem);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<Konva.Layer | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const nodeRefs = useRef<Map<string, Konva.Node>>(new Map());
  const syncEngineRef = useRef<CanvasSyncEngine | null>(null);

  const [displayScale, setDisplayScale] = useState(0.5);
  const [drawables, setDrawables] = useState<
    Record<string, HTMLVideoElement | HTMLImageElement>
  >({});

  // Observe available space so the 9:16 proxy stage (540x960) fits responsively
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateSize = (): void => {
      const rect = container.getBoundingClientRect();
      const pad = rect.width < 420 ? 8 : 16;
      const availW = Math.max(120, rect.width - pad);
      const availH = Math.max(200, rect.height - pad);
      const nextScale = Math.min(
        availW / PROXY_WIDTH,
        availH / PROXY_HEIGHT,
        1
      );
      setDisplayScale(Math.max(0.15, nextScale));
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Initialize CanvasSyncEngine once
  useEffect(() => {
    const engine = new CanvasSyncEngine((itemId, element) => {
      setDrawables((prev) => {
        if (prev[itemId] === element) {
          return prev;
        }
        return { ...prev, [itemId]: element };
      });
    });
    syncEngineRef.current = engine;

    return () => {
      engine.disposeAll();
      syncEngineRef.current = null;
    };
  }, []);

  // Prune removed timeline items from sync engine
  useEffect(() => {
    const engine = syncEngineRef.current;
    if (!engine) {
      return;
    }
    const validIds = new Set<string>();
    for (const track of tracks) {
      for (const item of track.items) {
        validIds.add(item.id);
      }
    }
    engine.pruneRemovedItems(validIds);
  }, [tracks]);

  // 60fps synchronization and Konva layer redraw loop
  useEffect(() => {
    let rafId = 0;

    const renderFrame = (): void => {
      const engine = syncEngineRef.current;
      if (engine) {
        const state = useTimelineStore.getState();
        const active = getActiveEntries(
          state.tracks,
          state.mediaAssets,
          state.currentTime
        );
        engine.sync(active, state.isPlaying);
        layerRef.current?.batchDraw();
      }
      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Sync immediately when paused/scrubbed or tracks/assets change
  useEffect(() => {
    const engine = syncEngineRef.current;
    if (!engine) {
      return;
    }
    const active = getActiveEntries(tracks, mediaAssets, currentTime);
    engine.sync(active, isPlaying);
    layerRef.current?.batchDraw();
  }, [tracks, mediaAssets, currentTime, isPlaying]);

  const activeVisualEntries = useMemo(
    () =>
      getActiveEntries(tracks, mediaAssets, currentTime).filter(
        (entry) => entry.item.type !== "audio"
      ),
    [tracks, mediaAssets, currentTime]
  );

  // Attach Konva Transformer to the currently selected visible & unlocked node
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }

    if (!selectedItemId) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }

    const activeSelected = activeVisualEntries.find(
      (entry) => entry.item.id === selectedItemId
    );
    const node = nodeRefs.current.get(selectedItemId);

    if (activeSelected && !activeSelected.track.isLocked && node) {
      transformer.nodes([node]);
    } else {
      transformer.nodes([]);
    }
    transformer.getLayer()?.batchDraw();
  }, [selectedItemId, activeVisualEntries, drawables]);

  const stageWidth = Math.round(PROXY_WIDTH * displayScale);
  const stageHeight = Math.round(PROXY_HEIGHT * displayScale);

  const registerNodeRef =
    (itemId: string) =>
    (node: Konva.Node | null): void => {
      if (node) {
        nodeRefs.current.set(itemId, node);
      } else {
        nodeRefs.current.delete(itemId);
      }
    };

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-zinc-950 p-1 sm:p-2"
    >
      <div className="relative touch-none overflow-hidden rounded-xl border border-zinc-800 bg-black shadow-2xl">
        <Stage
          width={stageWidth}
          height={stageHeight}
          scaleX={displayScale}
          scaleY={displayScale}
          onMouseDown={(e) => {
            if (e.target === e.target.getStage()) {
              selectItem(null);
            }
          }}
          onTouchStart={(e) => {
            if (e.target === e.target.getStage()) {
              selectItem(null);
            }
          }}
        >
          <Layer ref={layerRef}>
            {/* 9:16 Black Base Canvas */}
            <Rect
              x={0}
              y={0}
              width={PROXY_WIDTH}
              height={PROXY_HEIGHT}
              fill="#000000"
              listening={false}
            />

            {activeVisualEntries.map(({ item, track, asset }) => {
              const proxyX = item.x * PROXY_SCALE;
              const proxyY = item.y * PROXY_SCALE;

              if (asset && asset.status === "MISSING") {
                const boxW = 340;
                const boxH = 140;
                return (
                  <Group
                    key={item.id}
                    ref={registerNodeRef(item.id)}
                    x={proxyX}
                    y={proxyY}
                    offsetX={boxW / 2}
                    offsetY={boxH / 2}
                    scaleX={item.scale}
                    scaleY={item.scale}
                    rotation={item.rotation}
                    opacity={item.opacity}
                    draggable={!track.isLocked}
                    onClick={() => selectItem(item.id)}
                    onTap={() => selectItem(item.id)}
                    onDragEnd={(e) => {
                      updateItem(item.id, {
                        x: Math.round(e.target.x() / PROXY_SCALE),
                        y: Math.round(e.target.y() / PROXY_SCALE),
                      });
                    }}
                  >
                    <Rect
                      width={boxW}
                      height={boxH}
                      fill="#450a0a"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dash={[8, 6]}
                      cornerRadius={8}
                    />
                    <KonvaText
                      width={boxW}
                      height={boxH}
                      text={`MISSING MEDIA\n${asset.name}`}
                      fontSize={16}
                      fontStyle="bold"
                      fill="#fecaca"
                      align="center"
                      verticalAlign="middle"
                      padding={12}
                    />
                  </Group>
                );
              }

              if (item.type === "text") {
                const fontSizeProxy =
                  (item.textStyle?.fontSize ?? 64) * PROXY_SCALE;
                const textBoxWidth = PROXY_WIDTH - 40;
                return (
                  <KonvaText
                    key={item.id}
                    ref={registerNodeRef(item.id)}
                    text={item.text ?? item.name}
                    fontFamily={item.textStyle?.fontFamily ?? "sans-serif"}
                    fontSize={fontSizeProxy}
                    fontStyle={
                      item.textStyle?.fontWeight === "bold" ? "bold" : "normal"
                    }
                    fill={item.textStyle?.fill ?? "#ffffff"}
                    stroke={item.textStyle?.stroke}
                    strokeWidth={
                      (item.textStyle?.strokeWidth ?? 0) * PROXY_SCALE
                    }
                    align={item.textStyle?.align ?? "center"}
                    width={textBoxWidth}
                    offsetX={textBoxWidth / 2}
                    offsetY={fontSizeProxy / 2}
                    x={proxyX}
                    y={proxyY}
                    scaleX={item.scale}
                    scaleY={item.scale}
                    rotation={item.rotation}
                    opacity={item.opacity}
                    draggable={!track.isLocked}
                    onClick={() => selectItem(item.id)}
                    onTap={() => selectItem(item.id)}
                    onDragEnd={(e) => {
                      updateItem(item.id, {
                        x: Math.round(e.target.x() / PROXY_SCALE),
                        y: Math.round(e.target.y() / PROXY_SCALE),
                      });
                    }}
                    onTransformEnd={(e) => {
                      const node = e.target;
                      const nextScale = Math.max(
                        0.05,
                        Number(
                          (
                            (Math.abs(node.scaleX()) +
                              Math.abs(node.scaleY())) /
                            2
                          ).toFixed(3)
                        )
                      );
                      node.scaleX(nextScale);
                      node.scaleY(nextScale);
                      updateItem(item.id, {
                        x: Math.round(node.x() / PROXY_SCALE),
                        y: Math.round(node.y() / PROXY_SCALE),
                        scale: nextScale,
                        rotation: Number(node.rotation().toFixed(1)),
                      });
                    }}
                  />
                );
              }

              const drawable = drawables[item.id];
              const logicalSize = computeFittedLogicalSize(
                item.width ?? asset?.width,
                item.height ?? asset?.height
              );
              const proxyW = logicalSize.width * PROXY_SCALE;
              const proxyH = logicalSize.height * PROXY_SCALE;

              return (
                <KonvaImage
                  key={item.id}
                  ref={registerNodeRef(item.id)}
                  image={drawable}
                  width={proxyW}
                  height={proxyH}
                  offsetX={proxyW / 2}
                  offsetY={proxyH / 2}
                  x={proxyX}
                  y={proxyY}
                  scaleX={item.scale}
                  scaleY={item.scale}
                  rotation={item.rotation}
                  opacity={item.opacity}
                  draggable={!track.isLocked}
                  onClick={() => selectItem(item.id)}
                  onTap={() => selectItem(item.id)}
                  onDragEnd={(e) => {
                    updateItem(item.id, {
                      x: Math.round(e.target.x() / PROXY_SCALE),
                      y: Math.round(e.target.y() / PROXY_SCALE),
                    });
                  }}
                  onTransformEnd={(e) => {
                    const node = e.target;
                    const nextScale = Math.max(
                      0.05,
                      Number(
                        (
                          (Math.abs(node.scaleX()) + Math.abs(node.scaleY())) /
                          2
                        ).toFixed(3)
                      )
                    );
                    node.scaleX(nextScale);
                    node.scaleY(nextScale);
                    updateItem(item.id, {
                      x: Math.round(node.x() / PROXY_SCALE),
                      y: Math.round(node.y() / PROXY_SCALE),
                      scale: nextScale,
                      rotation: Number(node.rotation().toFixed(1)),
                    });
                  }}
                />
              );
            })}

            <Transformer
              ref={transformerRef}
              keepRatio
              rotateEnabled
              enabledAnchors={[
                "top-left",
                "top-right",
                "bottom-left",
                "bottom-right",
              ]}
              borderStroke="#818cf8"
              anchorStroke="#818cf8"
              anchorFill="#ffffff"
              anchorSize={10}
              anchorCornerRadius={2}
              boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 20 || newBox.height < 20) {
                  return oldBox;
                }
                return newBox;
              }}
            />
          </Layer>
        </Stage>

        {/* Stage Resolution & Timecode Badge */}
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-zinc-900/80 px-2 py-0.5 font-mono text-[10px] text-zinc-300 backdrop-blur-sm">
          1080×1920 • {formatTimecode(currentTime)}
        </div>
      </div>
    </div>
  );
}
