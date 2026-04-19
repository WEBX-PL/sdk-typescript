import { WePeopleApiError } from "./errors";
import type {
  IngestBatchResponse,
  IngestEvent,
  IngestSnapshot,
  PingResponse,
  SnapshotResponse,
} from "./types";

export interface WePeopleClientOptions {
  /** `wp_live_*` API key generated from the Developer tab. */
  apiKey: string;
  /** Base URL, e.g. `https://wepeople.example.com`. */
  baseUrl: string;
  /** Optional custom fetch (Node 18+ has `fetch` globally). */
  fetch?: typeof fetch;
  /** Per-request timeout in ms. Default: 15s. */
  timeoutMs?: number;
  /** Max retry attempts for retryable failures. Default: 3. */
  maxRetries?: number;
  /** User-Agent appended to the default. */
  userAgent?: string;
}

interface RequestOptions {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

const DEFAULT_USER_AGENT = "wepeople-sdk/0.1.0";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Cryptographically random-ish idempotency key that works in both Node and
 * browsers without requiring `crypto.randomUUID`.
 */
function makeIdempotencyKey(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `sdk-${Date.now().toString(36)}-${rand}`;
}

export class WePeopleClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly userAgent: string;

  constructor(opts: WePeopleClientOptions) {
    if (!opts.apiKey) throw new Error("WePeopleClient: apiKey is required");
    if (!opts.baseUrl) throw new Error("WePeopleClient: baseUrl is required");

    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error(
        "WePeopleClient: no `fetch` available; pass `fetch` explicitly."
      );
    }
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxRetries = Math.max(0, opts.maxRetries ?? 3);
    this.userAgent = opts.userAgent
      ? `${DEFAULT_USER_AGENT} ${opts.userAgent}`
      : DEFAULT_USER_AGENT;
  }

  /**
   * Verify the key and return metadata about the associated developer app.
   * Good sanity check on startup.
   */
  async ping(signal?: AbortSignal): Promise<PingResponse> {
    return this.request<PingResponse>({
      method: "GET",
      path: "/api/v1/ingest/ping",
      signal,
    });
  }

  /**
   * Send a batch of events. Rejected entries live in `results.rejected`;
   * only retry those specific indices to avoid duplicates.
   */
  async ingestEvents(
    events: IngestEvent[],
    options: { idempotencyKey?: string; signal?: AbortSignal } = {}
  ): Promise<IngestBatchResponse> {
    if (!events.length) {
      throw new Error("ingestEvents: events must not be empty");
    }
    return this.request<IngestBatchResponse>({
      method: "POST",
      path: "/api/v1/ingest/events",
      body: { events },
      idempotencyKey: options.idempotencyKey ?? makeIdempotencyKey(),
      signal: options.signal,
    });
  }

  /**
   * Push a single metric snapshot. Only the latest snapshot per worker per
   * app is rendered on the user strip; older ones remain queryable events.
   */
  async ingestSnapshot(
    snapshot: IngestSnapshot,
    options: { idempotencyKey?: string; signal?: AbortSignal } = {}
  ): Promise<SnapshotResponse> {
    return this.request<SnapshotResponse>({
      method: "POST",
      path: "/api/v1/ingest/snapshots",
      body: snapshot,
      idempotencyKey: options.idempotencyKey ?? makeIdempotencyKey(),
      signal: options.signal,
    });
  }

  private async request<T>(opts: RequestOptions): Promise<T> {
    const url = `${this.baseUrl}${opts.path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "User-Agent": this.userAgent,
    };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (opts.idempotencyKey) {
      headers["Idempotency-Key"] = opts.idempotencyKey;
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const signal = mergeSignals(opts.signal, controller.signal);

      try {
        const res = await this.fetchImpl(url, {
          method: opts.method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal,
        });

        if (res.ok || res.status === 207) {
          return (await res.json()) as T;
        }

        const err = await WePeopleApiError.fromResponse(res);
        if (!err.retryable || attempt === this.maxRetries) throw err;

        const waitMs =
          (err.retryAfter ?? 0) * 1000 || backoffMs(attempt);
        lastError = err;
        await sleep(waitMs);
        continue;
      } catch (cause) {
        if (cause instanceof WePeopleApiError) {
          if (!cause.retryable || attempt === this.maxRetries) throw cause;
          lastError = cause;
          await sleep(backoffMs(attempt));
          continue;
        }
        // Network / abort errors: retry a few times, then rethrow.
        if (attempt === this.maxRetries) throw cause;
        lastError = cause;
        await sleep(backoffMs(attempt));
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError ?? new Error("request failed");
  }
}

function backoffMs(attempt: number): number {
  const base = Math.min(8_000, 250 * 2 ** attempt);
  const jitter = Math.random() * base * 0.25;
  return Math.round(base + jitter);
}

function mergeSignals(
  a: AbortSignal | undefined,
  b: AbortSignal
): AbortSignal {
  if (!a) return b;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  if (a.aborted || b.aborted) controller.abort();
  return controller.signal;
}
