import { expect, test, type Page } from "@playwright/test";

/* Real-layout checks against demo/. While loading, the measured content is
   still in the DOM (hidden), so each spec compares a bone's box with the box
   of the element it stands for, in the same page state. */

type Box = { left: number; top: number; width: number; height: number; classes: string; radius: string };

type Layout = {
  bones: Box[];
  surfaces: Box[];
  elements: Record<string, Box[]>;
};

const IDS = ["card", "avatar", "title", "badge", "image", "about", "action"];

function readLayout(page: Page): Promise<Layout> {
  return page.evaluate((ids) => {
    const overlay = document.querySelector("[data-auto-skeleton-overlay]");
    if (!overlay) return { bones: [], surfaces: [], elements: {} };
    const origin = overlay.getBoundingClientRect();
    // A bone's intended box, from its inline geometry. getBoundingClientRect()
    // would report MUI's `scale(1, 0.6)` on text bones instead.
    const intended = (el: HTMLElement) => ({
      left: origin.left + parseFloat(el.style.left),
      top: origin.top + parseFloat(el.style.top),
      width: parseFloat(el.style.width),
      height: parseFloat(el.style.height),
      classes: el.className,
      radius: getComputedStyle(el).borderTopLeftRadius,
    });
    const actual = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        classes: "",
        radius: getComputedStyle(el).borderTopLeftRadius,
      };
    };
    const elements: Record<string, Box[]> = {};
    for (const id of ids) {
      elements[id] = Array.from(
        document.querySelectorAll(`[data-auto-skeleton-content] [data-testid="${id}"]`),
      ).map(actual);
    }
    return {
      bones: Array.from(overlay.querySelectorAll<HTMLElement>(".MuiSkeleton-root")).map(intended),
      surfaces: Array.from(overlay.querySelectorAll<HTMLElement>("[data-auto-skeleton-surface]")).map(intended),
      elements,
    };
  }, IDS);
}

const near = (a: Box, b: Box) =>
  Math.abs(a.left - b.left) <= 1 &&
  Math.abs(a.top - b.top) <= 1 &&
  Math.abs(a.width - b.width) <= 1 &&
  Math.abs(a.height - b.height) <= 1;

const inside = (bone: Box, el: Box) => {
  const x = bone.left + bone.width / 2;
  const y = bone.top + bone.height / 2;
  return x >= el.left && x <= el.left + el.width && y >= el.top && y <= el.top + el.height;
};

/** Names of shape elements that have no bone on top of them. Empty means aligned. */
function misaligned(layout: Layout): string[] {
  const missing: string[] = [];
  for (const id of ["avatar", "badge", "image", "action"]) {
    for (const [index, el] of (layout.elements[id] ?? []).entries()) {
      if (!layout.bones.some((bone) => near(bone, el))) missing.push(`${id}[${index}]`);
    }
  }
  if (layout.bones.length === 0) missing.push("no bones");
  return missing;
}

test("every shape gets a bone on top of it, within a pixel", async ({ page }) => {
  await page.goto("/");
  const layout = await readLayout(page);

  expect(layout.elements.card).toHaveLength(2);
  expect(misaligned(layout)).toEqual([]);

  const avatar = layout.elements.avatar?.[0] as Box;
  const action = layout.elements.action?.[0] as Box;
  expect(layout.bones.find((bone) => near(bone, avatar))?.classes).toContain("MuiSkeleton-circular");
  const actionBone = layout.bones.find((bone) => near(bone, action));
  expect(actionBone?.classes).toContain("MuiSkeleton-rounded");
  expect(actionBone?.radius).toBe("10px");
});

test("a wrapped paragraph gets one text bone per rendered line", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto("/");
  const layout = await readLayout(page);

  for (const about of layout.elements.about ?? []) {
    const lines = Math.round(about.height / 24); // .card p { line-height: 24px }
    const bones = layout.bones.filter((bone) => inside(bone, about));
    expect(lines).toBeGreaterThanOrEqual(2);
    expect(bones).toHaveLength(lines);
    for (const bone of bones) {
      expect(bone.classes).toContain("MuiSkeleton-text");
      expect(bone.width).toBeLessThanOrEqual(about.width + 1);
    }
  }

  const title = layout.elements.title?.[0] as Box;
  expect(layout.bones.filter((bone) => inside(bone, title))).toHaveLength(1);
});

test("the card frame is repainted with its own radius, not turned into a bone", async ({ page }) => {
  await page.goto("/");
  const layout = await readLayout(page);

  expect(layout.surfaces).toHaveLength(2);
  for (const card of layout.elements.card ?? []) {
    const surface = layout.surfaces.find((candidate) => near(candidate, card));
    expect(surface?.radius).toBe("16px");
    expect(layout.bones.some((bone) => near(bone, card))).toBe(false);
  }
});

test("bones follow the layout when the viewport is resized", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto("/");
  const wide = await readLayout(page);
  // Two cards side by side at this width.
  expect(wide.elements.card?.[0]?.top).toBe(wide.elements.card?.[1]?.top);

  await page.setViewportSize({ width: 400, height: 900 });
  await expect.poll(async () => misaligned(await readLayout(page))).toEqual([]);
  const narrow = await readLayout(page);
  // Stacked now — and the bones moved with them.
  expect(narrow.elements.card?.[1]?.top).toBeGreaterThan(narrow.elements.card?.[0]?.top ?? 0);
});

test("bones are placed correctly on a scrolled page", async ({ page }) => {
  await page.goto("/?spacer=1");
  await page.evaluate(() => window.scrollTo(0, 1300));
  // Force a fresh measurement while scrolled.
  await page.setViewportSize({ width: 900, height: 700 });
  await expect.poll(async () => misaligned(await readLayout(page))).toEqual([]);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test("hidden content cannot be focused or clicked while loading", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("toggle").focus();
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
  expect(focused).not.toBe("action");
  await expect(page.locator("[data-auto-skeleton]")).toHaveAttribute("aria-busy", "true");
});

test("loading ends: the overlay goes and the real content shows", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".MuiSkeleton-root").first()).toBeVisible();
  await expect(page.getByText("Ada Lovelace")).toHaveCount(0);

  await page.getByTestId("toggle").click();
  await expect(page.locator("[data-auto-skeleton-overlay]")).toHaveCount(0);
  await expect(page.getByText("Ada Lovelace").first()).toBeVisible();
  await expect(page.getByText("Placeholder name")).toHaveCount(0);
  await expect(page.locator("[data-auto-skeleton]")).not.toHaveAttribute("aria-busy", "true");

  await page.getByTestId("toggle").click();
  await expect.poll(async () => misaligned(await readLayout(page))).toEqual([]);
});
