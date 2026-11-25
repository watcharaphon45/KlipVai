"use client";

import { useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, FolderSync } from "lucide-react";
import { useTimelineStore } from "@/store/useTimelineStore";
import { formatFileSize, formatTimecode } from "@/core/timeline/timelineMath";

export function RelinkBanner() {
  const mediaAssets = useTimelineStore((s) => s.mediaAssets);
  const relinkAsset = useTimelineStore((s) => s.relinkAsset);

  const [isExpanded, setIsExpanded] = useState(false);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [assetErrors, setAssetErrors] = useState<Record<string, string>>({});
  const batchInputRef = useRef<HTMLInputElement | null>(null);

  const missingAssets = Object.values(mediaAssets).filter(
    (asset) => asset.status === "MISSING"
  );

  if (missingAssets.length === 0) {
    return null;
  }

  const handleBatchRelink = async (
    e: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) {
      return;
    }

    let relinkedCount = 0;
    const unmatchedNames: string[] = [];
    const remaining = [...missingAssets];

    for (const file of files) {
      let matched = false;
      for (let i = 0; i < remaining.length; i += 1) {
        const candidateAsset = remaining[i];
        const result = await relinkAsset(candidateAsset.id, file);
        if (result.isValid) {
          relinkedCount += 1;
          remaining.splice(i, 1);
          matched = true;
          setAssetErrors((prev) => {
            const next = { ...prev };
            delete next[candidateAsset.id];
            return next;
          });
          break;
        }
      }
      if (!matched) {
        unmatchedNames.push(file.name);
      }
    }

    if (unmatchedNames.length > 0) {
      setBatchMessage(
        `Relinked ${relinkedCount} file(s). Unmatched: ${unmatchedNames.join(", ")}`
      );
    } else {
      setBatchMessage(`Successfully relinked ${relinkedCount} file(s).`);
    }
  };

  const handleSingleRelink = async (
    assetId: string,
    e: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) {
      return;
    }

    const result = await relinkAsset(assetId, file);
    if (!result.isValid) {
      setAssetErrors((prev) => ({
        ...prev,
        [assetId]: result.reason ?? "Selected file does not match.",
      }));
    } else {
      setAssetErrors((prev) => {
        const next = { ...prev };
        delete next[assetId];
        return next;
      });
    }
  };

  return (
    <div className="border-b border-red-500/40 bg-red-950/60 px-3 py-2 text-xs text-red-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          <span className="font-medium">
            {missingAssets.length} missing media file
            {missingAssets.length > 1 ? "s" : ""} detected in local IndexedDB.
          </span>
          {batchMessage && (
            <span className="text-red-200/90">{batchMessage}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={batchInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleBatchRelink}
          />
          <button
            type="button"
            onClick={() => batchInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded bg-red-600 px-2.5 py-1 font-medium text-white transition-colors hover:bg-red-500"
          >
            <FolderSync className="h-3.5 w-3.5" />
            Batch Relink
          </button>

          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded border border-red-400/40 px-2 py-1 text-red-100 transition-colors hover:bg-red-900/60"
          >
            {isExpanded ? (
              <>
                Hide <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                Details <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-2 space-y-1.5 border-t border-red-500/30 pt-2">
          {missingAssets.map((asset) => (
            <div
              key={asset.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded bg-red-950/80 px-2.5 py-1.5"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-red-100">
                  {asset.name}
                </p>
                <p className="text-[11px] text-red-300/80">
                  {asset.type.toUpperCase()} • {formatFileSize(asset.fileSize)}
                  {asset.duration > 0
                    ? ` • ${formatTimecode(asset.duration)}`
                    : ""}
                </p>
                {assetErrors[asset.id] && (
                  <p className="mt-0.5 text-[11px] text-amber-300">
                    {assetErrors[asset.id]}
                  </p>
                )}
              </div>

              <label className="cursor-pointer rounded border border-red-400/50 bg-red-900/70 px-2 py-1 font-medium text-red-100 transition-colors hover:bg-red-800">
                Relink File
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => handleSingleRelink(asset.id, e)}
                />
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
