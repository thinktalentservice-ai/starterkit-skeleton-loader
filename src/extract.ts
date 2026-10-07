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

const borderWidth = (style: CSSStyleDeclaration, side: Side) => {
  const width = parseFloat(style[`border${side}Width`]);
  const line = style[`border${side}Style`];
  return line === "none" || line === "hidden" || !(width > 0) ? 0 : width;
};

function borderOf(style: CSSStyleDeclaration, side: Side): string {
  const color = style[`border${side}Color`];
  if (borderWidth(style, side) === 0 || isTransparent(color)) return "";
  return `${style[`border${side}Width`]} ${style[`border${side}Style`]} ${color}`;
}

/** What an element paints of its own, and how much of that a frame repeats. */
type Paint = {
  /** Has a background colour or image — a box in its own right, not just an outline. */
  filled: boolean;
  /** Outlined on all four sides. */
  outlined: boolean;
  /** The part worth repainting, or null when there is none (a photo and nothing else). */
  surface: SurfaceStyle | null;
};

function readPaint(style: CSSStyleDeclaration): Paint | null {
  const image = style.backgroundImage && style.backgroundImage !== "none" ? style.backgroundImage : "";
  // A gradient is part of the frame. A photo is content: repainting it would
  // put a real picture in the skeleton.
  const repeatable = image.includes("url(") ? "" : image;
  const surface: SurfaceStyle = {
    backgroundColor: isTransparent(style.backgroundColor) ? "" : style.backgroundColor,
    backgroundImage: repeatable,
    backgroundSize: repeatable ? style.backgroundSize : "",
    backgroundPosition: repeatable ? style.backgroundPosition : "",
    backgroundRepeat: repeatable ? style.backgroundRepeat : "",
    borderTop: borderOf(style, "Top"),
    borderRight: borderOf(style, "Right"),
    borderBottom: borderOf(style, "Bottom"),
    borderLeft: borderOf(style, "Left"),
    boxShadow: style.boxShadow && style.boxShadow !== "none" ? style.boxShadow : "",
  };
  const filled = Boolean(surface.backgroundColor || image);
  const outlined = Boolean(surface.borderTop && surface.borderRight && surface.borderBottom && surface.borderLeft);
  const repaints = Boolean(
    surface.backgroundColor ||
      surface.backgroundImage ||
      surface.borderTop ||
      surface.borderRight ||
      surface.borderBottom ||
      surface.borderLeft ||
      surface.boxShadow,
  );
  if (!filled && !repaints) return null;
  return { filled, outlined, surface: repaints ? surface : null };
}

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

const steersSkeleton = (el: Element) =>
  el.hasAttribute("data-skeleton-ignore") ||
  el.hasAttribute("data-skeleton-leaf") ||
  el.hasAttribute("data-skeleton-variant");

/** Visible area of a clipping ancestor, in viewport coordinates. */
type Clip = LineRect & {
  radius: string;
  /** Largest corner radius in viewport px: how far in from an edge a corner can cut. */
  reach: number;
};

const clipsOverflow = (style: CSSStyleDeclaration) =>
  [style.overflowX, style.overflowY, style.overflow].some((value) => Boolean(value) && value !== "visible");

/** Establishes the containing block for absolutely positioned descendants. */
const containsAbsolute = (style: CSSStyleDeclaration) =>
  (Boolean(style.position) && style.position !== "static") || (Boolean(style.transform) && style.transform !== "none");

/**
 * What an element with clipping overflow lets through: its padding box, with
 * corners rounded to follow the inside of its border.
 *
 * `scale` converts the element's CSS pixels to the viewport pixels `rect` is in.
 * The radius is returned in CSS pixels — never as a percentage, which inside
 * `inset(… round …)` would resolve against the clipped bone rather than this box.
 */
function readClip(rect: LineRect, style: CSSStyleDeclaration, outer: Clip | null, scale: { x: number; y: number }): Clip {
  const [top, right, bottom, left] = (["Top", "Right", "Bottom", "Left"] as const).map((side) =>
    borderWidth(style, side),
  ) as [number, number, number, number];
  const width = (rect.right - rect.left) / scale.x;
  const height = (rect.bottom - rect.top) / scale.y;
  const resolve = (part: string, against: number, limit: number) => {
    const value = parseFloat(part) || 0;
    return Math.min(part.trim().endsWith("%") ? (value / 100) * against : value, limit);
  };
  // Each corner is cut by the border that runs along it on each axis.
  const cuts: Array<[number, number]> = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
  const inner = readCorners(style).map((corner, index) => {
    const [h = "0px", v = h] = corner.split(" ");
    const [cutX, cutY] = cuts[index] ?? [0, 0];
    return [
      Math.max(0, resolve(h, width, width / 2) - cutX),
      Math.max(0, resolve(v, height, height / 2) - cutY),
    ] as const;
  });
  const box = {
    left: rect.left + left * scale.x,
    top: rect.top + top * scale.y,
    right: rect.right - right * scale.x,
    bottom: rect.bottom - bottom * scale.y,
  };
  return {
    // Nested clippers narrow the area; the radius followed is the nearest one's.
    left: outer ? Math.max(box.left, outer.left) : box.left,
    top: outer ? Math.max(box.top, outer.top) : box.top,
    right: outer ? Math.min(box.right, outer.right) : box.right,
    bottom: outer ? Math.min(box.bottom, outer.bottom) : box.bottom,
    radius: cornersToCss(inner.map(([h, v]) => (h === v ? `${round(h)}px` : `${round(h)}px ${round(v)}px`))),
    reach: Math.max(...inner.map(([h, v]) => Math.max(h * scale.x, v * scale.y))),
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
  // getBoundingClientRect() is in viewport pixels, after every ancestor
  // transform; bones are positioned inside the origin, in its own CSS pixels.
  // Under `transform: scale()` — MUI's Grow, behind every Menu and Popover,
  // starts at 0.75 — the two differ, and a transform never resizes the layout
  // box, so no observer would ever correct a measurement taken mid-transition.
  const layout = origin as Partial<HTMLElement>;
  const ratio = (drawn: number, laidOut: number | undefined) =>
    laidOut && drawn > 0 && Math.abs(drawn / laidOut - 1) > 0.001 ? drawn / laidOut : 1;
  const scale = {
    x: ratio(originRect.width, layout.offsetWidth),
    y: ratio(originRect.height, layout.offsetHeight),
  };
  // Absolutely positioned children resolve against the padding box, and scroll
  // with the origin's content — hence the border and scroll terms.
  const shiftX = origin.scrollLeft - origin.clientLeft;
  const shiftY = origin.scrollTop - origin.clientTop;

  const bones: Bone[] = [];

  const place = (rect: LineRect) => ({
    x: round((rect.left - originRect.left) / scale.x + shiftX),
    y: round((rect.top - originRect.top) / scale.y + shiftY),
    width: round((rect.right - rect.left) / scale.x),
    height: round((rect.bottom - rect.top) / scale.y),
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

  const forcedVariant = (el: Element): BoneVariant | null => {
    const forced = el.getAttribute("data-skeleton-variant") as BoneVariant | null;
    return forced && VARIANTS.includes(forced) ? forced : null;
  };

  const pushShape = (el: Element, rect: DOMRect, style: CSSStyleDeclaration, clip: Clip | null) => {
    const corners = readCorners(style);
    const radius = cornersToCss(corners);
    const variant: BoneVariant =
      forcedVariant(el) ??
      (isCircle(corners, rect.width / scale.x, rect.height / scale.y) ? "circular" : radius ? "rounded" : "rectangular");
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

  /** Rendered but not shown, in ways `display` and `opacity` do not reveal. */
  const isWithheld = (el: Element) => {
    const parent = el.parentElement;
    // The body of a closed <details> keeps its layout box in current browsers.
    if (parent?.tagName === "DETAILS" && !(parent as HTMLDetailsElement).open && el.tagName !== "SUMMARY") return true;
    // Catches content-visibility: hidden too. Absent in jsdom and older engines.
    return typeof el.checkVisibility === "function" && !el.checkVisibility();
  };

  /**
   * `clip` is what cuts in-flow content here. `absoluteClip` is what cuts an
   * absolutely positioned element here — the clip of its containing block,
   * which is not necessarily the nearest clipping ancestor.
   */
  const walkChildren = (el: Element, clamp: DOMRect | null, clip: Clip | null, absoluteClip: Clip | null) => {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === ELEMENT_NODE) walk(node as Element, clip, absoluteClip);
      else if (node.nodeType === TEXT_NODE && /\S/.test(node.nodeValue ?? "")) pushLines(node, clamp, clip);
    }
  };

  const walk = (el: Element, flowClip: Clip | null, absoluteClip: Clip | null) => {
    const style = view.getComputedStyle(el);
    if (
      el.hasAttribute("data-skeleton-ignore") ||
      // Another AutoSkeleton's bones, when one is nested inside this one.
      el.hasAttribute("data-auto-skeleton-overlay") ||
      style.display === "none" ||
      parseFloat(style.opacity) === 0
    ) {
      return;
    }
    // No box of its own, so its rect is empty — but its children are laid out.
    if (style.display === "contents") {
      walkChildren(el, null, flowClip, absoluteClip);
      return;
    }
    if (isWithheld(el)) return;

    const clip = style.position === "fixed" ? null : style.position === "absolute" ? absoluteClip : flowClip;
    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toUpperCase();

    if (FORCED_LEAF_TAGS.has(tag) || el.hasAttribute("data-skeleton-leaf")) {
      pushShape(el, rect, style, clip);
      return;
    }

    const paint = readPaint(style);
    const tablePart = TABLE_TAGS.has(tag) || style.display.startsWith("table");

    // A run of text: words, with nothing but plain inline markup between them.
    // An inline image, control or steered element is its own piece, so a parent
    // holding one is walked child by child instead of measured as one Range.
    const isRun =
      hasDirectText(el) &&
      Array.from(el.children).every(
        (child) =>
          view.getComputedStyle(child).display === "inline" &&
          !FORCED_LEAF_TAGS.has(child.tagName.toUpperCase()) &&
          !steersSkeleton(child),
      );

    if (isRun) {
      const forced = forcedVariant(el);
      // A small filled text box is a chip or badge: the box is the shape, not
      // its words. Anything else keeps its words as lines over its own frame —
      // an underlined heading, a table cell, a filled paragraph.
      if ((forced && forced !== "text") || (paint?.filled && isCompact(rect) && !tablePart)) {
        pushShape(el, rect, style, clip);
      } else {
        if (paint?.surface) pushSurface(rect, style, paint.surface, clip);
        pushLines(el, rect, clip);
      }
      return;
    }

    if (el.childElementCount === 0 && !hasDirectText(el)) {
      // Childless and textless: a bone only if something is actually painted.
      if (tablePart) {
        if (paint?.surface) pushSurface(rect, style, paint.surface, clip);
      } else if (paint || hasPseudoContent(el)) {
        pushShape(el, rect, style, clip);
      }
      return;
    }

    const start = bones.length;
    if (paint?.surface) pushSurface(rect, style, paint.surface, clip);
    const inner = clipsOverflow(style) ? readClip(rect, style, clip, scale) : clip;
    walkChildren(el, rect, inner, containsAbsolute(style) ? inner : absoluteClip);

    if (paint && (paint.filled || paint.outlined) && isCompact(rect) && !tablePart) {
      const pieces = bones.slice(start).filter((bone) => bone.kind === "bone").length;
      if (pieces <= COMPACT_PIECES) {
        bones.length = start;
        pushShape(el, rect, style, clip);
      }
    }
  };

  walkChildren(root, null, null, null);
  return bones;
}
