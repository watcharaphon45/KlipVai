"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Film,
  Loader2,
  X,
} from "lucide-react";
import { useTimelineStore } from "@/store/useTimelineStore";
import { findMissingActiveAssets } from "@/core/ffmpeg/commandBuilder";
import {
  exportProjectVideo,
  triggerVideoDownload,
  type ExportJobHandle,
} from "@/core/ffmpeg/ffmpegClient";
import type { ExportStage } from "@/core/ffmpeg/exportTypes";
import { formatFileSize, formatTimecode } from "@/core/timeline/timelineMath";

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExportModal({ isOpen, onClose }: ExportModalProps) {
  const projectName = useTimelineStore((s) => s.projectName);
  const tracks = useTimelineStore((s) => s.tracks);
  const mediaAssets = useTimelineStore((s) => s.mediaAssets);
  const canvas = useTimelineStore((s) => s.canvas);
  const duration = useTimelineStore((s) => s.duration);
  const setCanvasFps = useTimelineStore((s) => s.setCanvasFps);

  const [stage, setStage] = useState<ExportStage>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [exportedBlob, setExportedBlob] = useState<Blob | null>(null);
  const isCrossOriginIsolated = useSyncExternalStore<boolean | null>(
    () => () => undefined,
    () => window.crossOriginIsolated,
    () => null
  );

  const jobRef = useRef<ExportJobHandle | null>(null);

  useEffect(() => {
    return () => {
      jobRef.current?.cancel();
      jobRef.current = null;
    };
  }, []);

  const missingAssets = useMemo(
    () => findMissingActiveAssets(tracks, mediaAssets),
    [tracks, mediaAssets]
  );

  if (!isOpen) {
    return null;
  }

  const isExporting =
    stage === "preparing" ||
    stage === "loading_ffmpeg" ||
    stage === "writing_files" ||
    stage === "rendering" ||
    stage === "reading_output";

  const canExport =
    !isExporting && duration > 0 && missingAssets.length === 0;

  const safeFileBase =
    projectName
      .trim()
      .replace(/[^a-zA-Z0-9ก-๙_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "klipvai_export";

  const handleStartExport = async (): Promise<void> => {
    setErrorMessage(null);
    setExportedBlob(null);
    setProgress(0);
    setLogs([]);
    setStage("preparing");
    setStatusMessage("Preparing export...");

    const handle = exportProjectVideo({
      tracks,
      mediaAssets,
      canvas,
      onStatus: (nextStage, message) => {
        setStage(nextStage);
        setStatusMessage(message);
      },
      onProgress: (nextProgress) => {
        setProgress(Math.round(nextProgress * 100));
      },
      onLog: (line) => {
        setLogs((prev) => [...prev.slice(-80), line]);
      },
    });

    jobRef.current = handle;

    try {
      const { blob } = await handle.promise;
      setExportedBlob(blob);
      setProgress(100);
      setStage("complete");
      setStatusMessage("Export complete!");
      triggerVideoDownload(blob, `${safeFileBase}.mp4`);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to export video.";
      setStage((prev) => (prev === "cancelled" ? "cancelled" : "error"));
      setErrorMessage(msg);
    } finally {
      jobRef.current = null;
    }
  };

  const handleClose = (): void => {
    if (isExporting) {
      jobRef.current?.cancel();
      jobRef.current = null;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-4 backdrop-blur-sm">
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-100 shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Film className="h-4 w-4 text-indigo-400" />
            <h3 className="text-sm font-semibold">Export Video (Client-Side)</h3>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close export modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
          <div className="grid grid-cols-1 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 sm:grid-cols-2">
            <div>
              <p className="text-zinc-500">Resolution</p>
              <p className="font-mono font-medium text-zinc-100">
                {canvas.width}×{canvas.height} (9:16)
              </p>
            </div>
            <div>
              <p className="text-zinc-500">Duration</p>
              <p className="font-mono font-medium text-zinc-100">
                {formatTimecode(duration)}
              </p>
            </div>
            <div>
              <p className="text-zinc-500">Format</p>
              <p className="font-medium text-zinc-100">MP4 (H.264 + AAC)</p>
            </div>
            <div>
              <p className="text-zinc-500">Cross-Origin Isolation</p>
              <p
                className={`font-medium ${
                  isCrossOriginIsolated ? "text-emerald-400" : "text-amber-400"
                }`}
              >
                {isCrossOriginIsolated === null
                  ? "Checking..."
                  : isCrossOriginIsolated
                    ? "Enabled (SharedArrayBuffer)"
                    : "Disabled"}
              </p>
            </div>
          </div>

          {/* Frame Rate Selector */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-zinc-400">Frame Rate</span>
              <div className="inline-flex rounded-md border border-zinc-800 bg-zinc-900 p-0.5">
                {[24, 30, 60].map((fpsOption) => {
                  const active = canvas.fps === fpsOption;
                  return (
                    <button
                      key={fpsOption}
                      type="button"
                      disabled={isExporting}
                      onClick={() => setCanvasFps(fpsOption)}
                      className={`rounded px-2.5 py-1 font-mono text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        active
                          ? "bg-indigo-600 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {fpsOption} FPS
                    </button>
                  );
                })}
              </div>
            </div>
            {canvas.fps === 60 && (
              <p className="mt-1.5 text-[11px] text-amber-300/90">
                60 FPS renders twice as many frames and may take longer on
                client-side FFmpeg.wasm.
              </p>
            )}
          </div>

          {missingAssets.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-950/50 p-3 text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div>
                <p className="font-medium">
                  Cannot export with {missingAssets.length} missing media
                  asset(s).
                </p>
                <p className="mt-0.5 text-[11px] text-red-300/90">
                  Please relink all MISSING clips in the timeline banner first.
                </p>
              </div>
            </div>
          )}

          {duration <= 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-950/40 p-3 text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
              <span>Add at least one clip to the timeline before exporting.</span>
            </div>
          )}

          {/* Progress */}
          {(isExporting || stage === "complete") && (
            <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-medium text-zinc-200">
                  {isExporting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  )}
                  {statusMessage}
                </span>
                <span className="font-mono text-zinc-300">{progress}%</span>
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  style={{ width: `${progress}%` }}
                  className={`h-full transition-all duration-200 ${
                    stage === "complete" ? "bg-emerald-500" : "bg-indigo-500"
                  }`}
                />
              </div>

              {exportedBlob && (
                <p className="text-[11px] text-zinc-400">
                  Output size: {formatFileSize(exportedBlob.size)}
                </p>
              )}
            </div>
          )}

          {errorMessage && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/50 p-3 text-rose-200">
              {errorMessage}
            </div>
          )}

          {/* FFmpeg logs toggle */}
          {logs.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowLogs((prev) => !prev)}
                className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200"
              >
                {showLogs ? (
                  <>
                    Hide FFmpeg Logs <ChevronUp className="h-3 w-3" />
                  </>
                ) : (
                  <>
                    Show FFmpeg Logs ({logs.length}){" "}
                    <ChevronDown className="h-3 w-3" />
                  </>
                )}
              </button>
              {showLogs && (
                <pre className="mt-1.5 max-h-36 overflow-y-auto rounded border border-zinc-800 bg-black p-2 font-mono text-[10px] text-zinc-400">
                  {logs.join("\n")}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          {isExporting ? (
            <button
              type="button"
              onClick={() => jobRef.current?.cancel()}
              className="rounded-md border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/25"
            >
              Cancel Export
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Close
              </button>

              {exportedBlob && (
                <button
                  type="button"
                  onClick={() =>
                    triggerVideoDownload(exportedBlob, `${safeFileBase}.mp4`)
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download Again
                </button>
              )}

              <button
                type="button"
                disabled={!canExport}
                onClick={() => void handleStartExport()}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
                Start Export
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
