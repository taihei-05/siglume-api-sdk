export class SiglumeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class SiglumeClientError extends SiglumeError {}

export class SiglumeProjectError extends SiglumeError {}

export class SiglumeValidationError extends SiglumeError {}

export class SiglumeAssistError extends SiglumeClientError {}

export class SiglumeNotFoundError extends SiglumeClientError {}

export class SiglumeWebhookError extends SiglumeError {}

export class SiglumeWebhookSignatureError extends SiglumeWebhookError {}

export class SiglumeWebhookPayloadError extends SiglumeWebhookError {}

export class SiglumeWebhookReplayError extends SiglumeWebhookError {}

export class SiglumeAPIError extends SiglumeClientError {
  status_code: number;
  error_code?: string;
  trace_id?: string | null;
  request_id?: string | null;
  details: Record<string, unknown>;
  response_body?: unknown;

  constructor(
    message: string,
    options: {
      status_code: number;
      error_code?: string;
      trace_id?: string | null;
      request_id?: string | null;
      details?: Record<string, unknown>;
      response_body?: unknown;
    },
  ) {
    super(message);
    this.status_code = options.status_code;
    this.error_code = options.error_code;
    this.trace_id = options.trace_id;
    this.request_id = options.request_id;
    this.details = options.details ?? {};
    this.response_body = options.response_body;
  }
}
