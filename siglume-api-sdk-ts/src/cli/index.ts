import { Command, CommanderError } from "commander";

import { SiglumeProjectError } from "../errors";
import { renderJson } from "../utils";
import {
  createSupportCaseReport,
  diffJsonFiles,
  getUsageReport,
  runHarness,
  runRegistration,
  scoreProject,
  validateProject,
  writeInitTemplate,
} from "./project";
import type { CliProjectDependencies } from "./project";

export interface CliRunDependencies extends CliProjectDependencies {
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

function emit(output: ((line: string) => void) | undefined, line: string): void {
  (output ?? console.log)(line);
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
    .option("--template <template>", "starter template", "echo")
    .option("--json", "emit machine-readable JSON", false)
    .argument("[path]", ".", "destination")
    .action(async (path: string, options: { template: string; json?: boolean }) => {
      const template = options.template as "echo" | "price-compare" | "publisher" | "payment";
      const files = await writeInitTemplate(template, path);
      const payload = { ok: true, template, files };
      if (options.json) {
        emit(stdout, renderJson(payload));
        return;
      }
      emit(stdout, `Initialized Siglume starter template '${template}'.`);
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
