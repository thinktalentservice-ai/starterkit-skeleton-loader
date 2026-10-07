import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
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
});
