# @devopsnext/starterkit-skeleton-loader

Auto skeleton loader for React. Wrap a component, and while it loads you get a
skeleton shaped like the real thing — measured from the DOM at runtime and drawn
with MUI's `<Skeleton>`. No hand-written placeholders to keep in sync.

```tsx
import { AutoSkeleton } from "@devopsnext/starterkit-skeleton-loader";

<AutoSkeleton loading={isLoading} fixture={<AccountCard account={PLACEHOLDER} />}>
  {account && <AccountCard account={account} />}
</AutoSkeleton>
```

The idea comes from [boneyard](https://github.com/0xGF/boneyard). This package
is React-only and measures in the browser first, so most screens need no build
step and nothing that can go stale. For content that only exists after
JavaScript has run it can also do what boneyard does — capture the shape with a
command and ship it in the HTML.

## Install

```bash
pnpm add @devopsnext/starterkit-skeleton-loader
```

Peer dependencies: `react >=18`, `react-dom >=18`, `@mui/material >=6` (and the
Emotion packages MUI itself needs). The package ships no CSS; bone colour,
animation and dark mode come from your MUI theme.

## How it works

While `loading` is true:

1. The content (`fixture`, or `children` if there is no fixture) is rendered
   **inert** — `inert`, `aria-hidden`. It still takes up its real space.
2. **Before any JavaScript has measured** — in server-rendered or statically
   exported HTML, until hydration — the content itself is restyled into a
   skeleton with CSS: colours go transparent, text is struck through with a
   bone-thick line that follows each rendered line, and images, controls and
   `data-skeleton-leaf` boxes are filled bone-colour. Card frames stay as they
   are. Nothing in this step changes layout.
3. **Once it can measure**, the content is hidden and its DOM is walked into a
   flat list of bones: text becomes one bar per rendered line, images / buttons
   / inputs / avatars become one shape each, and a container that paints
   something (a card's background, border, shadow) has its frame repainted.
4. The bones are drawn in an overlay on top, each a MUI `<Skeleton>`.

It re-measures when the wrapper resizes, when the window resizes, when an image
inside finishes loading, and when web fonts arrive — so it is responsive without
a breakpoint list.

## Props

| Prop | Type | Default | |
|---|---|---|---|
| `loading` | `boolean` | required | Show the skeleton. |
| `children` | `ReactNode` | | The real content. |
| `fixture` | `ReactNode` | | Content to measure while loading. |
| `name` | `string` | | Remembers the last measured shape under this key; also how the capture command finds the wrapper. |
| `captured` | `CapturedSkeleton` | | A shape captured ahead of time — the imported `.bones.json`. |
| `mode` | `"measure" \| "css"` | `"measure"` | `"css"` stays on the CSS skeleton and never measures. |
| `animation` | `"pulse" \| "wave" \| false` | `"pulse"` | Passed to MUI `<Skeleton>`. The CSS skeleton pulses unless `false`. |
| `minHeight` | `number \| string` | | Reserves space for an empty wrapper. |
| `boneColor` | `string` | MUI's | Bone colour for both skeletons, e.g. `"var(--surface-elevated)"`. |
| `boneSx` | `SxProps<Theme>` | | Applied to every measured bone only. |
| `sx`, `className` | | | Applied to the wrapper. |

The wrapper is one `position: relative` element. Your content is laid out as its
direct children, so `className="grid"` or `sx={{ display: "flex" }}` on
`AutoSkeleton` behaves as if you had put it on a plain `<div>`.

One exception: CSS child selectors do not see through it. Bootstrap's
`.row > *` gutters are the usual case — wrap the row, do not replace it:

```tsx
<AutoSkeleton loading={isLoading} fixture={<Row>{placeholders}</Row>}>
  <Row>{cards}</Row>
</AutoSkeleton>
```

## Giving it something to measure

A skeleton can only be shaped like content that exists. Pick whichever fits:

**A fixture** — the real component with placeholder data. Best result, works on
the very first load.

```tsx
<AutoSkeleton loading={isLoading} fixture={<UserRow user={{ name: "Placeholder name", role: "Role" }} />}>
  {user && <UserRow user={user} />}
</AutoSkeleton>
```

For a list, render the fixture as many times as you expect rows.

The fixture and the children are separate instances, even when they are the
same component. The children stay mounted while the fixture stands in for them
(hidden with `display: none`), so their state survives a reload — and their
effects run during loading, as they would without the wrapper.

**Children that already render** — if the component draws its layout before its
data arrives, no fixture is needed.

**A `name`** — the shape of the loaded content is remembered for the page
session, once its entrance animations have finished. The first load has nothing
to go on; a later one (a refetch, coming back to the route) gets the real shape,
provided the wrapper is the same width it was learned at.

```tsx
<AutoSkeleton loading={isLoading} name="invoice-table" minHeight={240}>
  {rows && <InvoiceTable rows={rows} />}
</AutoSkeleton>
```

**A captured shape** — for content that does not exist until JavaScript has run
(a table built from the live theme, a chart, anything behind `useEffect`). There
is nothing in the HTML to measure or restyle, so on a slow connection the page
is empty until the bundle arrives. Capture the shape once and ship it:

```tsx
import tableBones from "@/skeletons/orders.bones.json";

<AutoSkeleton loading={!ready} name="orders" captured={tableBones}>
  {ready ? <OrdersTable /> : null}
</AutoSkeleton>
```

```bash
pnpm auto-skeleton --url http://localhost:3000/orders --out src/skeletons
```

The command opens the page at each viewport width, finds every
`<AutoSkeleton name="…">` that has finished loading, measures it, and writes
`<name>.bones.json`. See [Capturing](#capturing).

If none of these apply, a single rounded block fills the wrapper — give it a
`minHeight`, because an empty wrapper is zero pixels tall.

When more than one applies, the most exact wins: a measurement, then a shape
remembered under `name`, then a captured one, then the block.

## Steering the result

Put these attributes on elements inside the content:

| Attribute | Effect |
|---|---|
| `data-skeleton-ignore` | Skip this element and everything in it. |
| `data-skeleton-leaf` | Draw this element as one bone; do not look inside. |
| `data-skeleton-variant="text\|circular\|rounded\|rectangular"` | Force the MUI variant. |

To recolour the bones with a design token:

```tsx
<AutoSkeleton loading boneColor="var(--surface-elevated)">…</AutoSkeleton>
```

## Next.js and static export

The package is a client component (`"use client"` is in the build). It works
with `output: "export"` — nothing runs on a server.

Layout does not exist at build time, so prerendered HTML cannot carry measured
bones. It carries the content instead, restyled by the CSS skeleton — which is
what a visitor on a slow connection looks at until the JavaScript arrives. This
matters most for pages whose loading state ends at hydration (data read from
`localStorage` in an effect, say): there the CSS skeleton is the only one
anybody sees.

The CSS skeleton is an approximation of the measured one:

- A painted box with no children (an avatar `<div>` with a background) keeps its
  own colour. Add `data-skeleton-leaf` to make it a bone.
- Text mixed with non-inline children (`<div>Label <svg/></div>`) gets no bar
  for the loose text.
- Text inside an `inline-block`, `inline-flex` or floated child of a paragraph
  gets no bar.
- `boneSx` does not reach it; use `boneColor`.
- It needs `:has()` — every current browser, none before 2023.

Set `mode="css"` to use it everywhere and skip measuring altogether.

## Capturing

```
auto-skeleton --url <url> [--url <url> …] [options]

  --out <dir>            Where to write <name>.bones.json   (default: src/skeletons)
  --breakpoints <list>   Viewport widths, comma separated   (default: 375,768,1280)
  --name <name>          Only capture this skeleton; repeatable
  --wait <ms>            Extra time to wait after load      (default: 1000)
  --max-height <px>      Capture no further down than this  (default: 1200)
  --color-scheme <s>     light | dark | no-preference
  --storage-state <file> Playwright storage state, for pages behind a login
```

It needs Playwright (`playwright` or `@playwright/test`) in the project that
runs it, and the app running. Each wrapper needs a `name` and must be showing
its real content when the page settles; one still loading is reported, not
silently skipped.

What a capture is, and is not:

- **It is a file you commit and re-run**, not something kept in step
  automatically. After a layout change the old capture is a slightly wrong
  placeholder until the command is run again.
- **It stretches.** Horizontal positions are a share of the captured width, so
  a capture taken in a 992px wrapper fills a 1160px one. Circles keep their
  size. Which capture shows is chosen by media query: the widest breakpoint not
  wider than the viewport.
- **It reserves its height** while the wrapper is otherwise empty, so the page
  does not jump when the real content arrives.
- **It carries no colours.** Frames are redrawn as outlines in the bone colour,
  so one capture serves light and dark themes.
- **It costs bytes.** Every breakpoint is in the HTML. A card is a few hundred
  bytes; a dense data table can be tens of kilobytes — lower `--max-height` to
  capture only what is above the fold.

## What becomes what

The measured skeleton follows a few rules, tuned on real screens (cards, a form
page, a MUI data table):

| In the content | In the skeleton |
|---|---|
| Text | One bar per rendered line, as wide as the words. |
| `img`, `svg`, `button`, `input`, `select`, `textarea`, `video`, `canvas`, `iframe` | One bone the size of the element. |
| A small painted box (up to 160 × 64px) holding at most two pieces — avatar, chip, badge, icon button | One bone. Repainting it in its own colour would look like live UI. |
| Any other box with a background, border or shadow — card, panel, toolbar | Its frame, repainted as it is, with its content drawn inside. |
| A table cell | Always a frame around its content, never a bone. |
| An empty box that paints nothing | Nothing. |

Content cut off by an ancestor's `overflow` is cut off in the skeleton too:
rows scrolled out of a table are not drawn, and a square header inside a
rounded `overflow: hidden` card gets the card's corners.

## Things to know

- **Animations are off while content is hidden.** An entrance animation that
  starts at `opacity: 0` would otherwise hide the content from the measurement.
  They run normally once loading ends.
- **`opacity: 0` content gets no bone.** Add `data-skeleton-leaf` to its
  container if you want one there, e.g. around an image that fades in on load.
- **The fixture really renders.** Its effects run and its images load. Feed it
  static placeholder data, not a component that fetches.
- **`visibility: hidden` in your own content is not skipped.** That is how the
  measured content is hidden, so the two cannot be told apart. Use
  `data-skeleton-ignore`.
- **Text bones follow the fixture's text.** A longer placeholder name gives a
  wider bar. Choose placeholder copy of typical length.
- **Shadow DOM and `<iframe>` contents** are not walked; an iframe is one bone.
- **A descendant with its own `visibility: visible`** shows through the measured
  skeleton, because the content is hidden with an inherited `visibility: hidden`.
- **Scaled ancestors are handled, rotated or skewed ones are not.** Bones are
  axis-aligned boxes.
- **Focus is not managed.** If focus is inside the content when `loading` turns
  true, it falls back to `<body>`; move it yourself if that matters.
- **Nothing announces the loading state.** The wrapper sets `aria-busy`; add your
  own live region if a screen-reader announcement is needed.
- **`mode="css"` cannot fall back to the block** when the content renders
  elements with nothing drawable in them (an empty `<ul>`): it never measures,
  so it cannot tell.

## Lower-level API

```ts
import { extractBones, clearSkeletonCache, type Bone } from "@devopsnext/starterkit-skeleton-loader";

const bones: Bone[] = extractBones(element);            // pure DOM read
const relative = extractBones(element, { origin: container });
clearSkeletonCache();                                    // forget every `name`
```

## Development

```bash
pnpm install
pnpm verify          # typecheck + unit tests + build
pnpm test:browser    # Playwright against demo/, real layout
pnpm demo            # http://localhost:5179  (?loading=0, ?mode=css, ?fixture=0&captured=1, …)
pnpm capture:demo    # with the demo running: rewrite demo/accounts.bones.json
```

Unit tests run in jsdom, which has no layout engine, so they check the
extraction rules against declared geometry. Whether a bone lands on its element
is checked in a real browser by the specs in `tests/`.

To try a build in an app, pack it — do not `link:` it, which gives the app a
second copy of React and of MUI's theme context:

```bash
pnpm build && pnpm pack
# in the app
pnpm add ../starterkit-skeleton-loader/devopsnext-starterkit-skeleton-loader-0.1.0.tgz
```

## License

MIT
