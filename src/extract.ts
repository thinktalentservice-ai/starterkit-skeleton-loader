import type { Bone, BoneVariant, SurfaceStyle } from "./types";

export type ExtractOptions = {
  /** Element the bone coordinates are relative to. Defaults to `root`. */
  origin?: Element;
};

export type LineRect = { left: number; top: number; right: number; bottom: number };

// Elements whose inside is never worth describing: one box stands for all of it.
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

const VARIANTS: readonly BoneVariant[] = ["text", "circular", "rounded", "rectangular"];

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const round = (n: number) => Math.round(n * 100) / 100;

const hasArea = (r: LineRect) => r.right - r.left > 0 && r.bottom - r.top > 0;

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

  const pushShape = (el: Element, rect: DOMRect, style: CSSStyleDeclaration) => {
    if (!hasArea(rect)) return;
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
    bones.push({ kind: "bone", variant, ...place(rect), radius });
  };

  const pushLines = (node: Node, clamp: DOMRect | null) => {
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
      if (!hasArea(visible)) continue;
      bones.push({ kind: "bone", variant: "text", ...place(visible), radius: "" });
    }
  };

  const hasPseudoContent = (el: Element) =>
    ["::before", "::after"].some((pseudo) => {
      const content = view.getComputedStyle(el, pseudo).content;
      return Boolean(content) && !["none", "normal", '""', "''"].includes(content);
    });

  const walkChildren = (el: Element, clamp: DOMRect | null) => {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === ELEMENT_NODE) walk(node as Element);
      else if (node.nodeType === TEXT_NODE && /\S/.test(node.nodeValue ?? "")) pushLines(node, clamp);
    }
  };

  const walk = (el: Element) => {
    const style = view.getComputedStyle(el);
    if (el.hasAttribute("data-skeleton-ignore") || style.display === "none" || parseFloat(style.opacity) === 0) {
      return;
    }
    // No box of its own, so its rect is empty — but its children are laid out.
    if (style.display === "contents") {
      walkChildren(el, null);
      return;
    }

    const rect = el.getBoundingClientRect();

    if (FORCED_LEAF_TAGS.has(el.tagName.toUpperCase()) || el.hasAttribute("data-skeleton-leaf")) {
      pushShape(el, rect, style);
      return;
    }

    const directText = hasDirectText(el);
    const inlineOnly = Array.from(el.children).every(
      (child) => view.getComputedStyle(child).display === "inline",
    );

    if (directText && inlineOnly) {
      // A painted text box is a chip or badge: the box is the shape, not its words.
      if (readSurface(style)) pushShape(el, rect, style);
      else pushLines(el, rect);
      return;
    }

    if (el.childElementCount === 0) {
      // Childless and textless: a bone only if something is actually painted.
      if (readSurface(style) || hasPseudoContent(el)) pushShape(el, rect, style);
      return;
    }

    const surface = readSurface(style);
    if (surface && hasArea(rect)) {
      bones.push({
        kind: "surface",
        variant: "rectangular",
        ...place(rect),
        radius: cornersToCss(readCorners(style)),
        surface,
      });
    }
    walkChildren(el, rect);
  };

  walkChildren(root, null);
  return bones;
}
