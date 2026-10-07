#!/usr/bin/env node
// auto-skeleton — capture skeleton shapes from a running app.
//
// Opens each URL at each viewport width, finds every <AutoSkeleton name="…">
// that has finished loading, measures it with the same extractor the component
// uses, and writes <out>/<name>.bones.json. Import that file and pass it as
// `captured`: it is what the page shows before any JavaScript has run.
//
// Needs Playwright in the project that runs it (`playwright` or
// `@playwright/test`); this package does not depend on it.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const HELP = `auto-skeleton --url <url> [--url <url> …] [options]

  --url <url>            Page to capture. Repeat for several pages.
  --out <dir>            Where to write <name>.bones.json   (default: src/skeletons)
  --breakpoints <list>   Viewport widths, comma separated   (default: 375,768,1280)
  --name <name>          Only capture this skeleton. Repeat for several.
  --wait <ms>            Extra time to wait after load      (default: 1000)
  --max-height <px>      Capture no further down than this  (default: 1200)
  --color-scheme <s>     light | dark | no-preference
  --storage-state <file> Playwright storage state, for pages behind a login
  --help

Each <AutoSkeleton> to capture needs a \`name\`, and must be showing its real
content (loading={false}) when the page settles.`;

const { values } = parseArgs({
  options: {
    url: { type: "string", multiple: true },
    out: { type: "string", default: "src/skeletons" },
    breakpoints: { type: "string", default: "375,768,1280" },
    name: { type: "string", multiple: true },
    wait: { type: "string", default: "1000" },
    "max-height": { type: "string", default: "1200" },
    "color-scheme": { type: "string" },
    "storage-state": { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (values.help || !values.url?.length) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

const breakpoints = values.breakpoints
  .split(",")
  .map((part) => Number(part.trim()))
  .filter((width) => Number.isInteger(width) && width > 0)
  .sort((a, b) => a - b);
const wait = Number(values.wait);
const maxHeight = Number(values["max-height"]);
if (!breakpoints.length || !Number.isFinite(wait) || !(maxHeight > 0)) {
  console.error("auto-skeleton: --breakpoints, --wait and --max-height must be numbers.\n\n" + HELP);
  process.exit(1);
}

/** Playwright from the project running the command, not from this package. */
async function loadChromium() {
  const fromProject = createRequire(path.join(process.cwd(), "package.json"));
  for (const id of ["playwright", "@playwright/test"]) {
    try {
      const mod = await import(pathToFileURL(fromProject.resolve(id)).href);
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return chromium;
    } catch {
      // try the next one
    }
  }
  console.error("auto-skeleton: Playwright is not installed here. Add it with: pnpm add -D playwright");
  process.exit(1);
}

const round = (value) => Math.round(value * 10) / 10;
const BONE = "var(--auto-skeleton-bone)";

/**
 * A measured frame carries the colours of the theme it was captured in. A
 * capture is shown in every theme, so its frames are redrawn as outlines in the
 * bone colour: the sides that had a border, or all four when the frame was a
 * fill or a shadow with no border to keep.
 */
function neutralFrame(surface) {
  const sides = ["borderTop", "borderRight", "borderBottom", "borderLeft"];
  const outlined = sides.some((side) => surface[side]);
  const line = `1px solid ${BONE}`;
  // Only the sides that are drawn: a data table is hundreds of cell frames, and
  // spelling out every empty property made its capture several times larger.
  return Object.fromEntries(sides.filter((side) => !outlined || surface[side]).map((side) => [side, line]));
}

/**
 * A clip is in captured pixels and cannot stretch with the wrapper, so it is
 * applied here instead: the bone is cropped to what was actually visible. Its
 * rounded corners are lost; a column half-hidden under a pinned one is not
 * drawn across it.
 */
function tidy(bone) {
  let { x, y, width, height } = bone;
  if (bone.clip) {
    const right = Math.min(x + width, bone.clip.x + bone.clip.width);
    const bottom = Math.min(y + height, bone.clip.y + bone.clip.height);
    x = Math.max(x, bone.clip.x);
    y = Math.max(y, bone.clip.y);
    width = right - x;
    height = bottom - y;
    if (width <= 0 || height <= 0) return null;
  }
  const out = {
    kind: bone.kind,
    variant: bone.variant,
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
    radius: bone.radius,
  };
  if (bone.kind === "surface") out.surface = neutralFrame(bone.surface ?? {});
  return out;
}

/** Runs in the page. `AutoSkeletonExtract` is the extractor evaluated just before. */
async function measureInPage() {
  const results = [];
  for (const root of document.querySelectorAll("[data-auto-skeleton][data-auto-skeleton-name]")) {
    const name = root.getAttribute("data-auto-skeleton-name");
    const content = root.querySelector(":scope > [data-auto-skeleton-content]");
    if (!name || !content) continue;
    if (root.getAttribute("aria-busy") === "true") {
      results.push({ name, loading: true });
      continue;
    }
    // Entrance animations: measure where things come to rest.
    const running = root
      .getAnimations({ subtree: true })
      .filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)));
    await Promise.allSettled(running.map((animation) => animation.finished));
    results.push({
      name,
      width: root.clientWidth,
      height: root.clientHeight,
      // eslint-disable-next-line no-undef
      bones: AutoSkeletonExtract.extractBones(content, { origin: root }),
    });
  }
  return results;
}

const extractor = await readFile(new URL("../dist/extract.global.js", import.meta.url), "utf8");
const chromium = await loadChromium();
const browser = await chromium.launch();

/** name -> { viewport -> snapshot } */
const captured = new Map();
const stillLoading = new Set();

try {
  for (const viewport of breakpoints) {
    const context = await browser.newContext({
      viewport: { width: viewport, height: 900 },
      ...(values["color-scheme"] ? { colorScheme: values["color-scheme"] } : {}),
      ...(values["storage-state"] ? { storageState: values["storage-state"] } : {}),
    });
    const page = await context.newPage();
    for (const url of values.url) {
      await page.goto(url, { waitUntil: "load" });
      await page.waitForTimeout(wait);
      // evaluate(), not a <script> tag: a page's Content-Security-Policy does
      // not apply to it. The bundle is strict-mode code, so its top-level `var`
      // stays inside the evaluation — hence the explicit hand-off to globalThis.
      await page.evaluate(`${extractor}\n;globalThis.AutoSkeletonExtract = AutoSkeletonExtract;`);
      for (const found of await page.evaluate(measureInPage)) {
        if (values.name?.length && !values.name.includes(found.name)) continue;
        if (found.loading) {
          stillLoading.add(found.name);
          continue;
        }
        const bones = found.bones
          .filter((bone) => bone.y < maxHeight)
          .map(tidy)
          .filter(Boolean);
        if (!bones.length) continue;
        if (!captured.has(found.name)) captured.set(found.name, {});
        captured.get(found.name)[viewport] = {
          width: round(found.width),
          height: round(Math.min(found.height, maxHeight)),
          bones,
        };
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}

await mkdir(values.out, { recursive: true });
for (const [name, byViewport] of captured) {
  // One line per viewport: small on disk, and a re-capture diffs per breakpoint.
  const lines = Object.entries(byViewport).map(
    ([viewport, snapshot]) => `    ${JSON.stringify(viewport)}: ${JSON.stringify(snapshot)}`,
  );
  const file = path.join(values.out, `${name}.bones.json`);
  await writeFile(file, `{\n  "name": ${JSON.stringify(name)},\n  "breakpoints": {\n${lines.join(",\n")}\n  }\n}\n`);
  const summary = Object.entries(byViewport)
    .map(([viewport, snapshot]) => `${viewport}px: ${snapshot.bones.length}`)
    .join(", ");
  console.log(`✓ ${file}  (pieces — ${summary})`);
}

for (const name of stillLoading) {
  if (!captured.has(name)) {
    console.error(`✖ "${name}" was still loading when the page settled — nothing captured. Try a longer --wait.`);
  }
}
if (captured.size === 0) {
  console.error('✖ Nothing captured. Is there an <AutoSkeleton name="…"> on the page, showing its real content?');
  process.exit(1);
}
