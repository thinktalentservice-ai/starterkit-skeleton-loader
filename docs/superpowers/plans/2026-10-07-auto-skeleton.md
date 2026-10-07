# Auto Skeleton Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@devopsnext/starterkit-skeleton-loader` 0.1.0 — an `<AutoSkeleton>` React component that measures real DOM at runtime and draws MUI `<Skeleton>` bones over it — and prove it in `template-starterkit-nextjs` from a tarball.

**Architecture:** A pure DOM walker (`extractBones`) turns a subtree into a flat `Bone[]`. `AutoSkeleton` renders the content hidden and inert, runs the walker in a layout effect and on resize, and paints the bones in an absolutely positioned overlay. A small in-memory cache keyed by `name` remembers the last shape.

**Tech Stack:** TypeScript (strict), React 19 (peer `>=18`), `@mui/material` 9 (peer `>=6`), tsup, vitest + Testing Library (jsdom), Playwright (Chromium) against a Vite demo page, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-07-auto-skeleton-design.md`

## Global Constraints

- Package name `@devopsnext/starterkit-skeleton-loader`, version `0.1.0`, MIT, `"type": "module"`.
- `peerDependencies`: `react >=18`, `react-dom >=18`, `@mui/material >=6`. No `dependencies`. Ships no CSS.
- tsup: ESM + CJS + `.d.ts`, `target: es2020`, `banner: '"use client";'`, never `treeshake: true`.
- `files`: `dist`, `README.md`.
- tsconfig flags identical to `starterkit-button-component/tsconfig.json`.
- `inert` is set with `toggleAttribute`, never as a JSX prop: React 18 ignores the boolean and React 19 treats `""` as false.
- Template side: tarball install only, never `link:`. Gate failures are reported, not bypassed.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Content inside `display: contents` wrappers** — their rect is zero-area; the walker must descend, not skip. (Task 3 test.)
2. **Wrapper with a border or scrolled page** — bone coordinates must be relative to the origin's padding box via rect deltas minus `clientLeft/Top`, not `offsetLeft`. (Task 3 test, Task 5 browser test with a scrolled page.)
3. **Text that overflows its box** (`text-overflow: ellipsis`) — line bones are clamped to the element's rect. (Task 3 test.)
4. **Children that render nothing while loading and no fixture** — block fallback fills the wrapper; with a `name` seen before, the cached shape and its height are used. (Task 4 tests.)
5. **Unmount or `loading` flip while a resize frame is pending** — observer disconnected, frame cancelled, no state update after unmount. (Task 4 test.)

---

## File map

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `pnpm-workspace.yaml` | Build and test tooling, mirrored from the button package. |
| `src/types.ts` | `Bone`, `BoneVariant`, `SurfaceStyle`, `SkeletonSnapshot`. |
| `src/cache.ts` | `getSnapshot`, `setSnapshot`, `clearSkeletonCache`. |
| `src/extract.ts` | `extractBones`, `mergeLines`. |
| `src/AutoSkeleton.tsx` | The component. |
| `src/index.ts` | Public exports. |
| `src/*.test.ts(x)`, `src/test-setup.ts` | jsdom tests. |
| `demo/index.html`, `demo/main.tsx`, `vite.config.ts` | Browser harness. |
| `tests/auto-skeleton.spec.ts`, `playwright.config.ts`, `tsconfig.playwright.json` | Real-layout tests. |
| `README.md`, `.github/workflows/ci.yml` | Docs and CI. |

## Shared interfaces

```ts
// src/types.ts
export type BoneVariant = "text" | "circular" | "rounded" | "rectangular";
export type SurfaceStyle = {
  backgroundColor: string; backgroundImage: string;
  borderTop: string; borderRight: string; borderBottom: string; borderLeft: string;
  boxShadow: string;
};
export type Bone = {
  kind: "bone" | "surface";
  variant: BoneVariant;
  x: number; y: number; width: number; height: number; // px from origin's padding box
  radius: string;                                       // "" when none
  surface?: SurfaceStyle;                               // kind === "surface"
};
export type SkeletonSnapshot = { bones: Bone[]; width: number; height: number };

// src/cache.ts
export function getSnapshot(name: string): SkeletonSnapshot | undefined;
export function setSnapshot(name: string, snapshot: SkeletonSnapshot): void;
export function clearSkeletonCache(): void;

// src/extract.ts
export type ExtractOptions = { origin?: Element };
export function extractBones(root: Element, options?: ExtractOptions): Bone[];
export type LineRect = { left: number; top: number; right: number; bottom: number };
export function mergeLines(rects: LineRect[]): LineRect[];
```

---

### Task 1: Scaffold

**Files:** create `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `pnpm-workspace.yaml`, `src/index.ts`, `src/types.ts`, `src/test-setup.ts`; modify `.gitignore`.

- [ ] Write the config files, mirroring the button package; add `*.tgz`, `test-results`, `.pnpm-store` to `.gitignore`.
- [ ] `src/types.ts` with the shared types above; `src/index.ts` re-exports them.
- [ ] `pnpm install`, then `pnpm typecheck` and `pnpm build` — both exit 0, `dist/index.js` starts with `"use client";`.
- [ ] Commit `chore: scaffold package`.

### Task 2: Cache

**Files:** `src/cache.ts`, `src/cache.test.ts`. **Produces:** `getSnapshot`, `setSnapshot`, `clearSkeletonCache`.

- [ ] Failing tests: unknown name → `undefined`; set then get returns the snapshot; a second set replaces; `clearSkeletonCache()` empties.
- [ ] Implement over a module-level `Map`.
- [ ] `pnpm test` passes. Commit `feat: add snapshot cache`.

### Task 3: Extractor

**Files:** `src/extract.ts`, `src/extract.test.ts`. **Consumes:** types. **Produces:** `extractBones`, `mergeLines`.

Rules (first match wins, per element):

1. `data-skeleton-ignore`, `display: none`, or `opacity: 0` → skip subtree.
2. `display: contents` → descend, emit nothing.
3. Forced leaf — `img`, `svg`, `video`, `canvas`, `iframe`, `input`, `textarea`, `select`, `button`, or `data-skeleton-leaf` → one shape bone.
4. Text leaf — has a non-whitespace direct text node and every element child computes to `display: inline`. With a visible surface → one shape bone (chips, badges). Otherwise one `text` bone per line: `Range.getClientRects()` → `mergeLines` → clamp to the element rect. Falls back to the element rect when `Range.getClientRects` is unavailable.
5. Childless element — shape bone only if it has a visible surface or `::before`/`::after` content (icon fonts); otherwise nothing.
6. Container with a visible surface → `surface` bone, then descend.
7. Other container → descend.

Zero-area rects never emit a bone. Shape variant: `circular` when square within 1px and radius ≥ half the side; `rounded` when any corner radius is non-zero; else `rectangular`. `data-skeleton-variant` overrides. Visible surface = non-transparent `background-color`, a `background-image`, a painted border side, or a `box-shadow`.

- [ ] Failing tests for `mergeLines`: empty input; two rects on one line union; two lines stay separate and sorted by top; zero-width rects dropped.
- [ ] Failing tests for `extractBones` with stubbed `getBoundingClientRect` / `Range.prototype.getClientRects`: each rule above; variant classification; `data-skeleton-variant`; origin with `clientLeft/Top` offset; `display: contents` descent; ellipsis clamp; surface emitted before its children.
- [ ] Implement; `pnpm test` passes. Commit `feat: add DOM bone extractor`.

### Task 4: Component

**Files:** `src/AutoSkeleton.tsx`, `src/AutoSkeleton.test.tsx`, `src/index.ts`. **Consumes:** `extractBones`, cache. **Produces:** `AutoSkeleton`, `AutoSkeletonProps`.

Structure — the content wrapper is always present so children keep their state across the loading flip:

```tsx
<Box ref={rootRef} data-auto-skeleton="" aria-busy={loading || undefined}
     className={className} sx={[{ position: "relative", minHeight }, ...sx]}>
  <div ref={contentRef} data-auto-skeleton-content=""
       aria-hidden={loading || undefined}
       style={{ display: "contents", visibility: loading ? "hidden" : undefined }}>
    {loading ? (fixture ?? children) : children}
  </div>
  {loading && <div data-auto-skeleton-overlay="" aria-hidden
       style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
    {/* surface → <div>, bone → <Skeleton>, none → one rounded <Skeleton> filling the overlay */}
  </div>}
</Box>
```

Behaviour: measure in a layout effect on every commit while loading (state only updates when the bones differ); `ResizeObserver` on the root re-measures once per animation frame; `inert` toggled on the content wrapper; bones = measured → `getSnapshot(name)` (also applying its height as `minHeight`) → block fallback. When loaded and `name` is set, the loaded content is measured once and stored with `setSnapshot`.

- [ ] Failing tests: not loading → children visible, no overlay, no `aria-busy`; loading → `aria-busy`, content `aria-hidden` + `inert` + hidden, one `.MuiSkeleton-root` per bone at the stubbed geometry; `fixture` rendered instead of children while loading; surface bone rendered as a non-Skeleton div with copied styles; nothing measurable → single block Skeleton; cached snapshot used when nothing measurable and `name` known; `animation="wave"` and `boneSx` reach the bones; unmount disconnects the observer and cancels the frame.
- [ ] Implement; export from `src/index.ts`; `pnpm verify` passes. Commit `feat: add AutoSkeleton component`.

### Task 5: Browser harness

**Files:** `demo/index.html`, `demo/main.tsx`, `vite.config.ts`, `playwright.config.ts`, `tsconfig.playwright.json`, `tests/auto-skeleton.spec.ts`.

- [ ] Demo page: a card (surface) with a round avatar, a heading, a paragraph that wraps, an image and a button; `?loading=0` shows it loaded.
- [ ] Specs: every non-text bone within 1px of its element; paragraph yields one bone per rendered line; card surface drawn with the card's radius; bones follow a viewport resize; bones correct on a scrolled page; wrapper box identical between loading and loaded.
- [ ] `pnpm test:browser` passes. Commit `test: add browser layout specs`.

### Task 6: Docs, CI, pack

**Files:** `README.md`, `.github/workflows/ci.yml`.

- [ ] README: install, usage, props table, DOM opt-outs, fixture guidance, static-export note, limits.
- [ ] CI: install, `pnpm verify`, install Chromium, `pnpm test:browser`.
- [ ] `pnpm verify && pnpm pack`; inspect the tarball's file list — `dist/*`, `README.md`, `LICENSE`, `package.json` only. Commit `docs: add README and CI`.

### Task 7: Template integration

**Repo:** `template-starterkit-nextjs`, branch `feat/auto-skeleton-loader`.

- [ ] `pnpm add ./../starterkit-skeleton-loader/devopsnext-starterkit-skeleton-loader-0.1.0.tgz`.
- [ ] `src/app/notification/all-accounts/page.jsx`: delete `SkeletonCard`; render the real card with fixture accounts inside `<AutoSkeleton>` while loading.
- [ ] `scripts/check-package-tokens.mjs`: add a `TARGETS` row, `alias: null`, with a `why`.
- [ ] `pnpm gates`, `pnpm build`; screenshot loading and loaded in a browser. Report any gate that objects to the tarball pin.
- [ ] Commit `feat: use auto skeleton loader on all-accounts`.
