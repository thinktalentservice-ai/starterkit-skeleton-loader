import { defineConfig } from "tsup";

// `clean` is off in both configs and done once by the build script instead:
// tsup runs the two in parallel, and one cleaning dist/ would delete what the
// other had just written.
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: false,
    sourcemap: true,
    // NOT `treeshake: true`: it post-processes through rollup, which strips the
    // "use client" banner below. esbuild already tree-shakes when bundling.
    target: "es2020",
    // Peers are never bundled — a second React or a second MUI theme context
    // breaks hooks and theming in the host.
    external: ["react", "react-dom", "@mui/material", "@emotion/react", "@emotion/styled"],
    // esbuild strips top-of-file directives, so "use client" is re-attached to
    // every output chunk. AutoSkeleton uses refs and layout effects; without the
    // directive Next's RSC compiler treats it as a server component.
    banner: { js: '"use client";' },
    outExtension: ({ format }) => ({ js: format === "cjs" ? ".cjs" : ".js" }),
  },
  {
    // The extractor on its own, as a plain script. bin/auto-skeleton.mjs
    // evaluates it inside the page it is capturing, so it must not import
    // anything and must leave one global behind.
    entry: { "extract.global": "src/extract.ts" },
    format: ["iife"],
    globalName: "AutoSkeletonExtract",
    dts: false,
    clean: false,
    minify: true,
    target: "es2020",
    outExtension: () => ({ js: ".js" }),
  },
]);
