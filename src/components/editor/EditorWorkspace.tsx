"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Clapperboard,
  Download,
  Film,
  FolderKanban,
  FolderOpen,
  Image as ImageIcon,
  Music,
  Plus,
  Save,
  Sliders,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useTimelineStore } from "@/store/useTimelineStore";
import { formatFileSize, formatTimecode } from "@/core/timeline/timelineMath";
import { TimelinePanel } from "@/components/editor/timeline/TimelinePanel";
import { PropertiesInspector } from "@/components/editor/PropertiesInspector";
import { ExportModal } from "@/components/editor/ExportModal";
import { ProjectsModal } from "@/components/editor/ProjectsModal";
import type { MediaAsset, TrackType } from "@/types/timeline";

const CanvasPreview = dynamic(
  () =>
    import("@/components/editor/CanvasPreview").then((m) => m.CanvasPreview),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-zinc-950">
        <div className="aspect-[9/16] h-full max-h-[460px] rounded-xl border border-zinc-800 bg-black" />
      </div>
    ),
  }
);

function getTrackTypeForAsset(asset: MediaAsset): TrackType {
  if (asset.type === "audio") {
    return "audio";
  }
  if (asset.type === "image") {
    return "overlay";
  }
  return "video";
}

function AssetIcon({ type }: { type: MediaAsset["type"] }) {
  switch (type) {
    case "video":
      return <Film className="h-4 w-4 text-indigo-400" />;
    case "audio":
      return <Music className="h-4 w-4 text-emerald-400" />;
    case "image":
      return <ImageIcon className="h-4 w-4 text-amber-400" />;
  }
}

export function EditorWorkspace() {
  const projectId = useTimelineStore((s) => s.projectId);
  const projectName = useTimelineStore((s) => s.projectName);
  const mediaAssets = useTimelineStore((s) => s.mediaAssets);
  const selectedItemId = useTimelineStore((s) => s.selectedItemId);

  const setProjectMeta = useTimelineStore((s) => s.setProjectMeta);
  const serializeProjectData = useTimelineStore((s) => s.serializeProjectData);
  const verifyAndHydrateAssets = useTimelineStore(
    (s) => s.verifyAndHydrateAssets
  );
  const importMediaFile = useTimelineStore((s) => s.importMediaFile);
  const removeMediaAsset = useTimelineStore((s) => s.removeMediaAsset);
  const addTrack = useTimelineStore((s) => s.addTrack);
  const addItem = useTimelineStore((s) => s.addItem);
  const selectItem = useTimelineStore((s) => s.selectItem);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isProjectsOpen, setIsProjectsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<
    "none" | "media" | "inspector"
  >("none");

  useEffect(() => {
    void verifyAndHydrateAssets();
  }, [verifyAndHydrateAssets]);

  const assetList = useMemo(() => Object.values(mediaAssets), [mediaAssets]);

  const placeAssetOnTimeline = (asset: MediaAsset): void => {
    const state = useTimelineStore.getState();
    const preferredType = getTrackTypeForAsset(asset);
    let targetTrack = state.tracks.find(
      (t) => t.type === preferredType && !t.isLocked
    );

    if (!targetTrack) {
      const label =
        preferredType === "audio"
          ? "Audio"
          : preferredType === "overlay"
            ? "Overlay"
            : "Video";
      targetTrack = addTrack(preferredType, label);
    }

    const trackEnd = targetTrack.items.reduce(
      (max, item) => Math.max(max, item.start + item.duration),
      0
    );

    const clipDuration =
      asset.type === "image" ? 3 : Math.max(0.1, asset.duration || 3);

    const created = addItem(targetTrack.id, {
      type: asset.type,
      assetId: asset.id,
      name: asset.name,
      start: Math.max(state.currentTime, trackEnd),
      duration: clipDuration,
      trimStart: 0,
      volume: 1,
      x: 540,
      y: 960,
      width: asset.width,
      height: asset.height,
      scale: 1,
      rotation: 0,
      opacity: 1,
    });

    if (created) {
      selectItem(created.id);
    }
  };

  const handleImportFiles = async (
    e: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) {
      return;
    }

    setImportError(null);
    setIsImporting(true);
    try {
      for (const file of files) {
        const asset = await importMediaFile(file);
        placeAssetOnTimeline(asset);
      }
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Failed to import media file."
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleSaveProject = async (): Promise<void> => {
    setIsSaving(true);
    setSaveFeedback(null);
    try {
      const payload = {
        name: projectName,
        data: serializeProjectData(),
      };
      const isUpdate = Boolean(projectId);
      const res = await fetch(
        isUpdate ? `/api/projects/${projectId}` : "/api/projects",
        {
          method: isUpdate ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const result = (await res.json()) as {
        project?: { id: string; name: string };
        error?: string;
      };
      if (!res.ok || !result.project) {
        throw new Error(result.error || "Save failed");
      }
      setProjectMeta(result.project.id, result.project.name);
      setSaveFeedback("Saved!");
      window.setTimeout(() => setSaveFeedback(null), 2000);
    } catch (error) {
      setSaveFeedback(error instanceof Error ? error.message : "Save error");
      window.setTimeout(() => setSaveFeedback(null), 3500);
    } finally {
      setIsSaving(false);
    }
  };

  const renderMediaLibraryContent = (isMobileDrawer: boolean) => (
    <>
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Media Library ({assetList.length})
        </h2>
        {isMobileDrawer && (
          <button
            type="button"
            onClick={() => setMobilePanel("none")}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close media library"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="border-b border-zinc-800 bg-zinc-950/60 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
        <p className="mb-1 font-medium text-zinc-300">ไฟล์ที่รองรับ:</p>
        <p>
          <span className="text-indigo-300">วิดีโอ:</span> MP4, MOV, WebM, MKV,
          M4V
        </p>
        <p>
          <span className="text-emerald-300">เสียง:</span> MP3, WAV, AAC, M4A,
          OGG, FLAC
        </p>
        <p>
          <span className="text-amber-300">รูปภาพ:</span> PNG, JPG, JPEG, WebP,
          GIF, BMP
        </p>
        <p className="mt-1 text-[10px] text-zinc-500">
          * เก็บไฟล์ใน IndexedDB ของเบราว์เซอร์เท่านั้น (ไม่อัปโหลดขึ้นเซิร์ฟเวอร์)
        </p>
      </div>

      {importError && (
        <div className="border-b border-rose-500/40 bg-rose-950/60 px-3 py-2 text-xs text-rose-200">
          {importError}
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {assetList.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-500">
            Click &ldquo;Import Media&rdquo; to cache video, audio, or image
            files locally in IndexedDB.
          </div>
        ) : (
          assetList.map((asset) => (
            <div
              key={asset.id}
              className={`rounded-md border p-2.5 text-xs ${
                asset.status === "MISSING"
                  ? "border-red-500/60 bg-red-950/30"
                  : "border-zinc-800 bg-zinc-900/80"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {asset.status === "MISSING" ? (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                  ) : (
                    <AssetIcon type={asset.type} />
                  )}
                  <span className="truncate font-medium text-zinc-100">
                    {asset.name}
                  </span>
                </div>

                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    asset.status === "MISSING"
                      ? "bg-red-500/20 text-red-300"
                      : "bg-emerald-500/15 text-emerald-300"
                  }`}
                >
                  {asset.status}
                </span>
              </div>

              <p className="mt-1 text-[11px] text-zinc-400">
                {formatFileSize(asset.fileSize)}
                {asset.duration > 0
                  ? ` • ${formatTimecode(asset.duration)}`
                  : ""}
                {asset.width && asset.height
                  ? ` • ${asset.width}×${asset.height}`
                  : ""}
              </p>

              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    placeAssetOnTimeline(asset);
                    if (isMobileDrawer) {
                      setMobilePanel("none");
                    }
                  }}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-700"
                >
                  <Plus className="h-3 w-3" />
                  Add to Timeline
                </button>
                <button
                  type="button"
                  onClick={() => void removeMediaAsset(asset.id)}
                  className="rounded p-1 text-zinc-400 hover:bg-rose-500/20 hover:text-rose-300"
                  title="Delete asset from IndexedDB"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Top Studio Header */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/95 px-2.5 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <div className="flex shrink-0 items-center gap-1.5 font-semibold tracking-tight text-white sm:gap-2">
            <Clapperboard className="h-5 w-5 text-indigo-400" />
            <span className="text-sm sm:text-base">KlipVai</span>
            <span className="hidden rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300 sm:inline-block">
              9:16
            </span>
          </div>

          <div className="hidden h-4 w-px bg-zinc-700 sm:block" />

          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectMeta(projectId, e.target.value)}
            aria-label="Project name"
            className="min-w-0 flex-1 max-w-[130px] rounded border border-transparent bg-transparent px-1.5 py-1 text-xs text-zinc-200 transition-colors hover:border-zinc-700 focus:border-indigo-500 focus:bg-zinc-950 focus:outline-none sm:max-w-[224px] sm:px-2 sm:text-sm"
          />
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {/* Mobile drawer toggles */}
          <button
            type="button"
            onClick={() =>
              setMobilePanel((prev) => (prev === "media" ? "none" : "media"))
            }
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors lg:hidden ${
              mobilePanel === "media"
                ? "border-indigo-500 bg-indigo-500/20 text-indigo-200"
                : "border-zinc-700 bg-zinc-800/80 text-zinc-200"
            }`}
            title="Toggle Media Library"
            aria-label="Toggle Media Library"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Media</span>
            <span className="text-[10px] text-zinc-400">
              {assetList.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              setMobilePanel((prev) =>
                prev === "inspector" ? "none" : "inspector"
              )
            }
            className={`relative inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors lg:hidden ${
              mobilePanel === "inspector"
                ? "border-indigo-500 bg-indigo-500/20 text-indigo-200"
                : "border-zinc-700 bg-zinc-800/80 text-zinc-200"
            }`}
            title="Toggle Inspector"
            aria-label="Toggle Inspector"
          >
            <Sliders className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Inspector</span>
            {selectedItemId && (
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
            )}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="video/*,audio/*,image/*,.mp4,.mov,.webm,.mkv,.m4v,.mp3,.wav,.aac,.m4a,.ogg,.flac,.png,.jpg,.jpeg,.webp,.gif,.bmp"
            className="hidden"
            onChange={handleImportFiles}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            title="รองรับไฟล์: Video (MP4, MOV, WebM, MKV, M4V), Audio (MP3, WAV, AAC, M4A, OGG, FLAC), Image (PNG, JPG, JPEG, WebP, GIF, BMP)"
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50 sm:px-3"
          >
            <Upload className="h-3.5 w-3.5" />
            <span className="sm:hidden">
              {isImporting ? "..." : "Import"}
            </span>
            <span className="hidden sm:inline">
              {isImporting ? "Importing..." : "Import Media"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setIsProjectsOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 sm:px-2.5"
            title="Open saved projects"
            aria-label="Open saved projects"
          >
            <FolderKanban className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Projects</span>
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={() => void handleSaveProject()}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-50 sm:px-2.5"
            title="Save project metadata to database"
            aria-label="Save project"
          >
            <Save className="h-3.5 w-3.5" />
            <span className="hidden md:inline">
              {isSaving ? "Saving..." : saveFeedback ?? "Save"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setIsExportOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-600/20 px-2.5 py-1.5 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-600/35 sm:px-3"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="sm:hidden">Export</span>
            <span className="hidden sm:inline">Export MP4</span>
          </button>
        </div>
      </header>

      {/* Main Split Workspace */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Desktop Left Media Library */}
        <aside className="hidden w-72 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/50 lg:flex">
          {renderMediaLibraryContent(false)}
        </aside>

        {/* Center 9:16 Konva Canvas Preview */}
        <main className="min-w-0 flex-1 bg-zinc-950">
          <CanvasPreview />
        </main>

        {/* Desktop Right Properties Inspector */}
        <PropertiesInspector className="hidden lg:flex" />

        {/* Mobile Slide-Over Drawers (< lg) */}
        {mobilePanel === "media" && (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-[1px]"
              onClick={() => setMobilePanel("none")}
            />
            <aside className="relative z-10 flex h-full w-80 max-w-[85vw] flex-col border-r border-zinc-800 bg-zinc-900 shadow-2xl">
              {renderMediaLibraryContent(true)}
            </aside>
          </div>
        )}

        {mobilePanel === "inspector" && (
          <div className="fixed inset-0 z-40 flex justify-end lg:hidden">
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-[1px]"
              onClick={() => setMobilePanel("none")}
            />
            <PropertiesInspector
              onClose={() => setMobilePanel("none")}
              className="relative z-10 h-full w-80 max-w-[85vw] border-l border-zinc-800 shadow-2xl"
            />
          </div>
        )}
      </div>

      {/* Bottom Multi-Track Timeline */}
      <TimelinePanel />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
      />

      <ProjectsModal
        isOpen={isProjectsOpen}
        onClose={() => setIsProjectsOpen(false)}
      />
    </div>
  );
}
