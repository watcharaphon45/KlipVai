# AI AGENT EXECUTION BLUEPRINT & SYSTEM FLOWS

**Project:** Client-Side Multi-Track Short-Form Video Editor (9:16)  
**Target Environment:** Next.js (App Router), TypeScript, Tailwind CSS, Zustand, Konva.js, Dexie.js (IndexedDB), FFmpeg.wasm (Web Worker)

> **INSTRUCTION FOR AI AGENT:**  
> This document is the single source of truth for implementing this application. Read all constraints and data flows carefully before generating code. Execute implementation strictly phase-by-phase. Do not deviate from the client-side-first architecture.

---

## 1. ARCHITECTURAL RULES & CONSTRAINTS (MANDATORY)

1. **Zero Server Media Upload:** NEVER write code that uploads raw user video/audio files to cloud storage or backend APIs. All user media files MUST be stored locally in the browser's IndexedDB via `Dexie.js` and accessed via `URL.createObjectURL()`.
2. **Cross-Origin Isolation:** `next.config.mjs` MUST always include `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers to enable `SharedArrayBuffer` for multi-threaded `FFmpeg.wasm`.
3. **Local FFmpeg Core Assets:** Serve `ffmpeg-core.js` and `ffmpeg-core.wasm` locally from `/public/ffmpeg/` to prevent CORP/CORS blocking.
4. **Separation of Concerns:** Keep all canvas math, IndexedDB operations, and FFmpeg command generation inside `src/core/`. React components in `src/components/` must remain declarative and consume state from `useTimelineStore`.
5. **Memory Management:** Always revoke unused `Blob URL`s (`URL.revokeObjectURL`) and delete files from FFmpeg's virtual file system (`ffmpeg.deleteFile`) in `finally` blocks after export.

---

## 2. SYSTEM FLOWS (DATA & EXECUTION PIPELINES)

### FLOW A: Media Import & Local Caching Flow

```text
[User Selects File(s)]
       │
       ▼
[Extract Metadata] ──(HTML5 <video>/<audio> off-screen element)──> Get { duration, width, height, size, mimeType }
       │
       ▼
[Generate Asset ID] ──(UUID v4)──> Create MediaAsset object (status: 'READY')
       │
       ├──> [Save Binary Blob to IndexedDB] (Dexie.js: table 'mediaFiles', key: assetId)
       │
       └──> [Create Runtime Blob URL] ──> Store { mediaAssets[assetId] } in Zustand Store
                                               │
                                               ▼
                                    [Sync Project JSON to Neon DB] (Metadata only, NO Blob URL)
```

### FLOW B: Project Load & Relink Media Verification Flow

```text
[Open Project / Page Refresh]
       │
       ▼
[Fetch Project JSON from Backend/Neon DB] ──> Load { mediaAssets, tracks } into Zustand
       │
       ▼
[Loop Through Each assetId in mediaAssets]
       │
       ├──(Query IndexedDB by assetId)──> [FOUND?]
       │                                     │
       │                        ┌────────────┴────────────┐
       │                       YES                        NO
       │                        │                         │
       │                        ▼                         ▼
       │            [Create New Blob URL]       [Set status = 'MISSING']
       │            [Set status = 'READY']      [Show Red Striped Clip on Timeline]
       │                                        [Show RelinkBanner Alert]
       │                                                  │
       │                                                  ▼
       │                                        [User Clicks Relink & Selects File]
       │                                                  │
       │                                                  ▼
       │                                        [Validate: fileSize === asset.fileSize && |duration - asset.duration| <= 0.05s]
       │                                                  │
       │                                                  ├──(Valid)──> Save Blob to IndexedDB -> Create Blob URL -> Set 'READY'
       │                                                  └──(Invalid)─> Reject & Show Mismatch Warning
```

### FLOW C: Multi-Track Timeline Interaction & Time/Pixel Math

```text
Conversion Formula:
  leftPx  = item.start * zoomLevel (pixelsPerSecond)
  widthPx = item.duration * zoomLevel
  timeSec = pointerX / zoomLevel

[User Action on TimelineClip]
       │
       ├──> [DRAG / MOVE]
       │      └──> newStart = Math.max(0, initialStart + (deltaX / zoomLevel))
       │      └──> Apply Snapping: if |newStart - playheadTime| < 0.1s -> newStart = playheadTime
       │
       ├──> [TRIM LEFT EDGE] (Must update 3 properties atomically)
       │      └──> deltaSec = deltaX / zoomLevel
       │      └──> item.start     += deltaSec
       │      └──> item.duration  -= deltaSec
       │      └──> item.trimStart += deltaSec
       │
       ├──> [TRIM RIGHT EDGE]
       │      └──> item.duration = Math.max(0.1, initialDuration + (deltaX / zoomLevel))
       │
       └──> [SPLIT AT PLAYHEAD] (Triggered at currentTime)
              └──> Condition: currentTime > item.start + 0.1 && currentTime < (item.start + item.duration) - 0.1
              └──> splitOffset = currentTime - item.start
              └──> Left Clip:  { ...item, duration: splitOffset }
              └──> Right Clip: { ...item, id: uuid(), start: currentTime, duration: item.duration - splitOffset, trimStart: item.trimStart + splitOffset }
```

### FLOW D: Real-Time Canvas Preview Synchronization Flow

```text
[requestAnimationFrame Loop (60fps)]
       │
       ▼
[Read currentTime & isPlaying from Zustand]
       │
       ▼
[Filter Active Tracks] ──> track.isHidden === false
       │
       ▼
[Sort Tracks Ascending by zIndex] (0 = bottom, N = top)
       │
       ▼
[Filter Active Items] ──> currentTime >= item.start && currentTime <= (item.start + item.duration)
       │
       ▼
[Sync Off-Screen HTML5 <video>/<audio> Elements]
       │  └──> targetMediaTime = (currentTime - item.start) + item.trimStart
       │  └──> If |element.currentTime - targetMediaTime| > 0.1s -> Seek element.currentTime
       │
       ▼
[Render Frame onto Konva.js Stage (Proxy Resolution: 540x960)]
       └──> Draw Video Frame / Image / Text with { x * 0.5, y * 0.5, scale, rotation, opacity }
```

### FLOW E: Client-Side Export Flow (FFmpeg.wasm + Web Worker)

```text
[Main Thread: User Clicks Export]
       │
       ├──> 1. Verify no active clips have asset.status === 'MISSING'
       ├──> 2. Fetch required File Blobs from IndexedDB (Dexie.js)
       └──> 3. Send postMessage({ type: 'START_EXPORT', payload: { tracks, mediaAssets, blobs } })
                   │
                   ▼
[Web Worker: src/workers/export.worker.ts]
       │
       ├──> 1. Initialize Singleton FFmpeg instance (from /public/ffmpeg/)
       ├──> 2. Write Blobs & Thai Fonts (.ttf) into FFmpeg MEMFS (ffmpeg.writeFile)
       ├──> 3. Call commandBuilder(tracks, mediaAssets) -> Generate [-filter_complex] args
       ├──> 4. Execute ffmpeg.exec(args) -> Stream progress % back to Main Thread
       ├──> 5. Read 'output.mp4' from MEMFS -> Convert to Blob('video/mp4')
       ├──> 6. [FINALLY BLOCK] Delete all temporary files from MEMFS (ffmpeg.deleteFile)
       └──> 7. Send postMessage({ type: 'COMPLETE', payload: outputBlob })
                   │
                   ▼
[Main Thread: Trigger Browser Download & Revoke Output Blob URL]
```

---

## 3. PHASE-BY-PHASE IMPLEMENTATION ROADMAP

Execute the development in the following strict order. Verify each phase before proceeding to the next.

### PHASE 1: Project Foundation & Local Database Setup

- **Goal:** Initialize Next.js project with required headers, directory structure, and local Docker PostgreSQL database.
- **Tasks:**
  1. **Local Database (Docker):**
     - Create `docker-compose.yml` at project root defining a `postgres:16-alpine` service (`POSTGRES_USER: devuser`, `POSTGRES_PASSWORD: devpassword`, `POSTGRES_DB: short_video_editor`, port `5432:5432`, with persistent volume).
     - Create `.env` (and ensure `.env` is in `.gitignore`) with `DATABASE_URL="postgresql://devuser:devpassword@localhost:5432/short_video_editor?schema=public"`.
     - Run `docker compose up -d` via terminal and verify the PostgreSQL container is healthy and accepting connections.
  2. **ORM & Schema Setup (Prisma):**
     - Install `prisma` and `@prisma/client`. Initialize Prisma (`npx prisma init`) and create a `Project` model (`id`, `name`, `data` as `Json` storing `{ mediaAssets, tracks }`, `createdAt`, `updatedAt`).
     - Run `npx prisma db push` to sync the schema to the local Docker PostgreSQL container.
  3. **Project Structure & Headers:**
     - Create directory structure: `src/types`, `src/store`, `src/core/{storage,canvas,ffmpeg}`, `src/components/editor/{timeline}`, `src/workers`, `public/ffmpeg`, `public/fonts`.
     - Configure `next.config.mjs` (or `.ts`) with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers.
     - Copy `ffmpeg-core.js` and `ffmpeg-core.wasm` into `public/ffmpeg/`. Place at least one Thai `.ttf` font (e.g., `Kanit-Regular.ttf`) in `public/fonts/`.
     - Define all TypeScript interfaces (`MediaAsset`, `TimelineItem`, `TimelineTrack`, `ProjectState`) in `src/types/timeline.ts`.

### PHASE 2: State Management & Local Storage Engine

- **Goal:** Build the reactive store with Undo/Redo and IndexedDB persistence.
- **Tasks:**
  1. Implement `src/core/storage/localDb.ts` using `Dexie` (`saveMediaToLocal`, `loadMediaFromLocal`, `deleteMediaFromLocal`).
  2. Implement `src/core/storage/relinkMatcher.ts` (`extractVideoMetadata`, `matchRelinkFile`).
  3. Implement `src/store/useTimelineStore.ts` using `zustand` + `zundo` (temporal middleware). Include actions for track management, item updates, `splitItemAtPlayhead`, and `relinkAsset`.

### PHASE 3: Multi-Track Timeline UI

- **Goal:** Build interactive timeline components capable of scrubbing, dragging, trimming, and splitting.
- **Tasks:**
  1. Build `TimeRuler.tsx` and `Playhead.tsx` supporting pointer-based scrubbing.
  2. Build `TrackRow.tsx` (with Mute, Hide, Lock toggles) and `TimelineClip.tsx`.
  3. Implement pointer drag handlers on `TimelineClip.tsx` for moving (`start`), left-trimming (`start`, `duration`, `trimStart`), and right-trimming (`duration`).
  4. Style `'MISSING'` assets with a red warning pattern and build `RelinkBanner.tsx` for batch file relinking.

### PHASE 4: Real-Time Canvas Preview Engine

- **Goal:** Render the multi-layer composition at 60fps in 9:16 aspect ratio.
- **Tasks:**
  1. Build `src/core/canvas/syncEngine.ts` to manage off-screen `<video>` and `<audio>` elements synchronized to `currentTime`.
  2. Build `CanvasPreview.tsx` using `react-konva` (`Stage`, `Layer`, `Image`, `Text`, `Transformer`).
  3. Enable interactive dragging, scaling, and rotating of selected items directly on the Konva Stage, updating `x, y, scale, rotation` in `useTimelineStore`.

### PHASE 5: Web Worker FFmpeg Export Engine

- **Goal:** Render the final 1080x1920 `.mp4` file client-side without freezing the UI.
- **Tasks:**
  1. Implement `src/core/ffmpeg/commandBuilder.ts` to translate `tracks` into FFmpeg `-filter_complex` chains (`color` base, `trim`, `setpts`, `scale`, `overlay`, `drawtext`, `adelay`, `amix`).
  2. Implement `src/workers/export.worker.ts` to handle MEMFS read/write, FFmpeg execution, progress reporting, and strict memory cleanup.
  3. Implement `src/core/ffmpeg/ffmpegClient.ts` and `ExportModal.tsx` to connect IndexedDB blobs to the worker and trigger file download.

---

## 4. VERIFICATION CHECKLIST FOR AI AGENT

Before marking any phase complete, verify:

- [ ] Zero TypeScript compilation errors (`npm run build` / `tsc --noEmit`).
- [ ] `window.crossOriginIsolated === true` in browser runtime console.
- [ ] Refreshing the browser restores all media blobs from IndexedDB without network uploads.
- [ ] Splitting a video clip preserves frame continuity via accurate `trimStart` calculation.
- [ ] Exporting a multi-track project (Video + Overlay + Thai Text + Audio) produces a playable `.mp4` and leaves 0 residual files in FFmpeg MEMFS.
