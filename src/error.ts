export interface FastrelayRateLimit {
  limit?: number;
  remaining?: number;
  reset?: number;
}

export class FastrelayApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly hint?: string;
  readonly docUrl?: string;
  readonly requestId?: string;
  readonly path?: string;
  readonly method?: string;
  readonly rateLimit?: FastrelayRateLimit;

  constructor(args: {
    message: string;
    status: number;
    code?: string;
    details?: unknown;
    hint?: string;
    docUrl?: string;
    requestId?: string;
    path?: string;
    method?: string;
    rateLimit?: FastrelayRateLimit;
  }) {
    super(args.message);
    this.name = 'FastrelayApiError';
    this.status = args.status;
    this.code = args.code;
    this.details = args.details;
    this.hint = args.hint;
    this.docUrl = args.docUrl;
    this.requestId = args.requestId;
    this.path = args.path;
    this.method = args.method;
    this.rateLimit = args.rateLimit;
  }
}
