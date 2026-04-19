import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
    },
    format: ["esm", "cjs"],
    dts: {
      entry: {
        index: "src/index.ts",
      },
    },
    target: "es2022",
    platform: "neutral",
    sourcemap: true,
    splitting: false,
    clean: true,
    outDir: "dist",
  },
  {
    entry: {
      "cli/index": "src/cli/index.ts",
      "bin/siglume": "src/bin/siglume.ts",
    },
    format: ["esm", "cjs"],
    dts: {
      entry: {
        "cli/index": "src/cli/index.ts",
      },
    },
    target: "node18",
    platform: "node",
    sourcemap: true,
    splitting: false,
    clean: false,
    banner: {
      js: "#!/usr/bin/env node",
    },
    outDir: "dist",
  },
]);
