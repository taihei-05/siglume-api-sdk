import { describe, expect, it, vi } from "vitest";

describe("siglume bin", () => {
  it("forwards argv to runCli and sets process.exitCode", async () => {
    vi.resetModules();
    const runCli = vi.fn(async () => 7);
    vi.doMock("../src/cli/index", () => ({ runCli }));

    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    process.argv = ["node", "siglume", "score", ".", "--offline"];
    process.exitCode = undefined;

    try {
      await import("../src/bin/siglume");
      expect(runCli).toHaveBeenCalledWith(["score", ".", "--offline"]);
      expect(process.exitCode).toBe(7);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      vi.doUnmock("../src/cli/index");
      vi.resetModules();
    }
  });
});
