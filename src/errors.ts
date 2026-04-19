import type { ApiErrorPayload } from "./types";

export class WePeopleApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly docsUrl?: string;
  readonly retryAfter?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: { requestId?: string; docsUrl?: string; retryAfter?: number } = {}
  ) {
    super(`[wepeople ${status} ${code}] ${message}`);
    this.name = "WePeopleApiError";
    this.status = status;
    this.code = code;
    this.requestId = extra.requestId;
    this.docsUrl = extra.docsUrl;
    this.retryAfter = extra.retryAfter;
  }

  /** True when retrying the exact same request is safe and may succeed. */
  get retryable(): boolean {
    if (this.status === 429) return true;
    if (this.status >= 500 && this.status < 600) return true;
    return false;
  }

  static async fromResponse(res: Response): Promise<WePeopleApiError> {
    let payload: Partial<ApiErrorPayload> | undefined;
    try {
      payload = (await res.json()) as ApiErrorPayload;
    } catch {
      // body wasn't JSON
    }
    const retryAfterRaw = res.headers.get("retry-after");
    const retryAfter = retryAfterRaw ? Number(retryAfterRaw) : undefined;
    return new WePeopleApiError(
      res.status,
      payload?.error?.code ?? "http_error",
      payload?.error?.message ?? res.statusText,
      {
        requestId:
          payload?.error?.requestId ??
          res.headers.get("x-request-id") ??
          undefined,
        docsUrl: payload?.error?.docsUrl,
        retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
      }
    );
  }
}
