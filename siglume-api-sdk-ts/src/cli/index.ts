import { Command, CommanderError } from "commander";

import { SiglumeProjectError } from "../errors";
import { renderJson } from "../utils";
import {
  createSupportCaseReport,
  diffJsonFiles,
  getUsageReport,
  listOperationCatalog,
  runHarness,
  runRegistration,
  scoreProject,
  validateProject,
  writeInitTemplate,
  writeOperationTemplate,
} from "./project";
import type { CliProjectDependencies } from "./project";

export interface CliRunDependencies extends CliProjectDependencies {
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

function emit(output: ((line: string) => void) | undefined, line: string): void {
  (output ?? console.log)(line);
}

function renderOperationTable(operations: Array<Record<string, unknown>>): string[] {
  const rows = operations.map((item) => [
    String(item.operation_key ?? ""),
    String(item.permission_class ?? "read-only"),
    String(item.summary ?? ""),
  ]);
  const headers = ["operation_key", "permission_class", "summary"];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  return [
    headers.map((header, index) => header.padEnd(widths[index] ?? header.length)).join("  "),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map((row) => row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join("  ")),
  ];
}

export async function runCli(argv: string[], deps: CliRunDependencies = {}): Promise<number> {
  const stdout = deps.stdout;
  const stderr = deps.stderr ?? console.error;
  let completionExitCode = 0;
  const program = new Command()
    .name("siglume")
    .description("Siglume developer CLI")
    .showHelpAfterError()
    .exitOverride();

  program
    .command("init")
    .option("--template <template>", "starter template")
    .option("--from-operation <operation_key>", "generate an AppAdapter wrapper for a first-party owner operation")
    .option("--list-operations", "list owner operations available for template generation", false)
    .option("--capability-key <capability_key>", "override the generated manifest capability_key")
    .option("--agent-id <agent_id>", "owner agent_id used to resolve operation metadata")
    .option("--lang <lang>", "catalog language for live owner operations", "en")
    .option("--json", "emit machine-readable JSON", false)
    .argument("[path]", ".", "destination")
    .action(async (
      path: string,
      options: {
        template?: string;
        fromOperation?: string;
        ["from-operation"]?: string;
        listOperations?: boolean;
        ["list-operations"]?: boolean;
        capabilityKey?: string;
        ["capability-key"]?: string;
        agentId?: string;
        ["agent-id"]?: string;
        lang?: string;
        json?: boolean;
      },
    ) => {
      const template = options.template as "echo" | "price-compare" | "publisher" | "payment" | undefined;
      const operationKey = options.fromOperation;
      const listOperationsFlag = Boolean(options.listOperations);
      if (listOperationsFlag && operationKey) {
        throw new SiglumeProjectError("Choose either --list-operations or --from-operation, not both.");
      }
      if (listOperationsFlag && options.capabilityKey) {
        throw new SiglumeProjectError("--capability-key is only valid together with --from-operation.");
      }
      if (template && (listOperationsFlag || operationKey)) {
        throw new SiglumeProjectError("--template cannot be combined with --list-operations or --from-operation.");
      }

      if (listOperationsFlag) {
        const payload: Record<string, unknown> = {
          ok: true,
          ...(await listOperationCatalog(
            { agent_id: options.agentId, lang: options.lang },
            deps,
          )),
        };
        if (options.json) {
          emit(stdout, renderJson(payload));
          return;
        }
        const warning = typeof payload.warning === "string" ? payload.warning : "";
        if (warning) {
          emit(stderr, warning);
        }
        emit(stdout, `Owner operation catalog (${String(payload.source ?? "fallback")})`);
        const operations = Array.isArray(payload.operations)
          ? payload.operations.filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
          : [];
        renderOperationTable(
          operations,
        ).forEach((line) => emit(stdout, line));
        return;
      }

      if (operationKey) {
        const result = await writeOperationTemplate(
          operationKey,
          path,
          {
            capability_key: options.capabilityKey,
            agent_id: options.agentId,
            lang: options.lang,
          },
          deps,
        );
        const payload = {
          ok: true,
          mode: "from-operation",
          operation: toJsonSafeRecord(result.operation),
          files: result.files,
          report: result.report,
        };
        if (options.json) {
          emit(stdout, renderJson(payload));
          return;
        }
        if (result.report.warning) {
          emit(stderr, String(result.report.warning));
        }
        const quality = (result.report.quality ?? {}) as { grade?: string; overall_score?: number };
        emit(stdout, `Generated wrapper for '${result.operation.operation_key}'.`);
        emit(stdout, `grade: ${quality.grade ?? "?"} (${quality.overall_score ?? "?"}/100)`);
        result.files.forEach((filePath) => emit(stdout, `- ${filePath}`));
        return;
      }

      const resolvedTemplate = (template ?? "echo") as "echo" | "price-compare" | "publisher" | "payment";
      const files = await writeInitTemplate(resolvedTemplate, path);
      const payload = { ok: true, mode: "template", template: resolvedTemplate, files };
      if (options.json) {
        emit(stdout, renderJson(payload));
        return;
      }
      emit(stdout, `Initialized Siglume starter template '${resolvedTemplate}'.`);
      files.forEach((filePath) => emit(stdout, `- ${filePath}`));
    });

  program
    .command("diff")
    .option("--json", "emit machine-readable JSON", false)
    .argument("<old_json>", "previous manifest/tool manual JSON")
    .argument("<new_json>", "next manifest/tool manual JSON")
    .action(async (oldPath: string, newPath: string, options: { json?: boolean }) => {
      const report = await diffJsonFiles(oldPath, newPath);
      if (options.json) {
        emit(stdout, renderJson(report));
      } else {
        const changes = (report.changes as Array<Record<string, unknown>>) ?? [];
        if (changes.length === 0) {
          emit(stdout, "No differences detected.");
        } else {
          for (const level of ["breaking", "warning", "info"]) {
            const items = changes.filter((item) => item.level === level);
            if (items.length === 0) {
              continue;
            }
            emit(stdout, level.toUpperCase());
            items.forEach((item) => emit(stdout, `- ${String(item.path)}: ${String(item.message)}`));
            emit(stdout, "");
          }
        }
      }
      completionExitCode = Number(report.exit_code ?? 0);
    });

  program
    .command("validate")
    .option("--json", "emit machine-readable JSON", false)
    .argument("[path]", ".", "project path")
    .action(async (path: string, options: { json?: boolean }) => {
      const report = await validateProject(path, deps);
      if (options.json) {
        emit(stdout, renderJson(report));
      } else {
        emit(stdout, report.ok ? "Validation passed." : "Validation failed.");
        emit(stdout, `Adapter: ${report.adapter_path}`);
      }
      if (!report.ok) {
        throw new SiglumeProjectError("Validation failed.");
      }
    });

  program
    .command("test")
    .option("--json", "emit machine-readable JSON", false)
    .argument("[path]", ".", "project path")
    .action(async (path: string, options: { json?: boolean }) => {
      const report = await runHarness(path);
      if (options.json) {
        emit(stdout, renderJson(report));
      } else {
        emit(stdout, report.ok ? "Harness passed." : "Harness failed.");
        emit(stdout, `Adapter: ${report.adapter_path}`);
      }
      if (!report.ok) {
        throw new SiglumeProjectError("Harness failed.");
      }
    });

  program
    .command("score")
    .option("--remote", "use the platform preview scorer", false)
    .option("--offline", "use the local parity scorer without network access", false)
    .option("--json", "emit machine-readable JSON", false)
    .argument("[path]", ".", "project path")
    .action(async (path: string, options: { remote?: boolean; offline?: boolean; json?: boolean }) => {
      const mode = options.offline ? "offline" : "remote";
      const report = await scoreProject(path, mode, deps);
      if (options.json) {
        emit(stdout, renderJson(report));
      } else {
        const quality = report.quality as { grade: string; overall_score: number };
        emit(stdout, report.ok ? "Score passed." : "Score failed.");
        emit(stdout, `${mode === "remote" ? "Remote" : "Offline"} quality: ${quality.grade} (${quality.overall_score}/100)`);
      }
      if (!report.ok) {
        throw new SiglumeProjectError("Score failed.");
      }
    });

  program
    .command("register")
    .option("--confirm", "confirm the draft registration immediately", false)
    .option("--submit-review", "submit the draft for review if --confirm is not used", false)
    .option("--json", "emit machine-readable JSON", false)
    .argument("[path]", ".", "project path")
    .action(async (path: string, options: { confirm?: boolean; submitReview?: boolean; json?: boolean; ["submit-review"]?: boolean }) => {
      const report = await runRegistration(path, { confirm: options.confirm, submit_review: options.submitReview }, deps);
      if (options.json) {
        emit(stdout, renderJson(report));
      } else {
        const receipt = report.receipt as { listing_id: string; status: string };
        emit(stdout, "Draft listing created.");
        emit(stdout, `listing_id: ${receipt.listing_id}`);
        emit(stdout, `status: ${receipt.status}`);
      }
    });

  const support = program.command("support").description("Support-case workflows.");
  support
    .command("create")
    .requiredOption("--subject <subject>", "short summary of the issue")
    .requiredOption("--body <body>", "detailed support case body")
    .option("--trace-id <trace_id>", "attach a trace_id from a failed API flow")
    .option("--json", "emit machine-readable JSON", false)
    .action(async (options: { subject: string; body: string; traceId?: string; ["trace-id"]?: string; json?: boolean }) => {
      const report = await createSupportCaseReport(
        { subject: options.subject, body: options.body, trace_id: options.traceId },
        deps,
      );
      if (options.json) {
        emit(stdout, renderJson(report));
        return;
      }
      const supportCase = report.case as { support_case_id: string; status: string };
      emit(stdout, "Support case created.");
      emit(stdout, `case_id: ${supportCase.support_case_id}`);
      emit(stdout, `status: ${supportCase.status}`);
    });

  program
    .command("usage")
    .option("--capability <capability_key>", "filter by capability_key")
    .option("--window <period_key>", "pass-through period_key sent to /market/usage", "30d")
    .option("--json", "emit machine-readable JSON", false)
    .action(async (options: { capability?: string; window: string; json?: boolean }) => {
      const report = await getUsageReport({ capability_key: options.capability, window: options.window }, deps);
      if (options.json) {
        emit(stdout, renderJson(report));
        return;
      }
      emit(stdout, `Usage events: ${report.count}`);
    });

  try {
    await program.parseAsync(argv, { from: "user" });
    return completionExitCode;
  } catch (error) {
    if (error instanceof SiglumeProjectError) {
      emit(stderr, error.message);
      return 1;
    }
    if (error instanceof CommanderError) {
      // Help / version displays carry exitCode 0; parse errors carry a non-zero code.
      // Commander exits are the only class whose exitCode we trust; everything else falls through.
      return typeof error.exitCode === "number" ? error.exitCode : 1;
    }
    // Node system errors (ENOENT, EACCES, ...) and any other uncaught throw
    // are real failures — never report success just because the object has a `code` field.
    emit(stderr, error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function toJsonSafeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value: String(value) };
}
