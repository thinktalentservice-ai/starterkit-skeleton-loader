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
is React-only and measures in the browser instead of at build time, so there is
no CLI, no generated files, and nothing to go stale.

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
| `name` | `string` | | Remembers the last measured shape under this key. |
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

**Children that already render** — if the component draws its layout before its
data arrives, no fixture is needed.

**A `name`** — the shape of the loaded content is remembered for the page
session. The first load has nothing to go on; every later one (a refetch, coming
back to the route) gets the real shape.

```tsx
<AutoSkeleton loading={isLoading} name="invoice-table" minHeight={240}>
  {rows && <InvoiceTable rows={rows} />}
</AutoSkeleton>
```

If none of these apply, a single rounded block fills the wrapper — give it a
`minHeight`, because an empty wrapper is zero pixels tall.

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
- `boneSx` does not reach it; use `boneColor`.
- It needs `:has()` — every current browser, none before 2023.

Set `mode="css"` to use it everywhere and skip measuring altogether.

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
pnpm demo            # http://localhost:5179  (?loading=0, ?anim=wave, ?spacer=1)
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
