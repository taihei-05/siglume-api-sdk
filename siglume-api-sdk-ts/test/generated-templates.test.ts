import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runHarness, writeOperationTemplate } from "../src/cli/project";
import { score_tool_manual_offline, validate_tool_manual } from "../src/index";

const GENERATED_OPERATIONS = [
  "owner.charter.update",
  "owner.approval_policy.update",
  "owner.budget.get",
] as const;

async function linkSourcePackage(projectDir: string): Promise<void> {
  const scopedDir = join(projectDir, "node_modules", "@siglume");
  const packageDir = join(scopedDir, "api-sdk");
  await mkdir(scopedDir, { recursive: true });
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify(
      {
        name: "@siglume/api-sdk",
        type: "module",
        exports: {
          ".": "./src/index.ts",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await symlink(join(process.cwd(), "src"), join(packageDir, "src"), "junction");
}

describe("generated operation templates", () => {
  it.each(GENERATED_OPERATIONS)("generates a runnable scaffold for %s", async (operationKey) => {
    const projectDir = await mkdtemp(join(tmpdir(), "siglume-ts-generated-"));
    await writeOperationTemplate(operationKey, projectDir);
    await linkSourcePackage(projectDir);

    const manual = JSON.parse(await readFile(join(projectDir, "tool_manual.json"), "utf8")) as Record<string, unknown>;
    const [ok, issues] = validate_tool_manual(manual);
    const quality = score_tool_manual_offline(manual);
    const harnessReport = await runHarness(projectDir);

    expect(ok).toBe(true);
    expect(issues).toEqual([]);
    expect(["A", "B"]).toContain(quality.grade);
    expect(harnessReport.ok).toBe(true);
  });
});
