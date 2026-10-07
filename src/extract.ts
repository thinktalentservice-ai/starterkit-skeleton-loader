import type { Bone, BoneVariant, SurfaceStyle } from "./types";

export type ExtractOptions = {
  /** Element the bone coordinates are relative to. Defaults to `root`. */
  origin?: Element;
};

export type LineRect = { left: number; top: number; right: number; bottom: number };

// Elements whose inside is never worth describing: one box stands for all of it.
// Keep in step with SHAPES in AutoSkeleton.tsx.
const FORCED_LEAF_TAGS = new Set([
  "IMG",
  "SVG",
  "VIDEO",
  "CANVAS",
  "IFRAME",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "BUTTON",
]);

// Table structure is never a bone: a filled cell is a frame around its content,
// however small it is and whatever it holds.
const TABLE_TAGS = new Set(["TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH"]);

const VARIANTS: readonly BoneVariant[] = ["text", "circular", "rounded", "rectangular"];

// A painted box no bigger than this, holding at most COMPACT_PIECES pieces, is
// one bone: an avatar, a chip, a badge, an icon button, a slider thumb.
// Repainting those in their own colour reads as live UI, not as a skeleton.
// Both limits matter — a 48px-tall toolbar is short but not small.
const COMPACT_WIDTH = 160;
const COMPACT_HEIGHT = 64;
const COMPACT_PIECES = 2;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const round = (n: number) => Math.round(n * 100) / 100;

const hasArea = (r: LineRect) => r.right - r.left > 0 && r.bottom - r.top > 0;

const isCompact = (r: LineRect) => r.right - r.left <= COMPACT_WIDTH && r.bottom - r.top <= COMPACT_HEIGHT;

/**
 * Collapse the per-fragment rects a Range reports into one rect per rendered
 * line. Fragments belong to the same line when they overlap vertically by more
 * than half the shorter one — a plain `top` comparison splits a line that mixes
 * font sizes.
 */
export function mergeLines(rects: LineRect[]): LineRect[] {
  const sorted = rects.filter(hasArea).sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: LineRect[] = [];
  for (const rect of sorted) {
    const last = lines[lines.length - 1];
    if (last) {
      const overlap = Math.min(last.bottom, rect.bottom) - Math.max(last.top, rect.top);
      const shorter = Math.min(last.bottom - last.top, rect.bottom - rect.top);
      if (overlap > shorter / 2) {
        last.left = Math.min(last.left, rect.left);
        last.right = Math.max(last.right, rect.right);
        last.top = Math.min(last.top, rect.top);
        last.bottom = Math.max(last.bottom, rect.bottom);
        continue;
      }
    }
    lines.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  }
  return lines;
}

function isTransparent(color: string): boolean {
  const c = color.trim().toLowerCase();
  if (c === "" || c === "transparent") return true;
  const open = c.indexOf("(");
  if (open === -1 || !c.endsWith(")")) return false;
  const args = c.slice(open + 1, -1);
  // Modern syntax carries alpha after a slash; legacy rgba()/hsla() as a 4th comma part.
  const slash = args.lastIndexOf("/");
  const parts = args.split(",");
  const alpha = slash !== -1 ? args.slice(slash + 1) : parts.length === 4 ? parts[3] : undefined;
  return alpha !== undefined && parseFloat(alpha) === 0;
}

type Side = "Top" | "Right" | "Bottom" | "Left";

function borderOf(style: CSSStyleDeclaration, side: Side): string {
  const width = style[`border${side}Width`];
  const line = style[`border${side}Style`];
  const color = style[`border${side}Color`];
  if (!(parseFloat(width) > 0) || line === "none" || line === "hidden" || isTransparent(color)) {
    return "";
  }
  return `${width} ${line} ${color}`;
}

function readSurface(style: CSSStyleDeclaration): SurfaceStyle | null {
  const surface: SurfaceStyle = {
    backgroundColor: isTransparent(style.backgroundColor) ? "" : style.backgroundColor,
    backgroundImage: style.backgroundImage && style.backgroundImage !== "none" ? style.backgroundImage : "",
    borderTop: borderOf(style, "Top"),
    borderRight: borderOf(style, "Right"),
    borderBottom: borderOf(style, "Bottom"),
    borderLeft: borderOf(style, "Left"),
    boxShadow: style.boxShadow && style.boxShadow !== "none" ? style.boxShadow : "",
  };
  return Object.values(surface).some(Boolean) ? surface : null;
}

const isFilled = (surface: SurfaceStyle) => Boolean(surface.backgroundColor || surface.backgroundImage);

/** A box in its own right: filled, or outlined on all four sides. */
const isBox = (surface: SurfaceStyle) =>
  isFilled(surface) ||
  Boolean(surface.borderTop && surface.borderRight && surface.borderBottom && surface.borderLeft);

/** The four corner radii as computed, top-left clockwise. */
function readCorners(style: CSSStyleDeclaration): string[] {
  return [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ].map((corner) => corner || "0px");
}

function cornersToCss(corners: string[]): string {
  if (corners.every((corner) => corner.split(" ").every((part) => parseFloat(part) === 0))) return "";
  if (corners.every((corner) => corner === corners[0])) {
    const first = corners[0] ?? "";
    // An elliptical corner computes to "h v"; as a shorthand that needs the slash form.
    return first.includes(" ") ? first.replace(" ", " / ") : first;
  }
  if (corners.some((corner) => corner.includes(" "))) {
    const horizontal = corners.map((corner) => corner.split(" ")[0] ?? "0px");
    const vertical = corners.map((corner) => corner.split(" ")[1] ?? corner.split(" ")[0] ?? "0px");
    return `${horizontal.join(" ")} / ${vertical.join(" ")}`;
  }
  return corners.join(" ");
}

function isCircle(corners: string[], width: number, height: number): boolean {
  if (Math.abs(width - height) > 1) return false;
  const half = Math.min(width, height) / 2;
  return corners.every((corner) =>
    corner.split(" ").every((part) => {
      const value = parseFloat(part);
      return part.trim().endsWith("%") ? value >= 50 : value >= half - 0.5;
    }),
  );
}

function hasDirectText(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === TEXT_NODE && /\S/.test(node.nodeValue ?? "")) return true;
  }
  return false;
}

/** Visible area of a clipping ancestor, in viewport coordinates. */
type Clip = LineRect & {
  radius: string;
  /** Largest corner radius in px: how far in from an edge a corner can cut. */
  reach: number;
};

const clipsOverflow = (style: CSSStyleDeclaration) =>
  [style.overflowX, style.overflowY, style.overflow].some((value) => Boolean(value) && value !== "visible");

/**
 * What an element with clipping overflow lets through: its padding box, with
 * corners rounded to follow the inside of its border.
 */
function readClip(rect: LineRect, style: CSSStyleDeclaration, outer: Clip | null): Clip {
  const border = (side: Side) => {
    const width = parseFloat(style[`border${side}Width`]);
    return style[`border${side}Style`] === "none" || !(width > 0) ? 0 : width;
  };
  const [top, right, bottom, left] = [border("Top"), border("Right"), border("Bottom"), border("Left")];
  const corners = readCorners(style);
  const simple = corners.every((corner) => /^[\d.]+px$/.test(corner));
  // Each corner is cut by the wider of the two borders that meet at it.
  const insets = [Math.max(top, left), Math.max(top, right), Math.max(bottom, right), Math.max(bottom, left)];
  const inner = simple
    ? corners.map((corner, index) => `${Math.max(0, parseFloat(corner) - (insets[index] ?? 0))}px`)
    : corners;
  const box = {
    left: rect.left + left,
    top: rect.top + top,
    right: rect.right - right,
    bottom: rect.bottom - bottom,
  };
  return {
    // Nested clippers narrow the area; the radius followed is the nearest one's.
    left: outer ? Math.max(box.left, outer.left) : box.left,
    top: outer ? Math.max(box.top, outer.top) : box.top,
    right: outer ? Math.min(box.right, outer.right) : box.right,
    bottom: outer ? Math.min(box.bottom, outer.bottom) : box.bottom,
    radius: cornersToCss(inner),
    reach: simple ? Math.max(...inner.map((corner) => parseFloat(corner))) : Math.min(rect.right - rect.left, rect.bottom - rect.top) / 2,
  };
}

/**
 * Walk `root`'s descendants and describe them as skeleton bones.
 *
 * Pure DOM read — no React, no writes. `root` itself is never emitted.
 */
export function extractBones(root: Element, options: ExtractOptions = {}): Bone[] {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  if (!view) return [];

  const origin = options.origin ?? root;
  const originRect = origin.getBoundingClientRect();
  // Absolutely positioned children resolve against the padding box, and scroll
  // with the origin's content — hence the border and scroll terms.
  const originX = originRect.left + origin.clientLeft - origin.scrollLeft;
  const originY = originRect.top + origin.clientTop - origin.scrollTop;

  const bones: Bone[] = [];

  const place = (rect: LineRect) => ({
    x: round(rect.left - originX),
    y: round(rect.top - originY),
    width: round(rect.right - rect.left),
    height: round(rect.bottom - rect.top),
  });

  /** Adds a bone, cut to — or dropped by — the clipping ancestor it sits in. */
  const emit = (bone: Pick<Bone, "kind" | "variant" | "radius" | "surface">, rect: LineRect, clip: Clip | null) => {
    if (!hasArea(rect)) return;
    const placed: Bone = { ...bone, ...place(rect) };
    if (clip) {
      const outside =
        rect.right <= clip.left || rect.left >= clip.right || rect.bottom <= clip.top || rect.top >= clip.bottom;
      // Scrolled out of view: the real element is not painted, so neither is its bone.
      if (outside) return;
      const sticksOut =
        rect.left < clip.left || rect.top < clip.top || rect.right > clip.right || rect.bottom > clip.bottom;
      const inCorner =
        clip.reach > 0 &&
        (rect.left < clip.left + clip.reach || rect.right > clip.right - clip.reach) &&
        (rect.top < clip.top + clip.reach || rect.bottom > clip.bottom - clip.reach);
      if (sticksOut || inCorner) placed.clip = { ...place(clip), radius: clip.radius };
    }
    bones.push(placed);
  };

  const pushShape = (el: Element, rect: DOMRect, style: CSSStyleDeclaration, clip: Clip | null) => {
    const corners = readCorners(style);
    const radius = cornersToCss(corners);
    const forced = el.getAttribute("data-skeleton-variant") as BoneVariant | null;
    const variant: BoneVariant =
      forced && VARIANTS.includes(forced)
        ? forced
        : isCircle(corners, rect.width, rect.height)
          ? "circular"
          : radius
            ? "rounded"
            : "rectangular";
    emit({ kind: "bone", variant, radius }, rect, clip);
  };

  const pushSurface = (rect: DOMRect, style: CSSStyleDeclaration, surface: SurfaceStyle, clip: Clip | null) => {
    emit({ kind: "surface", variant: "rectangular", radius: cornersToCss(readCorners(style)), surface }, rect, clip);
  };

  const pushLines = (node: Node, clamp: DOMRect | null, clip: Clip | null) => {
    const range = doc.createRange();
    range.selectNodeContents(node);
    // jsdom and a few embedded webviews ship Range without layout methods.
    const lines =
      typeof range.getClientRects === "function"
        ? mergeLines(Array.from(range.getClientRects()))
        : clamp
          ? [clamp]
          : [];
    for (const line of lines) {
      // Clamp to the element: ellipsis and line-clamp leave text rects that
      // extend past what is actually painted.
      const visible =
        clamp && hasArea(clamp)
          ? {
              left: Math.max(line.left, clamp.left),
              top: Math.max(line.top, clamp.top),
              right: Math.min(line.right, clamp.right),
              bottom: Math.min(line.bottom, clamp.bottom),
            }
          : line;
      emit({ kind: "bone", variant: "text", radius: "" }, visible, clip);
    }
  };

  const hasPseudoContent = (el: Element) =>
    ["::before", "::after"].some((pseudo) => {
      const content = view.getComputedStyle(el, pseudo).content;
      return Boolean(content) && !["none", "normal", '""', "''"].includes(content);
    });

  const walkChildren = (el: Element, clamp: DOMRect | null, clip: Clip | null) => {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === ELEMENT_NODE) walk(node as Element, clip);
      else if (node.nodeType === TEXT_NODE && /\S/.test(node.nodeValue ?? "")) pushLines(node, clamp, clip);
    }
  };

  const walk = (el: Element, clip: Clip | null) => {
    const style = view.getComputedStyle(el);
    if (el.hasAttribute("data-skeleton-ignore") || style.display === "none" || parseFloat(style.opacity) === 0) {
      return;
    }
    // No box of its own, so its rect is empty — but its children are laid out.
    if (style.display === "contents") {
      walkChildren(el, null, clip);
      return;
    }

    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toUpperCase();

    if (FORCED_LEAF_TAGS.has(tag) || el.hasAttribute("data-skeleton-leaf")) {
      pushShape(el, rect, style, clip);
      return;
    }

    const surface = readSurface(style);
    const tablePart = TABLE_TAGS.has(tag) || style.display.startsWith("table");

    const directText = hasDirectText(el);
    const inlineOnly = Array.from(el.children).every(
      (child) => view.getComputedStyle(child).display === "inline",
    );

    if (directText && inlineOnly) {
      // A small filled text box is a chip or badge: the box is the shape, not
      // its words. Anything else keeps its words as lines over its own frame —
      // an underlined heading, a table cell, a filled paragraph.
      if (surface && isFilled(surface) && isCompact(rect) && !tablePart) {
        pushShape(el, rect, style, clip);
      } else {
        if (surface) pushSurface(rect, style, surface, clip);
        pushLines(el, rect, clip);
      }
      return;
    }

    if (el.childElementCount === 0) {
      // Childless and textless: a bone only if something is actually painted.
      if (tablePart) {
        if (surface) pushSurface(rect, style, surface, clip);
      } else if (surface || hasPseudoContent(el)) {
        pushShape(el, rect, style, clip);
      }
      return;
    }

    const start = bones.length;
    if (surface) pushSurface(rect, style, surface, clip);
    walkChildren(el, rect, clipsOverflow(style) ? readClip(rect, style, clip) : clip);

    if (surface && isBox(surface) && isCompact(rect) && !tablePart) {
      const pieces = bones.slice(start).filter((bone) => bone.kind === "bone").length;
      if (pieces <= COMPACT_PIECES) {
        bones.length = start;
        pushShape(el, rect, style, clip);
      }
    }
  };

  walkChildren(root, null, null);
  return bones;
}
