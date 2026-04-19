import type {
  AppManifest,
  Awaitable,
  ConnectedAccountRef,
  ExecutionContext,
  ExecutionKind,
  ExecutionResult,
  HealthCheckResult,
  ToolManual,
  ToolManualIssue,
} from "./types";
import { ApprovalMode, Environment, PermissionClass } from "./types";
import { validate_tool_manual } from "./tool-manual-validator";

const CAPABILITY_KEY_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

function normalizeExecutionResult(result: ExecutionResult, executionKind: ExecutionKind): ExecutionResult {
  return {
    success: Boolean(result.success),
    output: result.output ?? {},
    execution_kind: result.execution_kind ?? executionKind,
    units_consumed: result.units_consumed ?? 1,
    amount_minor: result.amount_minor ?? 0,
    currency: result.currency ?? "USD",
    provider_status: result.provider_status ?? "ok",
    error_message: result.error_message,
    fallback_applied: result.fallback_applied ?? false,
    needs_approval: result.needs_approval ?? false,
    approval_prompt: result.approval_prompt,
    receipt_summary: result.receipt_summary ?? {},
    artifacts: result.artifacts ?? [],
    side_effects: result.side_effects ?? [],
    receipt_ref: result.receipt_ref,
    approval_hint: result.approval_hint,
  };
}

export abstract class AppAdapter {
  abstract manifest(): Awaitable<AppManifest>;
  abstract execute(ctx: ExecutionContext): Awaitable<ExecutionResult>;

  async health_check(): Promise<HealthCheckResult> {
    return { healthy: true, message: "" };
  }

  async on_install(_agent_id: string, _owner_user_id: string): Promise<void> {}

  async on_uninstall(_agent_id: string, _owner_user_id: string): Promise<void> {}

  supported_task_types(): string[] {
    return ["default"];
  }
}

export class StubProvider {
  provider_key: string;

  constructor(provider_key: string) {
    this.provider_key = provider_key;
  }

  async handle(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return {
      status: "stub_ok",
      provider: this.provider_key,
      method,
      params,
    };
  }
}

export class AppTestHarness {
  app: AppAdapter;
  stubs: Record<string, StubProvider>;

  constructor(app: AppAdapter, stubs: Record<string, StubProvider> = {}) {
    this.app = app;
    this.stubs = stubs;
  }

  private async executeWithKind(
    execution_kind: ExecutionKind,
    task_type = "default",
    options: {
      connected_accounts?: Record<string, ConnectedAccountRef>;
      input_params?: Record<string, unknown>;
      trace_id?: string;
      idempotency_key?: string;
      request_hash?: string;
      budget_remaining_minor?: number | null;
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<ExecutionResult> {
    const connected_accounts =
      options.connected_accounts ??
      Object.fromEntries(
        Object.keys(this.stubs).map((key) => [
          key,
          {
            provider_key: key,
            session_token: `stub-token-${key}`,
            environment: Environment.SANDBOX,
            scopes: [],
          },
        ]),
      );
    const ctx: ExecutionContext = {
      agent_id: "test-agent-001",
      owner_user_id: "test-owner-001",
      task_type,
      environment: Environment.SANDBOX,
      execution_kind,
      connected_accounts,
      input_params: options.input_params ?? {},
      trace_id: options.trace_id,
      idempotency_key: options.idempotency_key,
      request_hash: options.request_hash,
      budget_remaining_minor: options.budget_remaining_minor ?? null,
      metadata: options.metadata ?? {},
    };
    return normalizeExecutionResult(await this.app.execute(ctx), execution_kind);
  }

  async dry_run(task_type = "default", options: Parameters<AppTestHarness["executeWithKind"]>[2] = {}) {
    return this.executeWithKind("dry_run", task_type, options);
  }

  async execute_action(task_type = "default", options: Parameters<AppTestHarness["executeWithKind"]>[2] = {}) {
    return this.executeWithKind("action", task_type, options);
  }

  async execute_quote(task_type = "default", options: Parameters<AppTestHarness["executeWithKind"]>[2] = {}) {
    return this.executeWithKind("quote", task_type, options);
  }

  async execute_payment(task_type = "default", options: Parameters<AppTestHarness["executeWithKind"]>[2] = {}) {
    return this.executeWithKind("payment", task_type, options);
  }

  async health(): Promise<HealthCheckResult> {
    return this.app.health_check();
  }

  async validate_manifest(): Promise<string[]> {
    const manifest = await this.app.manifest();
    const issues: string[] = [];
    if (!manifest.capability_key) {
      issues.push("capability_key is required");
    } else if (!CAPABILITY_KEY_RE.test(manifest.capability_key)) {
      issues.push("capability_key must be lowercase alphanumeric with hyphens (e.g., 'price-compare-helper')");
    }
    if (!manifest.name) {
      issues.push("name is required");
    }
    if (!manifest.job_to_be_done) {
      issues.push("job_to_be_done is required");
    }
    if (!manifest.example_prompts || manifest.example_prompts.length === 0) {
      issues.push("at least one example_prompt is recommended");
    }
    if (manifest.permission_class === PermissionClass.ACTION || manifest.permission_class === PermissionClass.PAYMENT) {
      if (!manifest.dry_run_supported) {
        issues.push("action/payment apps should support dry_run");
      }
      if ((manifest.approval_mode ?? ApprovalMode.AUTO) === ApprovalMode.AUTO) {
        issues.push("action/payment apps should not use auto approval");
      }
    }
    return issues;
  }

  validate_tool_manual(manual?: ToolManual | Record<string, unknown>): [boolean, ToolManualIssue[]] {
    if (!manual) {
      return [true, []];
    }
    return validate_tool_manual(manual);
  }

  validate_receipt(result: ExecutionResult): string[] {
    const issues: string[] = [];
    if (result.execution_kind !== "dry_run") {
      const hasLegacy = Boolean(result.receipt_summary && Object.keys(result.receipt_summary).length > 0);
      const hasStructured = Boolean((result.artifacts?.length ?? 0) > 0 || (result.side_effects?.length ?? 0) > 0);
      if (!hasLegacy && !hasStructured) {
        issues.push("Non-dry-run execution should include receipt_summary or structured artifacts/side_effects");
      }
    }

    if (result.execution_kind === "action" || result.execution_kind === "payment") {
      if ((result.side_effects?.length ?? 0) === 0 && !result.receipt_summary) {
        issues.push("Action/payment execution should report side effects");
      }
    }

    if (result.needs_approval && !result.approval_prompt && !result.approval_hint) {
      issues.push("needs_approval=True but no approval_prompt or approval_hint provided");
    }

    for (const [index, artifact] of (result.artifacts ?? []).entries()) {
      if (!artifact.artifact_type) {
        issues.push(`artifacts[${index}].artifact_type is empty`);
      }
    }

    for (const [index, sideEffect] of (result.side_effects ?? []).entries()) {
      if (!sideEffect.action) {
        issues.push(`side_effects[${index}].action is empty`);
      }
      if (!sideEffect.provider) {
        issues.push(`side_effects[${index}].provider is empty`);
      }
    }

    return issues;
  }

  async simulate_connected_account_missing(
    task_type = "default",
    options: Parameters<AppTestHarness["executeWithKind"]>[2] = {},
  ) {
    return this.executeWithKind("dry_run", task_type, {
      ...options,
      connected_accounts: {},
    });
  }
}
