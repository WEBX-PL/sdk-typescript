# @wepeople/sdk

[![npm version](https://img.shields.io/npm/v/@wepeople/sdk.svg?color=%231a1613)](https://www.npmjs.com/package/@wepeople/sdk)
[![CI](https://github.com/WEBX-PL/sdk-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/WEBX-PL/sdk-typescript/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Official TypeScript SDK for the **WePeople Ingest API**. Use it from any
Node 18+ service, a web worker, a Cloudflare Worker, or the browser to
stream events and metric snapshots from your own systems — CRMs, CI
pipelines, internal tools, AI agents — into WePeople.

Types are regenerated from the source
[`openapi/v1.yaml`](./openapi/v1.yaml) with
[`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript),
so the client always stays in lockstep with the server.

---

## Install

```sh
npm install @wepeople/sdk
# or
pnpm add @wepeople/sdk
# or
yarn add @wepeople/sdk
```

The SDK ships ESM + CJS + `.d.ts`, has zero runtime dependencies, and
relies on the runtime's built-in `fetch`. On older Node versions, polyfill
`fetch`/`AbortController` or pass a compatible `fetch` implementation via
the `fetch` option.

## Quick start

```ts
import { WePeopleClient } from "@wepeople/sdk";

const client = new WePeopleClient({
  apiKey: process.env.WEPEOPLE_API_KEY!,
  baseUrl: "https://wepeople.webx.pl",
});

await client.ping();

await client.ingestEvents([
  {
    eventType: "ticket.resolved",
    category: "project_management",
    actor: { email: "alex@acme.com" },
    duration: 180,
    metadata: { ticket_id: "SUP-431", priority: "high" },
  },
]);

await client.ingestSnapshot({
  snapshotType: "tickets_open",
  actor: { externalId: "crm-user-42" },
  metrics: {
    tickets_open: 7,
    tickets_closed_today: 3,
    sla_attainment: { value: 0.92, unit: "ratio", label: "SLA" },
  },
});
```

A runnable example lives in [`examples/node-basic.ts`](./examples/node-basic.ts).

## Identifying workers

Every event or snapshot belongs to a `Worker`. The SDK accepts one of:

- `workerId` — existing WePeople `Worker.id`.
- `externalId` — your system's stable id (preferred over email).
- `email` — last-resort fallback; creates a worker if none match.

Unknown actors are auto-provisioned and linked to the app's synthetic
integration connection (`custom:<slug>`), so you can start sending data
without a preflight sync.

## Retries and idempotency

- Failed requests with status `429` or `5xx` are retried up to `maxRetries`
  (default `3`) with exponential backoff and `Retry-After` awareness.
- Every write includes an `Idempotency-Key` header. Override it by passing
  `{ idempotencyKey: "..." }` so retries from your own queue are also safe.
- Batch responses use HTTP `207 Multi-Status` when some entries are rejected.
  Inspect `results.rejected[]` and resend only the failing indices.

## Error handling

```ts
import { WePeopleApiError } from "@wepeople/sdk";

try {
  await client.ingestEvents(batch);
} catch (err) {
  if (err instanceof WePeopleApiError) {
    console.error({
      status: err.status,
      code: err.code,
      requestId: err.requestId,
      retryable: err.retryable,
    });
  }
  throw err;
}
```

`WePeopleApiError.retryable` is `true` for `429` and `5xx`, so you can
route those to a dead-letter queue differently from validation errors.

## Events vs. snapshots

| Use case                                             | Endpoint         |
| ---------------------------------------------------- | ---------------- |
| Discrete thing happened at a point in time           | `ingestEvents`   |
| "Right now" gauges rendered on the user strip        | `ingestSnapshot` |

Events are batchable (up to 500 per request) and land on the timeline.
Snapshots overwrite the previous snapshot for the same `(worker, type)`.

## Limits

- 500 events per batch; 1 MB body limit.
- Per-key rate limit: 60 req/s (burst). Per-org aggregate: 600 req/s.
- Metadata and metrics: 16 KB when JSON-serialized.

## Types

Every top-level schema from the OpenAPI spec is re-exported:

```ts
import type {
  Actor,
  EventCategory,
  IngestEvent,
  IngestSnapshot,
  IngestBatchResponse,
  PingResponse,
  SnapshotMetric,
  WePeopleClientOptions,
  // Raw generated types (advanced use):
  components,
  paths,
} from "@wepeople/sdk";
```

`components` and `paths` are the raw `openapi-typescript` output — handy
if you want to type a custom transport or write your own fetch wrapper.

## Development

```sh
pnpm install
pnpm generate   # regenerate src/generated/openapi.d.ts from openapi/v1.yaml
pnpm lint       # tsc --noEmit
pnpm test       # node --test
pnpm build      # tsup → dist/
```

The upstream OpenAPI spec lives in the
[`WEBX-PL/wepeople`](https://github.com/WEBX-PL/wepeople) monorepo at
`apps/web/public/openapi/v1.yaml`. A scheduled workflow in this repo
([`.github/workflows/sync-openapi.yml`](./.github/workflows/sync-openapi.yml))
pulls the latest copy once a day, regenerates the types, and opens a PR
if anything drifted.

### Publishing

Releases are tag-driven. Push a `vX.Y.Z` tag on `main` and the
[`release.yml`](./.github/workflows/release.yml) workflow publishes to npm
with provenance.

Publishing uses npm [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) via GitHub Actions OIDC — no tokens, provenance included. One-time setup:

1. Create the `@wepeople` scope on [npmjs.com](https://www.npmjs.com/) and publish `0.1.0` manually.
2. On the package's **Access** page, register the trusted publisher:
   GitHub Actions &middot; `WEBX-PL/sdk-typescript` &middot; workflow `release.yml`.
3. Every subsequent tag push triggers `release.yml` and publishes automatically.

## Links

- [OpenAPI spec (hosted)](https://wepeople.webx.pl/openapi/v1.yaml)
- [Developer guide](https://wepeople.webx.pl/developers/docs)
- [API reference](https://wepeople.webx.pl/developers/reference)
- [Issues](https://github.com/WEBX-PL/sdk-typescript/issues)

## License

[MIT](./LICENSE)
