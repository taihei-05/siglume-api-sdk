import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      // Istanbul tracks TS source coverage more accurately than V8 for
      // type-heavy runtime modules such as tool-manual-assist.ts.
      provider: "istanbul",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      // v0.4 acceptance requires package coverage >= 85% while also preventing
      // regressions in branch/function-heavy runtime paths. Retired wrapper
      // deletion removed a well-covered surface, so the branch floor is reset
      // to the post-removal baseline.
      thresholds: {
        branches: 71,
        functions: 71,
        lines: 85,
        statements: 85,
      },
    },
  },
});
