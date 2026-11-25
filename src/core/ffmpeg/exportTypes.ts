import type {
  MediaAsset,
  ProjectCanvasConfig,
  TimelineTrack,
} from "@/types/timeline";

export type ExportStage =
  | "idle"
  | "preparing"
  | "loading_ffmpeg"
  | "writing_files"
  | "rendering"
  | "reading_output"
  | "complete"
  | "error"
  | "cancelled";

export interface ExportStartPayload {
  tracks: TimelineTrack[];
  mediaAssets: Record<string, MediaAsset>;
  blobs: Record<string, Blob>;
  canvas: ProjectCanvasConfig;
  origin: string;
}

export type ExportWorkerInboundMessage =
  | { type: "START_EXPORT"; payload: ExportStartPayload }
  | { type: "CANCEL_EXPORT" };

export type ExportWorkerOutboundMessage =
  | { type: "STATUS"; payload: { stage: ExportStage; message: string } }
  | { type: "PROGRESS"; payload: { progress: number; timeSec: number } }
  | { type: "LOG"; payload: { message: string } }
  | { type: "COMPLETE"; payload: { outputBlob: Blob; durationSec: number } }
  | { type: "ERROR"; payload: { message: string } };
