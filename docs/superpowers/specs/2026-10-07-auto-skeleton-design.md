# Auto skeleton loader — design

Date: 2026-10-07
Package: `@devopsnext/starterkit-skeleton-loader` v0.1.0
Branch: `feat/auto-skeleton-v1` (library), `feat/auto-skeleton-loader` (template-starterkit-nextjs)

## Goal

A React library that draws a skeleton loading state shaped like the real UI, without
anyone hand-writing a placeholder. The idea comes from
[boneyard](https://github.com/0xGF/boneyard); this is React-only and renders its bones
with MUI's `<Skeleton>`.

Success means: the hand-written `SkeletonCard` in
`template-starterkit-nextjs/src/app/notification/all-accounts/page.jsx` is deleted and
replaced by the library, installed from a packed tarball, with the template's
`pnpm gates` and `pnpm build` still green.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Capture | Runtime DOM measurement in the browser | No CLI, no generated JSON, never stale. Works behind the template's OAuth login and with `output: 'export'`, where a Playwright crawl would have to authenticate first. |
| Bone rendering | `@mui/material` `<Skeleton>` | Requested. Colour, animation and dark mode come from the host's MUI theme. |
| Framework | React 18+ only | Requested. |
| Distribution | `pnpm pack` tarball, then npm | The template bans `link:` (two Reacts, broken Context identity) and documents the tarball flow. |

Build-time capture to `.bones.json` (boneyard's model) is out of scope. `extractBones`
is a pure function so a CLI can reuse it later.

## Public API

```tsx
import { AutoSkeleton } from "@devopsnext/starterkit-skeleton-loader";

<AutoSkeleton loading={isLoading} fixture={<AccountCard data={MOCK} />} name="account-card">
  {data && <AccountCard data={data} />}
</AutoSkeleton>
```

| Prop | Type | Default | Purpose |
|---|---|---|---|
| `loading` | `boolean` | required | Show the skeleton. |
| `children` | `ReactNode` | — | Real content. |
| `fixture` | `ReactNode` | — | Content measured while loading. Without it, `children` is measured. |
| `name` | `string` | — | Cache key. The last measured shape is reused when nothing measurable renders during a later load. |
| `animation` | `'pulse' \| 'wave' \| false` | `'pulse'` | Passed to MUI `<Skeleton>`. |
| `minHeight` | `number \| string` | — | Reserves space so an empty wrapper does not collapse to zero height. |
| `boneSx` | `SxProps<Theme>` | — | Applied to every bone, e.g. to recolour with a host token. |
| `sx`, `className` | — | — | Wrapper styling. |

Also exported: `extractBones(root, options?)`, the `Bone` type, `clearSkeletonCache()`.

DOM opt-outs, read by the extractor:

- `data-skeleton-ignore` — skip the element and its subtree.
- `data-skeleton-leaf` — treat the element as one bone, do not descend.
- `data-skeleton-variant="text|circular|rounded|rectangular"` — force the variant.

## Units

### `src/extract.ts` — `extractBones(root, options?) => Bone[]`

Pure DOM read; no React. Walks `root`'s descendants in document order.

```ts
type Bone = {
  kind: "bone" | "surface";
  variant: "text" | "circular" | "rounded" | "rectangular";
  x: number; y: number; width: number; height: number; // px from the origin's padding box
  radius: string;                                       // computed border-radius, "" if none
  surface?: SurfaceStyle; // kind === "surface": background colour/image, four borders, shadow
};
```

`options.origin` is the element coordinates are relative to (default `root`).

Rules, first match wins, applied per element:

1. **Skip the subtree** on `data-skeleton-ignore`, `display: none` or `opacity: 0`.
   `visibility: hidden` is *not* a skip reason — the component hides the measured
   content that way.
2. **`display: contents`** → descend, emit nothing (its own rect is empty).
3. **Forced leaf** — `img`, `svg`, `video`, `canvas`, `iframe`, `input`, `textarea`,
   `select`, `button`, or `data-skeleton-leaf` → one shape bone from
   `getBoundingClientRect()`.
4. **Text leaf** — has a non-whitespace direct text node and every element child is
   `display: inline`. With a visible surface (a chip or badge) → one shape bone.
   Otherwise one `text` bone per rendered line: `Range.getClientRects()`, merged into
   lines, clamped to the element's rect. A wrapped paragraph becomes several bars, each
   as wide as its line.
5. **Childless element** → a shape bone only when it has a visible surface or
   `::before` / `::after` content (icon fonts). An empty spacer emits nothing.
6. **Container with a visible surface** → a `surface` bone carrying the computed
   background, borders, radius and shadow, then descend. This is what keeps a card's
   frame on screen while its content is hidden.
7. **Other containers** → descend, emit nothing.

A visible surface is a non-transparent background colour, a background image, a painted
border side, or a box shadow. Shape variant: `circular` when the box is square within
1px and the radius is at least half its side; `rounded` when any corner radius is
non-zero; otherwise `rectangular`. Zero-area rects never emit a bone.

Surfaces are emitted before their children, so painting in array order layers correctly.

### `src/AutoSkeleton.tsx`

Wrapper: `position: relative`, `aria-busy={loading}`, `minHeight`. Inside it a content
element with `display: contents` always holds the children, so they lay out as direct
children of the wrapper and keep their state when `loading` flips.

While `loading`:

- **Content** is `fixture ?? children` with `visibility: hidden`, `inert` and
  `aria-hidden`. It still takes up its natural space, so the page does not shift when
  loading ends.
- **Overlay** is absolutely positioned over the wrapper, `pointer-events: none`.
  `surface` bones render as plain `<div>`s with the copied styles; `bone` bones render
  as MUI `<Skeleton>` at their measured position and size.

Measurement runs in `useLayoutEffect`, so on a client render the bones paint in the same
frame as the hidden content. A `ResizeObserver` on the wrapper re-measures on size
changes (coalesced to one per animation frame); this is why no breakpoint list is needed.

Fallback order: bones measured now → the cached snapshot for `name` (its height is
reserved too) → a single `rounded` `<Skeleton>` filling the wrapper. The single block is
also what server-rendered or statically exported HTML shows until hydration, because
layout cannot be measured at build time.

When `loading` is false the overlay is gone and `children` is visible. If `name` is set,
the loaded content is measured once and cached, so a later load with nothing to measure
still gets the real shape.

### `src/cache.ts`

In-memory `Map<string, SkeletonSnapshot>` (`{ bones, width, height }`) with `getSnapshot`,
`setSnapshot`, `clearSkeletonCache`. Lives for the page session.

## Package shape

Mirrors `starterkit-button-component`:

- `tsup` → ESM + CJS + `.d.ts`, `target: es2020`, `"use client"` banner on every chunk,
  no `treeshake: true` (it strips the banner).
- `external`: `react`, `react-dom`, `@mui/material`, `@emotion/react`, `@emotion/styled`.
- `peerDependencies`: `react >=18`, `react-dom >=18`, `@mui/material >=6`. No runtime
  dependencies. Ships no CSS.
- Strict TypeScript, same `tsconfig` flags as the button package.
- `files`: `dist`, `README.md`.
- Scripts: `build`, `dev`, `typecheck`, `test`, `test:browser`, `verify`.
- pnpm, with the same `allowBuilds: esbuild` workspace setting.

No Storybook in v0.1.0.

## Testing

jsdom has no layout engine, so the two layers test different things:

- **vitest + Testing Library (jsdom)** — variant classification, line merging, skip and
  opt-out rules with stubbed rects; component states (not loading, loading with bones,
  cache fallback, block fallback); `inert` / `aria-busy` / `aria-hidden` attributes.
- **Playwright (Chromium)** against a small Vite page in `demo/` — every bone lies
  within 1px of the element it stands for; a wrapped paragraph yields one bone per line;
  resizing the viewport moves the bones; the card surface is drawn; no layout shift
  between loading and loaded.

`pnpm verify` = typecheck + vitest + build. Playwright runs separately, as in the button
package.

## Template integration

On `feat/auto-skeleton-loader` in `template-starterkit-nextjs`:

1. `pnpm build && pnpm pack` in the library.
2. `pnpm add ./../starterkit-skeleton-loader/devopsnext-starterkit-skeleton-loader-0.1.0.tgz`.
3. Replace `SkeletonCard` in `notification/all-accounts/page.jsx` with `<AutoSkeleton>`
   wrapping the real account card, using a fixture.
4. Add a row to `TARGETS` in `scripts/check-package-tokens.mjs` with `alias: null` and a
   `why` (ships no CSS), following the `config-util` precedent.
5. Run `pnpm gates` and `pnpm build`; screenshot the loading and loaded states.

Gate failures are reported, not bypassed. The tarball dependency is a development
bridge; the exact registry pin replaces it after publish.

## Risks

- **Fixture required** where `children` renders nothing without data. Documented in the
  README; the `name` cache covers reloads.
- **First static paint** shows one block, not detailed bones, until hydration.
- **Bone colour** comes from the MUI theme and may not match the template's
  `--surface-elevated` token; `boneSx` is the override.
- **Cost** — one DOM walk per measure. Bounded to the wrapped subtree; re-measures are
  frame-coalesced.

## Out of scope

Build-time CLI and `.bones.json`, a Suspense wrapper, stagger and fade transitions,
frameworks other than React, npm publish.

## Changes since approval

The design above is what was approved on 2026-10-07. Building it and testing it on
real template screens changed it in these ways; `README.md` is the current reference.

- **CSS skeleton.** Statically exported HTML showed one block until hydration, which on
  a slow connection was the only skeleton anyone saw. Until the first measurement the
  content is now restyled into a skeleton with CSS. Adds `mode` and `boneColor`.
- **Animations are switched off in hidden content**, so an entrance animation starting at
  `opacity: 0` does not hide it from the measurement.
- **Extraction rules.** Table parts are always frames. A small painted box holding at
  most two pieces is one bone. Bones are cut to the nearest clipping ancestor. A text
  run containing an image, a control or a `data-skeleton-*` element is walked piece by
  piece. `url()` backgrounds are not repainted. Closed `<details>` bodies are skipped.
- **Fixture and children are separate elements**; the children stay mounted, hidden,
  while a fixture stands in.
- **The remembered shape** is looked up when measuring rather than during render (the
  server has no memory, so render-time lookup broke hydration), is only reused at the
  width it was learned at, and is learned after entrance animations finish.
- **Coordinates** are divided by the wrapper's transform scale.
- **Imports** come from the `@mui/material` root; MUI 6 deep imports fail in native
  Node ESM.
- **Captured shapes (the hybrid option).** Build-time capture was out of scope above; it
  is in now. Content that only exists after JavaScript has run leaves nothing in the HTML
  to measure or restyle, so a static export showed an empty space. `bin/auto-skeleton.mjs`
  captures named skeletons with Playwright into `<name>.bones.json`, and the `captured`
  prop draws them — fluid in width, chosen per viewport by media query, theme-neutral.
