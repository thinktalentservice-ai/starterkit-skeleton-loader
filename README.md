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
   **hidden and inert** — `visibility: hidden`, `inert`, `aria-hidden`. It still
   takes up its real space.
2. Its DOM is walked and turned into a flat list of bones: text becomes one bar
   per rendered line, images / buttons / inputs / avatars become one shape each,
   and a container that paints something (a card's background, border, shadow)
   has its frame repainted as-is.
3. The bones are drawn in an overlay on top, each a MUI `<Skeleton>`.

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
| `animation` | `"pulse" \| "wave" \| false` | `"pulse"` | Passed to MUI `<Skeleton>`. |
| `minHeight` | `number \| string` | | Reserves space for an empty wrapper. |
| `boneSx` | `SxProps<Theme>` | | Applied to every bone. |
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
<AutoSkeleton loading boneSx={{ bgcolor: "var(--surface-elevated)" }}>…</AutoSkeleton>
```

## Next.js and static export

The package is a client component (`"use client"` is in the build). It works
with `output: "export"` — nothing runs on a server.

One limit follows from measuring in the browser: layout does not exist at build
time, so prerendered HTML carries the single-block fallback, and the detailed
bones appear on hydration. Loading states that start on the client — a query
after mount, a route change, a refetch — get detailed bones in their first
frame.

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
