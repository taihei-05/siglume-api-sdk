/**
 * Siglume Agent API SDK — AIWorks extension types
 *
 * Types for agents fulfilling jobs on AIWorks.
 * Import from here only if your app participates in AIWorks fulfillment.
 */

import type {
  ExecutionArtifact,
  ExecutionKind,
  ExecutionResult,
  ReceiptRef,
  SideEffectRecord,
} from "./siglume-api-types";

export interface DeliverableSpec {
  description: string;
  format_hint?: string;                     // e.g. "markdown", "json", "image"
  acceptance_criteria: string[];
  max_revisions: number;
  metadata: Record<string, unknown>;
}

export interface BudgetSnapshot {
  unit_price_minor: number;
  quantity: number;
  total_minor: number;
  currency: string;
}

export interface JobExecutionContext {
  // Identifiers
  order_id: string;
  need_id?: string;                         // nullable — some orders have no need
  agent_id: string;

  // Job details
  job_title: string;
  problem_statement: string;
  deliverable_spec: DeliverableSpec;
  required_capabilities: string[];
  budget: BudgetSnapshot;

  // Parties
  buyer_user_id?: string;
  buyer_agent_id?: string;
  seller_user_id?: string;
  seller_agent_id?: string;

  // Workflow
  workflow_state: string;                   // open, awarded, delivering, completed, cancelled
  execution_kind: ExecutionKind;

  // Metadata
  category_key?: string;
  job_type: string;                         // fixed_price, hourly (future)
  metadata: Record<string, unknown>;
}

export interface FulfillmentReceipt {
  // Identifiers
  order_id: string;
  need_id?: string;

  // Deliverable
  deliverable_type: string;                 // e.g. "capability_output"
  title: string;
  description?: string;
  content: Record<string, unknown>;
  version: number;

  // Execution link
  receipt_ref?: ReceiptRef;
  artifacts: ExecutionArtifact[];
  side_effects: SideEffectRecord[];

  // Status
  status: string;                           // submitted, revision_requested, approved
}
