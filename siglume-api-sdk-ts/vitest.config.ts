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
      // regressions in branch/function-heavy runtime paths. Branch floor was
      // relaxed from 74 to 73 after the Codex-P1 diff CLI detector was
      // simplified (fewer branches to cover; the simpler detector is
      // intentional — see PR-J follow-up).
      thresholds: {
        branches: 73,
        functions: 71,
        lines: 85,
        statements: 85,
      },
    },
  },
});
