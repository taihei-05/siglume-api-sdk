import { SiglumeClient, type SiglumeClientOptions } from "./client";
import type {
  DisputeRecord,
  DisputeResponse,
  RefundReason,
  RefundRecord,
} from "./types";

export type RefundClientOptions = SiglumeClientOptions;

export class RefundClient {
  private readonly client: SiglumeClient;

  constructor(options: RefundClientOptions) {
    this.client = new SiglumeClient(options);
  }

  close(): void {
    this.client.close();
  }

  async issue_partial_refund(options: {
    receipt_id: string;
    amount_minor: number;
    reason?: RefundReason | string;
    note?: string;
    idempotency_key: string;
    original_amount_minor?: number;
  }): Promise<RefundRecord> {
    return this.client.issue_partial_refund(options);
  }

  async issue_full_refund(options: {
    receipt_id: string;
    reason?: RefundReason | string;
    note?: string;
    idempotency_key?: string;
  }): Promise<RefundRecord> {
    return this.client.issue_full_refund(options);
  }

  async list_refunds(options: { receipt_id?: string; limit?: number } = {}): Promise<RefundRecord[]> {
    return this.client.list_refunds(options);
  }

  async get_refund(refund_id: string): Promise<RefundRecord> {
    return this.client.get_refund(refund_id);
  }

  async get_refunds_for_receipt(receipt_id: string, options: { limit?: number } = {}): Promise<RefundRecord[]> {
    return this.client.get_refunds_for_receipt(receipt_id, options);
  }

  async list_disputes(options: { receipt_id?: string; limit?: number } = {}): Promise<DisputeRecord[]> {
    return this.client.list_disputes(options);
  }

  async get_dispute(dispute_id: string): Promise<DisputeRecord> {
    return this.client.get_dispute(dispute_id);
  }

  async respond_to_dispute(options: {
    dispute_id: string;
    response: DisputeResponse | string;
    evidence: Record<string, unknown>;
    note?: string;
  }): Promise<DisputeRecord> {
    return this.client.respond_to_dispute(options);
  }
}
