import { test } from "node:test";
import assert from "node:assert/strict";
import { WePeopleApiError } from "../src/errors";

test("fromResponse parses JSON error envelope and headers", async () => {
  const body = {
    error: {
      code: "invalid_body",
      message: "events[0].category is required",
      requestId: "req_xyz",
      docsUrl: "https://wepeople.app/developers/reference#errors",
    },
  };
  const res = new Response(JSON.stringify(body), {
    status: 400,
    headers: { "content-type": "application/json" },
  });

  const err = await WePeopleApiError.fromResponse(res);

  assert.equal(err.status, 400);
  assert.equal(err.code, "invalid_body");
  assert.match(err.message, /events\[0\]\.category is required/);
  assert.equal(err.requestId, "req_xyz");
  assert.equal(err.docsUrl, "https://wepeople.app/developers/reference#errors");
  assert.equal(err.retryable, false);
});

test("fromResponse falls back to x-request-id header when payload has no requestId", async () => {
  const res = new Response("not json", {
    status: 502,
    headers: { "x-request-id": "req_from_header" },
  });

  const err = await WePeopleApiError.fromResponse(res);

  assert.equal(err.status, 502);
  assert.equal(err.code, "http_error");
  assert.equal(err.requestId, "req_from_header");
  assert.equal(err.retryable, true, "5xx should be retryable");
});

test("fromResponse extracts Retry-After seconds on 429", async () => {
  const res = new Response("{}", {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": "3",
    },
  });

  const err = await WePeopleApiError.fromResponse(res);

  assert.equal(err.status, 429);
  assert.equal(err.retryAfter, 3);
  assert.equal(err.retryable, true);
});

test("retryable is false for 4xx that are not 429", async () => {
  const err = new WePeopleApiError(401, "invalid_key", "bad token");
  assert.equal(err.retryable, false);
});
