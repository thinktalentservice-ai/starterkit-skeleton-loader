import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
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
   * Content to measure while loading — the real component fed placeholder data.
   * Without it `children` is measured, which only works if `children` renders
   * something before its data arrives.
   */
  fixture?: ReactNode;
  /**
   * Stable key for this skeleton. The last measured shape is remembered under
   * it and reused when a later load has nothing to measure.
   */
  name?: string;
  /** Passed to every MUI `<Skeleton>`. */
  animation?: "pulse" | "wave" | false;
  /** Reserves space so a wrapper with nothing in it does not collapse. */
  minHeight?: number | string;
  /** Applied to every bone, e.g. `{ bgcolor: "var(--surface-elevated)" }`. */
  boneSx?: SxProps<Theme>;
  sx?: SxProps<Theme>;
  className?: string;
};

const NO_BONES: Bone[] = [];

// useLayoutEffect warns during server rendering; nothing can be measured there anyway.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const sameBones = (a: Bone[], b: Bone[]) => a === b || JSON.stringify(a) === JSON.stringify(b);

const OVERLAY_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  overflow: "hidden",
  pointerEvents: "none",
};

const BLOCK_STYLE: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };

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
 * While `loading`, the content (or `fixture`) is rendered hidden and inert, its
 * DOM is measured, and a MUI `<Skeleton>` is drawn over every piece of it.
 */
export function AutoSkeleton({
  loading,
  children,
  fixture,
  name,
  animation = "pulse",
  minHeight,
  boneSx,
  sx,
  className,
}: AutoSkeletonProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<Bone[]>(NO_BONES);

  /** Reads the current shape and remembers it under `name`. */
  const read = useCallback((): Bone[] => {
    const root = rootRef.current;
    const content = contentRef.current;
    if (!root || !content) return NO_BONES;
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

  // Set imperatively: React 18 drops the boolean `inert` prop, and React 19
  // reads the `inert=""` spelling that works on 18 as false.
  useIsomorphicLayoutEffect(() => {
    contentRef.current?.toggleAttribute("inert", loading);
  }, [loading]);

  // No dependency list on purpose. Content can change shape on any commit
  // without the wrapper resizing; `measure` only sets state when bones differ,
  // so this settles after one extra render at most.
  useIsomorphicLayoutEffect(() => {
    if (loading) measure();
  });

  // Layout changes that arrive without a React commit.
  useEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    if (!loading || !root || !content) return;

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
  }, [loading, measure]);

  // Learn the loaded shape so a later load with nothing to measure can use it.
  useEffect(() => {
    if (!loading && name) read();
  }, [loading, name, read]);

  const snapshot = loading && measured.length === 0 && name ? getSnapshot(name) : undefined;
  const bones = measured.length > 0 ? measured : (snapshot?.bones ?? NO_BONES);

  return (
    <Box
      ref={rootRef}
      className={className}
      data-auto-skeleton=""
      aria-busy={loading || undefined}
      sx={[
        { position: "relative", minHeight: snapshot?.height ?? minHeight },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {/* Always present, so children keep their state when `loading` flips.
          `display: contents` keeps them laid out as direct children of the wrapper. */}
      <div
        ref={contentRef}
        data-auto-skeleton-content=""
        aria-hidden={loading || undefined}
        style={{ display: "contents", visibility: loading ? "hidden" : undefined }}
      >
        {loading ? (fixture ?? children) : children}
      </div>
      {loading && (
        <div data-auto-skeleton-overlay="" aria-hidden style={OVERLAY_STYLE}>
          {bones.length === 0 ? (
            <Skeleton variant="rounded" animation={animation} sx={boneSx} style={BLOCK_STYLE} />
          ) : (
            bones.map((bone, index) =>
              bone.kind === "surface" ? (
                <div key={index} data-auto-skeleton-surface="" style={boneStyle(bone)} />
              ) : (
                <Skeleton
                  key={index}
                  variant={bone.variant}
                  animation={animation}
                  sx={boneSx}
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
