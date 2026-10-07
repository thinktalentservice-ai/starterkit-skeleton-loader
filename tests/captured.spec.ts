import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

/* Captured shapes: what a page shows when its content does not exist until
   JavaScript has run, so there is nothing in the HTML to measure or restyle.
   demo/accounts.bones.json was written by bin/auto-skeleton.mjs from this same
   demo; `?fixture=0&captured=1` is a wrapper with no content and that capture. */

const run = promisify(execFile);

const visibleLayers = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-auto-skeleton-captured]"))
      .filter((layer) => getComputedStyle(layer).display !== "none")
      .map((layer) => layer.getAttribute("data-auto-skeleton-captured")),
  );

test("with no content at all, the captured shape is drawn instead of a block", async ({ page }) => {
  await page.goto("/?fixture=0&captured=1");
  expect(await visibleLayers(page)).toEqual(["1280"]);

  const layer = page.locator('[data-auto-skeleton-captured="1280"]');
  await expect(layer.locator(".MuiSkeleton-root").first()).toBeVisible();
  expect(await layer.locator(".MuiSkeleton-root").count()).toBeGreaterThan(10);
  expect(await layer.locator("[data-auto-skeleton-surface]").count()).toBe(2);
});

test("exactly one captured layer shows, chosen by viewport width", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 900 });
  await page.goto("/?fixture=0&captured=1");
  // Narrower than the next capture up: the 375 one.
  expect(await visibleLayers(page)).toEqual(["375"]);

  await page.setViewportSize({ width: 900, height: 900 });
  expect(await visibleLayers(page)).toEqual(["768"]);

  await page.setViewportSize({ width: 1600, height: 900 });
  expect(await visibleLayers(page)).toEqual(["1280"]);

  // Below the narrowest capture there is still something to show.
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await visibleLayers(page)).toEqual(["375"]);
});

test("the captured height is reserved, so the page does not jump when content arrives", async ({ page }) => {
  await page.goto("/?fixture=0&captured=1");
  const wrapper = page.locator("[data-auto-skeleton]");
  const reserved = await wrapper.evaluate((el) => el.getBoundingClientRect().height);

  await page.getByTestId("toggle").click();
  await expect(page.getByText("Ada Lovelace").first()).toBeVisible();
  const loaded = await wrapper.evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.abs(reserved - loaded)).toBeLessThanOrEqual(1);
});

test("captured bones sit where the real content then appears", async ({ page }) => {
  // Same viewport the capture was taken at, so the stretch factor is 1.
  await page.goto("/?fixture=0&captured=1");
  const circles = await page
    .locator('[data-auto-skeleton-captured="1280"] .MuiSkeleton-circular')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.left, r.top, r.width, r.height]));

  await page.getByTestId("toggle").click();
  const avatars = await page.getByTestId("avatar").evaluateAll(async (els) => {
    await Promise.all(els.flatMap((el) => el.closest(".card")?.getAnimations() ?? []).map((a) => a.finished));
    return els.map((el) => el.getBoundingClientRect()).map((r) => [r.left, r.top, r.width, r.height]);
  });

  expect(circles).toHaveLength(avatars.length);
  for (const [index, avatar] of avatars.entries()) {
    for (const [axis, value] of avatar.entries()) {
      expect(Math.abs(value - (circles[index]?.[axis] ?? Infinity))).toBeLessThanOrEqual(1);
    }
  }
});

test("a captured shape stretches with a wrapper wider than it was captured in", async ({ page }) => {
  // ?scale is irrelevant here; a 1600px viewport gives the same 960px-max grid,
  // so narrow it instead: 1000px viewport, still the 768 capture (720px wrapper).
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto("/?fixture=0&captured=1");
  const { wrapper, surfaces } = await page.evaluate(() => {
    const root = document.querySelector("[data-auto-skeleton]") as HTMLElement;
    const layer = document.querySelector('[data-auto-skeleton-captured="768"]') as HTMLElement;
    return {
      wrapper: root.getBoundingClientRect().width,
      surfaces: Array.from(layer.querySelectorAll("[data-auto-skeleton-surface]")).map(
        (el) => el.getBoundingClientRect().right - root.getBoundingClientRect().left,
      ),
    };
  });
  // The rightmost frame ends at the wrapper's edge whatever the wrapper's width.
  expect(wrapper).toBeGreaterThan(720);
  expect(Math.abs(Math.max(...surfaces) - wrapper)).toBeLessThanOrEqual(1);
});

test("the capture command writes a theme-neutral shape for every breakpoint", async ({ baseURL }) => {
  const out = await mkdtemp(path.join(tmpdir(), "auto-skeleton-"));
  try {
    const { stdout } = await run(process.execPath, [
      "bin/auto-skeleton.mjs",
      "--url",
      `${baseURL}/?loading=0`,
      "--out",
      out,
      "--breakpoints",
      "400,1280",
      "--wait",
      "300",
    ]);
    expect(stdout).toContain("accounts.bones.json");

    const captured = JSON.parse(await readFile(path.join(out, "accounts.bones.json"), "utf8"));
    expect(captured.name).toBe("accounts");
    expect(Object.keys(captured.breakpoints)).toEqual(["400", "1280"]);

    const wide = captured.breakpoints["1280"];
    expect(wide.width).toBe(960);
    expect(wide.bones.length).toBeGreaterThan(10);
    // No colour of the theme it was captured in survives into the file.
    const serialised = JSON.stringify(captured);
    expect(serialised).not.toMatch(/rgb\(|#[0-9a-f]{3,8}\b/i);
    const frame = wide.bones.find((bone: { kind: string }) => bone.kind === "surface");
    expect(frame.surface.borderTop).toBe("1px solid var(--auto-skeleton-bone)");
    expect(frame.surface.backgroundColor).toBeUndefined();
    // Clips are in captured pixels and are dropped; out-of-view pieces were never included.
    expect(wide.bones.every((bone: { clip?: unknown }) => bone.clip === undefined)).toBe(true);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("the capture command fails loudly when the skeleton never finishes loading", async ({ baseURL }) => {
  const out = await mkdtemp(path.join(tmpdir(), "auto-skeleton-"));
  try {
    const failure = await run(process.execPath, [
      "bin/auto-skeleton.mjs",
      "--url",
      `${baseURL}/`,
      "--out",
      out,
      "--breakpoints",
      "1280",
      "--wait",
      "300",
    ]).catch((error: { code: number; stderr: string }) => error);
    expect((failure as { code: number }).code).toBe(1);
    expect((failure as { stderr: string }).stderr).toContain("still loading");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
