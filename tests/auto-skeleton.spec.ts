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

test("content with an entrance animation is measured where it comes to rest", async ({ page }) => {
  // demo cards fade up from opacity 0 over 0.6s. Read on the first frame: a
  // measurement that waited for, or ran during, the animation would be empty
  // or 18px off.
  await page.goto("/");
  const layout = await readLayout(page);
  expect(layout.surfaces).toHaveLength(2);
  expect(misaligned(layout)).toEqual([]);

  // And the animation is given back once the content is shown for real.
  await page.getByTestId("toggle").click();
  const animated = await page.getByTestId("card").first().evaluate((el) => getComputedStyle(el).animationName);
  expect(animated).toBe("fade-up");
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

test("a bone inside an overflow:hidden card is cut to the card's rounded corners", async ({ page }) => {
  // demo's .banner is square-cornered and flush with the card's top edge; the
  // card (1px border, 16px radius, overflow hidden) is what rounds it.
  await page.goto("/");
  const banner = await page.evaluate(() => {
    const el = document.querySelector('[data-auto-skeleton-content] [data-testid="banner"]');
    const overlay = document.querySelector("[data-auto-skeleton-overlay]");
    if (!el || !overlay) return null;
    const rect = el.getBoundingClientRect();
    const origin = overlay.getBoundingClientRect();
    const bone = Array.from(overlay.querySelectorAll<HTMLElement>(".MuiSkeleton-root")).find(
      (candidate) =>
        Math.abs(origin.left + parseFloat(candidate.style.left) - rect.left) <= 1 &&
        Math.abs(origin.top + parseFloat(candidate.style.top) - rect.top) <= 1 &&
        Math.abs(parseFloat(candidate.style.height) - rect.height) <= 1,
    );
    return bone ? getComputedStyle(bone).clipPath : "no bone";
  });
  // Flush on three sides, the card's inner radius (16px - 1px border), and a
  // negative bottom inset because the card extends far below the banner.
  expect(banner).toMatch(/^inset\(0px 0px -[\d.]+px(?: 0px)? round 15px\)$/);
});

test("a frame's shadow is not cut off at the wrapper's edge", async ({ page }) => {
  await page.goto("/");
  const overlay = page.locator("[data-auto-skeleton-overlay]");
  expect(await overlay.evaluate((el) => getComputedStyle(el).overflow)).toBe("visible");
  const shadow = await page
    .locator("[data-auto-skeleton-surface]")
    .first()
    .evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).not.toBe("none");
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

/* The CSS skeleton is what a statically exported page shows until its
   JavaScript has run — on a slow connection, for seconds. It restyles the
   content itself, so these specs read the content elements directly. */
test.describe("CSS skeleton (before any measurement)", () => {
  const read = (page: Page, id: string) =>
    page
      .locator(`[data-auto-skeleton-content] [data-testid="${id}"]`)
      .first()
      .evaluate((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          color: style.color,
          background: style.backgroundColor,
          strike: style.textDecorationLine,
          strikeColor: style.textDecorationColor,
          strikePx: parseFloat(style.textDecorationThickness),
          fontPx: parseFloat(style.fontSize),
          visibility: style.visibility,
          box: [rect.left, rect.top, rect.width, rect.height].map(Math.round),
        };
      });

  const boneColor = (page: Page) =>
    page.locator("[data-auto-skeleton]").evaluate((el) => {
      // Resolve the custom property to the rgb() form computed styles report.
      const probe = document.createElement("i");
      probe.style.backgroundColor = "var(--auto-skeleton-bone)";
      el.appendChild(probe);
      const resolved = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return resolved;
    });

  test("draws text as bars, shapes as fills, and keeps the card frame", async ({ page }) => {
    await page.goto("/?mode=css");
    const bone = await boneColor(page);
    const transparent = "rgba(0, 0, 0, 0)";

    const title = await read(page, "title");
    expect(title.color).toBe(transparent);
    expect(title.strike).toBe("line-through");
    expect(title.strikeColor).toBe(bone);
    expect(title.strikePx / title.fontPx).toBeCloseTo(0.7, 1);

    const about = await read(page, "about");
    expect(about.strike).toBe("line-through");

    for (const id of ["action", "image"]) {
      const shape = await read(page, id);
      expect(shape.background).toBe(bone);
      expect(shape.color).toBe(transparent);
    }

    const card = await read(page, "card");
    expect(card.background).toBe("rgb(255, 255, 255)");
    expect(card.visibility).toBe("visible");

    // Nothing measured, so nothing is drawn on top.
    await expect(page.locator("[data-auto-skeleton-overlay]")).toBeHidden();
    await expect(page.locator("[data-auto-skeleton-surface]")).toHaveCount(0);
  });

  test("does not move anything: same boxes as the measured skeleton", async ({ page }) => {
    await page.goto("/?mode=css");
    const css = await Promise.all(IDS.map((id) => read(page, id)));
    await page.goto("/");
    const measured = await Promise.all(IDS.map((id) => read(page, id)));
    expect(css.map((el) => el.box)).toEqual(measured.map((el) => el.box));
  });

  test("the content still cannot be focused", async ({ page }) => {
    await page.goto("/?mode=css");
    await page.getByTestId("toggle").focus();
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
    expect(focused).not.toBe("action");
  });
});
