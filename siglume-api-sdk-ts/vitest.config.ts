import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      // v0.4 acceptance requires package coverage >= 85% while also preventing
      // regressions in branch/function-heavy runtime paths.
      thresholds: {
        branches: 74,
        functions: 71,
        lines: 85,
        statements: 85,
      },
    },
  },
});
