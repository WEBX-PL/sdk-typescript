import { test } from "node:test";
import assert from "node:assert/strict";
import { WePeopleClient, WePeopleApiError } from "../src/index";

type FetchCall = {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
};

/** Builds a fake fetch that returns queued responses in order. */
function makeFakeFetch(
  responses: Array<() => Response>
): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let i = 0;
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const headers = Object.fromEntries(
      new Headers((init as RequestInit).headers).entries()
    );
    calls.push({ url, init: { ...(init as RequestInit), headers } });
    const next = responses[i++];
    if (!next) throw new Error("fake fetch: no more queued responses");
    return next();
  };
  return { fetch: fetchImpl, calls };
}

test("retries on 429 honoring Retry-After, then succeeds", async () => {
  const { fetch, calls } = makeFakeFetch([
    () =>
      new Response(
        JSON.stringify({ error: { code: "rate_limited", message: "slow down" } }),
        {
          status: 429,
          headers: { "retry-after": "0", "content-type": "application/json" },
        }
      ),
    () =>
      new Response(
        JSON.stringify({
          requestId: "req_ok",
          accepted: 1,
          rejected: 0,
          batchLimit: 500,
          results: { accepted: [], rejected: [] },
        }),
        { status: 202, headers: { "content-type": "application/json" } }
      ),
  ]);

  const client = new WePeopleClient({
    apiKey: "wp_live_test",
    baseUrl: "https://example.test",
    fetch,
    maxRetries: 2,
    timeoutMs: 2_000,
  });

  const res = await client.ingestEvents([
    {
      eventType: "ticket.resolved",
      category: "project_management",
      actor: { email: "alex@acme.com" },
    },
  ]);

  assert.equal(res.requestId, "req_ok");
  assert.equal(calls.length, 2, "should retry exactly once after 429");
  assert.equal(calls[0]!.url, "https://example.test/api/v1/ingest/events");
  assert.ok(
    calls[0]!.init.headers["idempotency-key"]?.startsWith("sdk-"),
    "auto-generated idempotency key present"
  );
  assert.equal(
    calls[0]!.init.headers["idempotency-key"],
    calls[1]!.init.headers["idempotency-key"],
    "retry reuses the same idempotency key"
  );
  assert.equal(calls[0]!.init.headers["authorization"], "Bearer wp_live_test");
});

test("non-retryable 400 throws WePeopleApiError immediately", async () => {
  const { fetch, calls } = makeFakeFetch([
    () =>
      new Response(
        JSON.stringify({
          error: {
            code: "invalid_body",
            message: "events[0].category is required",
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      ),
  ]);

  const client = new WePeopleClient({
    apiKey: "wp_live_test",
    baseUrl: "https://example.test/",
    fetch,
    maxRetries: 3,
  });

  await assert.rejects(
    () =>
      client.ingestEvents([
        {
          eventType: "ticket.resolved",
          category: "project_management",
          actor: { email: "alex@acme.com" },
        },
      ]),
    (err: unknown) => {
      assert.ok(err instanceof WePeopleApiError);
      assert.equal(err.status, 400);
      assert.equal(err.code, "invalid_body");
      assert.equal(err.retryable, false);
      return true;
    }
  );

  assert.equal(calls.length, 1, "should not retry on 400");
});

test("207 Multi-Status is returned as a successful response", async () => {
  const { fetch } = makeFakeFetch([
    () =>
      new Response(
        JSON.stringify({
          requestId: "req_partial",
          accepted: 1,
          rejected: 1,
          batchLimit: 500,
          results: {
            accepted: [{ eventType: "ticket.resolved", timestamp: "now" }],
            rejected: [{ index: 1, code: "invalid_body", message: "bad" }],
          },
        }),
        { status: 207, headers: { "content-type": "application/json" } }
      ),
  ]);

  const client = new WePeopleClient({
    apiKey: "wp_live_test",
    baseUrl: "https://example.test",
    fetch,
  });

  const res = await client.ingestEvents([
    {
      eventType: "ticket.resolved",
      category: "project_management",
      actor: { email: "alex@acme.com" },
    },
    {
      eventType: "ticket.reopened",
      category: "project_management",
      actor: { email: "alex@acme.com" },
    },
  ]);

  assert.equal(res.accepted, 1);
  assert.equal(res.rejected, 1);
  assert.equal(res.results.rejected[0]?.code, "invalid_body");
});

test("empty batch is rejected client-side before fetching", async () => {
  const { fetch, calls } = makeFakeFetch([]);
  const client = new WePeopleClient({
    apiKey: "wp_live_test",
    baseUrl: "https://example.test",
    fetch,
  });

  await assert.rejects(() => client.ingestEvents([]), /must not be empty/);
  assert.equal(calls.length, 0);
});
