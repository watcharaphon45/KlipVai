"use client";

import { useEffect, useState } from "react";
import {
  FilePlus2,
  FolderKanban,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { useTimelineStore } from "@/store/useTimelineStore";
import type { PersistedProjectData } from "@/types/timeline";

interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProjectsModal({ isOpen, onClose }: ProjectsModalProps) {
  const currentProjectId = useTimelineStore((s) => s.projectId);
  const loadProjectData = useTimelineStore((s) => s.loadProjectData);
  const resetProject = useTimelineStore((s) => s.resetProject);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) {
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        const payload = (await res.json()) as {
          projects?: ProjectSummary[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(payload.error || "Failed to load projects.");
        }
        if (!cancelled) {
          setProjects(payload.projects ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to connect to database."
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleOpenProject = async (id: string): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${id}`, { cache: "no-store" });
      const payload = (await res.json()) as {
        project?: {
          id: string;
          name: string;
          data: PersistedProjectData;
        };
        error?: string;
      };
      if (!res.ok || !payload.project) {
        throw new Error(payload.error || "Failed to open project.");
      }
      await loadProjectData(
        payload.project.id,
        payload.project.name,
        payload.project.data
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open project.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteProject = async (id: string): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || "Failed to delete project.");
      }
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete project."
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleNewBlank = (): void => {
    resetProject();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-4">
      <div className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-100 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <FolderKanban className="h-4 w-4 text-indigo-400" />
            <h3 className="text-sm font-semibold">Saved Projects</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close projects modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4 text-xs">
          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/50 p-3 text-rose-200">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading projects...
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-zinc-500">
              No saved projects yet. Click &ldquo;Save&rdquo; in the top bar to
              save your timeline metadata to PostgreSQL / Neon DB.
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((proj) => {
                const isCurrent = proj.id === currentProjectId;
                const isBusy = busyId === proj.id;
                return (
                  <div
                    key={proj.id}
                    className={`flex items-center justify-between gap-2 rounded-lg border p-3 ${
                      isCurrent
                        ? "border-indigo-500/50 bg-indigo-950/25"
                        : "border-zinc-800 bg-zinc-950/60"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-zinc-100">
                        {proj.name}
                        {isCurrent && (
                          <span className="ml-2 rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-300">
                            Active
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        Updated {new Date(proj.updatedAt).toLocaleString()}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleOpenProject(proj.id)}
                        className="rounded bg-indigo-600 px-2.5 py-1 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                      >
                        {isBusy ? "..." : "Open"}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleDeleteProject(proj.id)}
                        className="rounded p-1.5 text-zinc-400 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-50"
                        title="Delete project"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            onClick={handleNewBlank}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            New Blank Project
          </button>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
