import { useCallback, useEffect, useLayoutEffect, useRef, useState, version } from "react";
import type { CSSProperties, ReactNode } from "react";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import { alpha, keyframes } from "@mui/material/styles";
import type { SxProps, Theme } from "@mui/material/styles";
import { getSnapshot, setSnapshot } from "./cache";
import { extractBones } from "./extract";
import type { Bone, SurfaceStyle } from "./types";

export type AutoSkeletonProps = {
  /** Show the skeleton instead of the content. */
  loading: boolean;
  /** The real content. */
  children?: ReactNode;
  /**
   * Content to shape the skeleton from while loading — the real component fed
   * placeholder data. Without it `children` is used, which only works if
   * `children` renders something before its data arrives.
   */
  fixture?: ReactNode;
  /**
   * Stable key for this skeleton. The last measured shape is remembered under
   * it and reused when a later load has nothing to measure.
   */
  name?: string;
  /**
   * `"measure"` (default) draws MUI `<Skeleton>` bones at measured positions;
   * until the first measurement — in server-rendered HTML, before hydration —
   * it draws the same skeleton with CSS alone. `"css"` stays on the CSS
   * skeleton and never measures.
   */
  mode?: "measure" | "css";
  /** Passed to every MUI `<Skeleton>`; `false` also stills the CSS skeleton. */
  animation?: "pulse" | "wave" | false;
  /** Reserves space so a wrapper with nothing in it does not collapse. */
  minHeight?: number | string;
  /** Bone colour, any CSS colour — e.g. `"var(--surface-elevated)"`. Defaults to MUI's. */
  boneColor?: string;
  /** Applied to every measured bone. Has no effect on the CSS skeleton. */
  boneSx?: SxProps<Theme>;
  sx?: SxProps<Theme>;
  className?: string;
};

// useLayoutEffect warns during server rendering; nothing can be measured there anyway.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const sameBones = (a: Bone[] | null, b: Bone[]) => a === b || JSON.stringify(a) === JSON.stringify(b);

// React 19 made `inert` a boolean prop and reads the `inert=""` spelling as
// false; React 18 only understands that spelling. A prop rather than an effect,
// so it is already in server-rendered HTML.
const INERT = (Number.parseInt(version, 10) >= 19 ? { inert: true } : { inert: "" }) as object;

// margin/padding are reset because the overlay is a child of the wrapper, and
// host rules like Bootstrap's `.row > *` would otherwise pad it.
const OVERLAY_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  margin: 0,
  padding: 0,
  overflow: "hidden",
  pointerEvents: "none",
};

const BLOCK_STYLE: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };

const BONE = "var(--auto-skeleton-bone)";

/** MUI Skeleton's own background, so CSS bones and MUI bones are one colour. */
function muiBoneColor(theme: Theme): string {
  const fromVars = (theme as { vars?: { palette?: { Skeleton?: { bg?: string } } } }).vars?.palette?.Skeleton?.bg;
  if (fromVars) return fromVars;
  try {
    return alpha(theme.palette.text.primary, theme.palette.mode === "light" ? 0.11 : 0.13);
  } catch {
    // text.primary in a format alpha() cannot parse, e.g. a bare var().
    return "rgba(128, 128, 128, 0.2)";
  }
}

const CONTENT = "& > [data-auto-skeleton-content]";

// Entrance animations usually start at `opacity: 0` and offset by a transform,
// so a measurement taken on the first frame finds nothing, or finds it in the
// wrong place. Nobody can see hidden content animate; switching animation off
// puts it in its resting layout immediately.
const HIDDEN = `${CONTENT}[aria-hidden="true"]`;
const SETTLE_HIDDEN_CONTENT = {
  [`${HIDDEN} *, ${HIDDEN} *::before, ${HIDDEN} *::after`]: {
    animation: "none !important",
    transition: "none !important",
  },
};

/* ── The CSS skeleton ──────────────────────────────────────────────────────
   Server-rendered HTML already contains the content; what it cannot contain is
   a measurement, because there is no layout at build time. Until JavaScript
   has measured, the content itself is restyled into a skeleton instead:

     · every colour goes transparent, so only frames (cards, panels) stay;
     · text is struck through with a line as thick as a bone — a strike follows
       the text exactly, so each rendered line gets a bar as wide as its words;
     · images, controls and `data-skeleton-leaf` boxes are filled bone-colour.

   None of these properties affect layout, so the page does not move when the
   measured skeleton takes over. Keep SHAPES in step with FORCED_LEAF_TAGS in
   extract.ts. */
const CSS_MODE = `${CONTENT}[data-auto-skeleton-css]`;
const SHAPES = "img, svg, video, canvas, iframe, input, textarea, select, button, [data-skeleton-leaf]";
const PHRASING = "a, abbr, b, br, code, em, i, kbd, mark, s, small, span, strong, sub, sup, time, u, wbr";
// An element whose descendants, if any, are all inline phrasing: a run of text.
const TEXT = `:not(${SHAPES}):not(:has(:not(${PHRASING})))`;

const pulse = keyframes`
  0% { opacity: 1; }
  50% { opacity: 0.4; }
  100% { opacity: 1; }
`;

function cssSkeleton(animated: boolean) {
  const animation = animated ? `${pulse} 2s ease-in-out 0.5s infinite !important` : "none !important";
  return {
    [`${CSS_MODE}, ${CSS_MODE} *`]: {
      color: "transparent !important",
      textShadow: "none !important",
      pointerEvents: "none !important",
      userSelect: "none",
    },
    [`${CSS_MODE} ::placeholder`]: { color: "transparent !important" },
    [`${CSS_MODE} ${TEXT}`]: {
      textDecorationLine: "line-through !important",
      textDecorationStyle: "solid !important",
      textDecorationColor: `${BONE} !important`,
      textDecorationThickness: "0.7em !important",
      textDecorationSkipInk: "none",
      animation,
    },
    // The strike on a run already covers its inline children; a second one on
    // top would darken wherever the bone colour is translucent.
    [`${CSS_MODE} ${TEXT} :is(${PHRASING})`]: {
      textDecorationLine: "none !important",
      animation: "none !important",
    },
    [`${CSS_MODE} :is(${SHAPES})`]: {
      backgroundColor: `${BONE} !important`,
      backgroundImage: "none !important",
      borderColor: "transparent !important",
      boxShadow: "none !important",
      // Slides the picture of an <img>/<video> out of its box, leaving the fill.
      objectPosition: "-99999px -99999px !important",
      animation,
    },
    [`${CSS_MODE} :is(${SHAPES}) *, ${CSS_MODE} [data-skeleton-ignore]`]: {
      visibility: "hidden !important",
    },
    // With content to restyle, the block fallback in the overlay is not needed.
    [`${CSS_MODE}:not(:empty) + [data-auto-skeleton-overlay]`]: { display: "none" },
  };
}

function boneStyle(bone: Bone): CSSProperties {
  const style: CSSProperties = {
    position: "absolute",
    left: bone.x,
    top: bone.y,
    width: bone.width,
    height: bone.height,
  };
  if (bone.kind === "surface") {
    style.boxSizing = "border-box";
    if (bone.radius) style.borderRadius = bone.radius;
    for (const [property, value] of Object.entries(bone.surface ?? {})) {
      if (value) style[property as keyof SurfaceStyle] = value;
    }
  } else if (bone.variant === "rounded" && bone.radius) {
    // MUI's `rounded` uses the theme radius; the real element's is more faithful.
    style.borderRadius = bone.radius;
  }
  return style;
}

/**
 * Shows a skeleton shaped like the content it wraps.
 *
 * While `loading`, the content (or `fixture`) is rendered inert, its DOM is
 * measured, and a MUI `<Skeleton>` is drawn over every piece of it. Before the
 * first measurement the same content is restyled into a skeleton with CSS, so
 * server-rendered HTML shows the right shape without waiting for JavaScript.
 */
export function AutoSkeleton({
  loading,
  children,
  fixture,
  name,
  mode = "measure",
  animation = "pulse",
  minHeight,
  boneColor,
  boneSx,
  sx,
  className,
}: AutoSkeletonProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // null = not measured yet, which is the state server-rendered HTML is in.
  const [measured, setMeasured] = useState<Bone[] | null>(null);
  const measures = mode === "measure";

  /** Reads the current shape and remembers it under `name`. */
  const read = useCallback((): Bone[] => {
    const root = rootRef.current;
    const content = contentRef.current;
    if (!root || !content) return [];
    const bones = extractBones(content, { origin: root });
    if (name && bones.length > 0) {
      setSnapshot(name, { bones, width: root.clientWidth, height: root.clientHeight });
    }
    return bones;
  }, [name]);

  const measure = useCallback(() => {
    const next = read();
    setMeasured((previous) => (sameBones(previous, next) ? previous : next));
  }, [read]);

  // No dependency list on purpose. Content can change shape on any commit
  // without the wrapper resizing; `measure` only sets state when bones differ,
  // so this settles after one extra render at most.
  useIsomorphicLayoutEffect(() => {
    if (loading && measures) measure();
  });

  // Layout changes that arrive without a React commit.
  useEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    if (!loading || !measures || !root || !content) return;

    let frame = 0;
    let active = true;
    const schedule = () => {
      if (!active) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(root);
    window.addEventListener("resize", schedule);
    // `load` does not bubble; capture catches images sizing themselves late.
    content.addEventListener("load", schedule, true);
    // Web fonts swap in after first paint and change every text width.
    void document.fonts?.ready.then(schedule);

    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      content.removeEventListener("load", schedule, true);
      cancelAnimationFrame(frame);
    };
  }, [loading, measures, measure]);

  // Learn the loaded shape so a later load with nothing to measure can use it.
  useEffect(() => {
    if (!loading && measures && name) read();
  }, [loading, measures, name, read]);

  const hasMeasured = measures && measured !== null && measured.length > 0;
  const snapshot = loading && measures && !hasMeasured && name ? getSnapshot(name) : undefined;
  const bones = hasMeasured ? measured : (snapshot?.bones ?? []);
  // Nothing measured and nothing remembered: restyle the content itself.
  const cssSkeletonOn = loading && (!measures || (measured === null && !snapshot));
  const measuredBoneSx = [
    boneColor ? { bgcolor: boneColor } : null,
    ...(Array.isArray(boneSx) ? boneSx : [boneSx]),
  ];

  return (
    <Box
      ref={rootRef}
      className={className}
      data-auto-skeleton=""
      aria-busy={loading || undefined}
      sx={[
        (theme) => ({
          position: "relative",
          minHeight: snapshot?.height ?? minHeight,
          "--auto-skeleton-bone": boneColor ?? muiBoneColor(theme),
        }),
        SETTLE_HIDDEN_CONTENT,
        cssSkeleton(animation !== false),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {/* Always present, so children keep their state when `loading` flips.
          `display: contents` keeps them laid out as direct children of the wrapper. */}
      <div
        ref={contentRef}
        data-auto-skeleton-content=""
        data-auto-skeleton-css={cssSkeletonOn ? "" : undefined}
        aria-hidden={loading || undefined}
        {...(loading ? INERT : null)}
        style={{ display: "contents", visibility: loading && !cssSkeletonOn ? "hidden" : undefined }}
      >
        {loading ? (fixture ?? children) : children}
      </div>
      {loading && (
        <div data-auto-skeleton-overlay="" aria-hidden style={OVERLAY_STYLE}>
          {bones.length === 0 ? (
            <Skeleton variant="rounded" animation={animation} sx={measuredBoneSx} style={BLOCK_STYLE} />
          ) : (
            bones.map((bone, index) =>
              bone.kind === "surface" ? (
                <div key={index} data-auto-skeleton-surface="" style={boneStyle(bone)} />
              ) : (
                <Skeleton
                  key={index}
                  variant={bone.variant}
                  animation={animation}
                  sx={measuredBoneSx}
                  style={boneStyle(bone)}
                />
              ),
            )
          )}
        </div>
      )}
    </Box>
  );
}
