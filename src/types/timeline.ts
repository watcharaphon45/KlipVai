export type MediaType = "video" | "audio" | "image";

export type AssetStatus = "READY" | "MISSING";

export type TrackType = "video" | "audio" | "text" | "overlay";

export type TimelineItemType = "video" | "audio" | "image" | "text";

export interface MediaAsset {
  /** UUID v4 */
  id: string;
  name: string;
  type: MediaType;
  mimeType: string;
  fileSize: number;
  /** Duration in seconds (0 for static images) */
  duration: number;
  width?: number;
  height?: number;
  status: AssetStatus;
  /** Runtime-only URL.createObjectURL(); MUST NEVER be persisted to DB */
  blobUrl?: string;
}

export type PersistedMediaAsset = Omit<MediaAsset, "blobUrl">;

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  align?: "left" | "center" | "right";
  backgroundColor?: string;
  fontWeight?: "normal" | "bold";
}

export interface TimelineItem {
  /** UUID v4 */
  id: string;
  trackId: string;
  type: TimelineItemType;
  /** UUID v4 referencing MediaAsset.id; omitted for "text" */
  assetId?: string;
  name: string;
  /** Timeline start in seconds (>= 0) */
  start: number;
  /** Clip duration in seconds (>= 0.1) */
  duration: number;
  /** Source media trim-in offset in seconds (>= 0) */
  trimStart: number;
  /** Audio volume (0 to 1+) */
  volume: number;
  /** 1080x1920 logical canvas X */
  x: number;
  /** 1080x1920 logical canvas Y */
  y: number;
  width?: number;
  height?: number;
  scale: number;
  /** Rotation in degrees */
  rotation: number;
  /** Opacity (0 to 1) */
  opacity: number;
  text?: string;
  textStyle?: TextStyle;
}

export interface TimelineTrack {
  /** UUID v4 */
  id: string;
  name: string;
  type: TrackType;
  /** 0 = bottom, higher = top */
  zIndex: number;
  isMuted: boolean;
  isHidden: boolean;
  isLocked: boolean;
  items: TimelineItem[];
}

export interface ProjectCanvasConfig {
  width: number;
  height: number;
  fps: number;
}

export interface PersistedProjectData {
  mediaAssets: Record<string, PersistedMediaAsset>;
  tracks: TimelineTrack[];
}

export interface ProjectState {
  projectId: string | null;
  projectName: string;
  mediaAssets: Record<string, MediaAsset>;
  tracks: TimelineTrack[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  pixelsPerSecond: number;
  selectedItemId: string | null;
  selectedTrackId: string | null;
  canvas: ProjectCanvasConfig;
}
