import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli/index";

async function writePair(oldPayload: Record<string, unknown>, newPayload: Record<string, unknown>): Promise<{ oldPath: string; newPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "siglume-ts-diff-cli-"));
  const oldPath = join(dir, "old.json");
  const newPath = join(dir, "new.json");
  await writeFile(oldPath, JSON.stringify(oldPayload, null, 2), "utf8");
  await writeFile(newPath, JSON.stringify(newPayload, null, 2), "utf8");
  return { oldPath, newPath };
}

describe("siglume diff CLI", () => {
  it("returns exit code 1 for breaking changes in text mode", async () => {
    const stdout: string[] = [];
    const { oldPath, newPath } = await writePair(
      {
        capability_key: "echo-helper",
        version: "1.0.0",
        name: "Echo Helper",
        job_to_be_done: "Echo the provided text back to the owner.",
        permission_class: "read-only",
        approval_mode: "auto",
        dry_run_supported: true,
        required_connected_accounts: [],
        price_model: "free",
        currency: "USD",
        jurisdiction: "US",
      },
      {
        capability_key: "echo-helper",
        version: "1.0.0",
        name: "Echo Helper",
        job_to_be_done: "Echo the provided text back to the owner.",
        permission_class: "action",
        approval_mode: "auto",
        dry_run_supported: true,
        required_connected_accounts: [],
        price_model: "subscription",
        currency: "USD",
        jurisdiction: "US",
      },
    );

    const exitCode = await runCli(["diff", oldPath, newPath], { stdout: (line) => stdout.push(line) });

    expect(exitCode).toBe(1);
    expect(stdout.some((line) => line.includes("BREAKING"))).toBe(true);
    expect(stdout.some((line) => line.includes("price_model"))).toBe(true);
  });

  it("returns exit code 2 and machine-readable JSON for warning-only changes", async () => {
    const stdout: string[] = [];
    const { oldPath, newPath } = await writePair(
      {
        tool_name: "publish_post",
        job_to_be_done: "Publish a post after the owner approves the action.",
        summary_for_model: "Creates a post after approval.",
        trigger_conditions: [
          "owner asks the agent to publish a drafted post",
          "agent has final post content ready for submission",
          "request is to send prepared copy to an external publishing tool",
        ],
        do_not_use_when: ["the owner has not approved the outbound post"],
        permission_class: "action",
        dry_run_supported: true,
        requires_connected_accounts: ["publisher"],
        input_schema: { type: "object", properties: { body: { type: "string" } }, required: ["body"], additionalProperties: false },
        output_schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false },
        usage_hints: ["Use only after the final post body is ready."],
        result_hints: ["Confirm where the post was published."],
        error_hints: ["Explain any provider rejection clearly."],
        approval_summary_template: "Publish the prepared post.",
        preview_schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false },
        idempotency_support: true,
        side_effect_summary: "Creates a new post in the connected provider.",
        jurisdiction: "US",
      },
      {
        tool_name: "publish_post",
        job_to_be_done: "Publish a post after the owner approves the action.",
        summary_for_model: "Creates a post after approval.",
        trigger_conditions: [
          "owner asks to broadcast a release announcement",
          "agent needs to fan out prepared messaging to an external channel",
          "request is to push already-approved content to a live audience",
        ],
        do_not_use_when: [
          "the content still needs editing or legal review",
          "the owner has not approved the outbound post",
        ],
        permission_class: "action",
        dry_run_supported: true,
        requires_connected_accounts: ["publisher"],
        input_schema: { type: "object", properties: { body: { type: "string" } }, required: ["body"], additionalProperties: false },
        output_schema: {
          type: "object",
          properties: { summary: { type: "string" }, provider_status: { type: "string" } },
          required: ["summary"],
          additionalProperties: false,
        },
        usage_hints: ["Use only after the final post body is ready."],
        result_hints: ["Confirm where the post was published."],
        error_hints: ["Explain any provider rejection clearly."],
        approval_summary_template: "Publish the approved post to the selected channel.",
        preview_schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false },
        idempotency_support: true,
        side_effect_summary: "Creates a new post in the connected provider.",
        jurisdiction: "US",
      },
    );

    const exitCode = await runCli(["diff", oldPath, newPath, "--json"], { stdout: (line) => stdout.push(line) });

    expect(exitCode).toBe(2);
    const payload = JSON.parse(stdout.join("\n")) as { exit_code: number; changes: Array<{ level: string; path: string }> };
    expect(payload.exit_code).toBe(2);
    expect(payload.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: "warning", path: "output_schema.properties" }),
        expect.objectContaining({ level: "warning", path: "approval_summary_template" }),
      ]),
    );
  });

  it("returns exit code 0 for unchanged documents", async () => {
    const { oldPath, newPath } = await writePair(
      {
        capability_key: "echo-helper",
        version: "1.0.0",
        name: "Echo Helper",
        job_to_be_done: "Echo the provided text back to the owner.",
        permission_class: "read-only",
        approval_mode: "auto",
        dry_run_supported: true,
        required_connected_accounts: [],
        price_model: "free",
        currency: "USD",
        jurisdiction: "US",
      },
      {
        capability_key: "echo-helper",
        version: "1.0.0",
        name: "Echo Helper",
        job_to_be_done: "Echo the provided text back to the owner.",
        permission_class: "read-only",
        approval_mode: "auto",
        dry_run_supported: true,
        required_connected_accounts: [],
        price_model: "free",
        currency: "USD",
        jurisdiction: "US",
      },
    );
    const stdout: string[] = [];

    const exitCode = await runCli(["diff", oldPath, newPath], { stdout: (line) => stdout.push(line) });

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(["No differences detected."]);
    expect(await readFile(oldPath, "utf8")).toContain("Echo Helper");
  });

  it("accepts minimal manifests with only identity fields (Codex P1 on PR #100)", async () => {
    // Optional fields have defaults in the dataclass shape; the diff engine
    // normalizes them, so detection must only require the identity key.
    const stdout: string[] = [];
    const { oldPath, newPath } = await writePair(
      {
        capability_key: "partial",
        permission_class: "read-only",
      },
      {
        capability_key: "partial",
        permission_class: "read-only",
      },
    );

    const exitCode = await runCli(["diff", oldPath, newPath], {
      stdout: (line) => stdout.push(line),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("No differences detected.");
  });

  it("rejects truly unknown document kinds (no capability_key or tool_name)", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const { oldPath, newPath } = await writePair(
      { unrelated: "data" },
      { unrelated: "data" },
    );

    const exitCode = await runCli(["diff", oldPath, newPath], {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("Could not detect document type");
  });
});
