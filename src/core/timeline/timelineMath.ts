import type {
  TimelineItem,
  TimelineItemType,
  TrackType,
} from "@/types/timeline";

export const SNAP_THRESHOLD_SEC = 0.1;
export const TIME_EPSILON = 1e-6;

/**
 * Converts a timeline timestamp in seconds to a horizontal pixel offset.
 */
export function timeToPx(timeSec: number, pixelsPerSecond: number): number {
  return timeSec * pixelsPerSecond;
}

/**
 * Converts a horizontal pixel offset to a timeline timestamp in seconds.
 */
export function pxToTime(px: number, pixelsPerSecond: number): number {
  return pixelsPerSecond > 0 ? px / pixelsPerSecond : 0;
}

/**
 * Snaps a candidate timestamp to the playhead if within thresholdSec.
 */
export function snapToPlayhead(
  candidateTime: number,
  playheadTime: number,
  thresholdSec = SNAP_THRESHOLD_SEC
): number {
  if (Math.abs(candidateTime - playheadTime) < thresholdSec) {
    return playheadTime;
  }
  return candidateTime;
}

/**
 * Checks whether a clip of itemType can be placed onto a track of trackType.
 */
export function isItemCompatibleWithTrack(
  itemType: TimelineItemType,
  trackType: TrackType
): boolean {
  if (itemType === "audio") {
    return trackType === "audio";
  }
  if (itemType === "text") {
    return trackType === "text";
  }
  return trackType === "video" || trackType === "overlay";
}

/**
 * Resolves the nearest non-overlapping start time for a clip among siblings in a track.
 */
export function resolveNonOverlappingStart(
  siblings: TimelineItem[],
  desiredStart: number,
  clipDuration: number
): number {
  const safeDesired = Math.max(0, desiredStart);
  const safeDur = Math.max(0.1, clipDuration);

  if (siblings.length === 0) {
    return safeDesired;
  }

  const sorted = [...siblings].sort((a, b) => a.start - b.start);
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  for (const sibling of sorted) {
    if (sibling.start > cursor + TIME_EPSILON) {
      gaps.push({ start: cursor, end: sibling.start });
    }
    cursor = Math.max(cursor, sibling.start + sibling.duration);
  }
  gaps.push({ start: cursor, end: Number.POSITIVE_INFINITY });

  for (const gap of gaps) {
    if (
      safeDesired >= gap.start - TIME_EPSILON &&
      safeDesired + safeDur <= gap.end + TIME_EPSILON
    ) {
      return safeDesired;
    }
  }

  let bestCandidate = cursor;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const gap of gaps) {
    if (gap.end - gap.start < safeDur - TIME_EPSILON) {
      continue;
    }
    const maxStart = Number.isFinite(gap.end)
      ? gap.end - safeDur
      : Number.POSITIVE_INFINITY;
    const candidate = Math.min(Math.max(safeDesired, gap.start), maxStart);
    const distance = Math.abs(candidate - safeDesired);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestCandidate = candidate;
    }
  }

  return Math.max(0, bestCandidate);
}

/**
 * Finds the earliest non-overlapping start >= desiredStart for inserting a new clip.
 */
export function findNextAvailableStart(
  siblings: TimelineItem[],
  desiredStart: number,
  clipDuration: number
): number {
  let cursor = Math.max(0, desiredStart);
  const safeDur = Math.max(0.1, clipDuration);
  const sorted = [...siblings].sort((a, b) => a.start - b.start);

  for (const sibling of sorted) {
    if (cursor + safeDur <= sibling.start + TIME_EPSILON) {
      break;
    }
    if (cursor < sibling.start + sibling.duration - TIME_EPSILON) {
      cursor = sibling.start + sibling.duration;
    }
  }

  return cursor;
}

/**
 * Snaps a clip start to the playhead or adjacent sibling clip edges within thresholdSec.
 */
export function snapClipStart(
  candidateStart: number,
  clipDuration: number,
  playheadTime: number,
  siblings: TimelineItem[],
  thresholdSec = SNAP_THRESHOLD_SEC
): number {
  const safeCandidate = Math.max(0, candidateStart);
  const targets: number[] = [playheadTime];

  if (playheadTime - clipDuration >= 0) {
    targets.push(playheadTime - clipDuration);
  }

  for (const sibling of siblings) {
    targets.push(sibling.start + sibling.duration);
    const beforeSibling = sibling.start - clipDuration;
    if (beforeSibling >= 0) {
      targets.push(beforeSibling);
    }
  }

  let bestTarget = safeCandidate;
  let bestDiff = thresholdSec;

  for (const target of targets) {
    const diff = Math.abs(safeCandidate - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestTarget = target;
    }
  }

  return Math.max(0, bestTarget);
}

/**
 * Formats seconds into MM:SS.cc (hundredths of a second).
 */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalCentiseconds = Math.floor(safe * 100);
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60);

  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

/**
 * Formats a byte count into human-readable units (B, KB, MB, GB).
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(1)} MB`;
  }
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/**
 * Chooses major tick spacing and minor subdivisions for the time ruler based on zoom.
 */
export function getRulerIntervals(pixelsPerSecond: number): {
  majorStepSec: number;
  minorDivisions: number;
} {
  if (pixelsPerSecond >= 160) {
    return { majorStepSec: 1, minorDivisions: 5 };
  }
  if (pixelsPerSecond >= 80) {
    return { majorStepSec: 2, minorDivisions: 4 };
  }
  if (pixelsPerSecond >= 40) {
    return { majorStepSec: 5, minorDivisions: 5 };
  }
  if (pixelsPerSecond >= 20) {
    return { majorStepSec: 10, minorDivisions: 5 };
  }
  return { majorStepSec: 15, minorDivisions: 3 };
}
