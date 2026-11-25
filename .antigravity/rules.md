# PROJECT RULES & ARCHITECTURAL CONSTRAINTS

**Context:** Client-Side Multi-Track Short-Form Video Editor (9:16)  
**Primary Reference:** `@docs/AGENT_BLUEPRINT.md`

---

## 1. STRICT ARCHITECTURAL BOUNDARIES (NON-NEGOTIABLE)

- **Zero Server Media Upload:** NEVER write API routes, presigned URL generators, or cloud storage logic for raw user video/audio files. Store all binary media locally in browser IndexedDB using `Dexie.js` (`src/core/storage/localDb.ts`) and render via `URL.createObjectURL()`.
- **Cross-Origin Isolation:** `next.config.mjs` (or `.ts`) MUST strictly enforce `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers on all routes so `SharedArrayBuffer` works for multi-threaded `FFmpeg.wasm`. Do not add external scripts, iframes, or fonts without proper CORS/CORP compliance.
- **Local FFmpeg Core & Fonts:** Always load `ffmpeg-core.js` and `ffmpeg-core.wasm` locally from `/public/ffmpeg/` and Thai `.ttf` fonts from `/public/fonts/`. Never fetch FFmpeg binaries from external CDNs at runtime.
- **Pure Logic Separation:** Keep all FFmpeg `-filter_complex` string builders (`src/core/ffmpeg/`), Canvas frame synchronization (`src/core/canvas/`), and IndexedDB queries (`src/core/storage/`) completely decoupled from React UI components.

---

## 2. STATE & DATA INTEGRITY RULES

- **Single Source of Truth:** All timeline tracks, clips, playhead time (`currentTime`), zoom level (`pixelsPerSecond`), and asset statuses (`READY` | `MISSING`) must live in `src/store/useTimelineStore.ts` powered by `Zustand` + `Zundo` (temporal middleware for Undo/Redo).
- **Atomic Clip Trimming & Splitting:**
  - Left-edge trimming MUST update `start`, `duration`, and `trimStart` atomically so video frame alignment never drifts.
  - Splitting a clip at `currentTime` MUST calculate `splitOffset = currentTime - item.start` and assign `item.trimStart + splitOffset` to the newly created right-side clip.
- **Relink Media Resilience:** Never store ephemeral `blob:` URLs in persisted JSON state (PostgreSQL/Neon DB). Reference media exclusively by `assetId` (`UUID v4`) and gracefully handle `'MISSING'` asset states in both Timeline UI and Canvas Preview.

---

## 3. PERFORMANCE & MEMORY HYGIENE

- **Non-Blocking Export:** All `FFmpeg.wasm` executions MUST run inside `src/workers/export.worker.ts` (Web Worker), never on the main UI thread.
- **Mandatory Cleanup:**
  - Always delete input blobs and output `.mp4` files from FFmpeg's virtual file system (`ffmpeg.deleteFile()`) inside a `try...finally` block after every export or cancellation.
  - Always call `URL.revokeObjectURL()` when removing media assets or after downloading an exported video.
- **Pointer Events:** Use unified Pointer Events (`onPointerDown`, `onPointerMove`, `onPointerUp`) attached to `window` during drag/scrubbing operations for smooth mouse and touch support.

---

## 4. CODING STANDARDS & WORKFLOW

- **Stack:** Next.js (App Router), TypeScript (strict mode, no `any`), Tailwind CSS, Konva (`react-konva`), Zustand, Zundo, Dexie.js, `@ffmpeg/ffmpeg`, Prisma ORM.
- **Execution Discipline:** Follow `@docs/AGENT_BLUEPRINT.md` phase-by-phase. Before marking a task complete, verify there are zero TypeScript errors (`npx tsc --noEmit`) and no violations of the rules above.
- **Local Docker Database:** During development, use the local PostgreSQL container defined in `docker-compose.yml` (port 5432) via `DATABASE_URL` in `.env`. Never hardcode database credentials in source files.
- **Project Persistence Schema:** Store project metadata and timeline state (`mediaAssets` metadata + `tracks` array) as a structured `Json` column in PostgreSQL via Prisma ORM, ensuring seamless migration to Neon DB in production.
