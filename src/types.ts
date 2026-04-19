/**
 * Public, ergonomic type aliases. Top-level schemas (`Actor`, `IngestEvent`,
 * `IngestSnapshot`, responses, …) are sourced from the generated OpenAPI
 * types at `src/generated/openapi.d.ts` — rebuilt from `openapi/v1.yaml`
 * via `pnpm generate`. Inline/unnamed schemas (e.g. the snapshot metric
 * value union) are kept as hand-rolled aliases so consumers don't have to
 * reach into generated index-access types.
 */
import type { components } from "./generated/openapi";

type Schemas = components["schemas"];

export type EventCategory = Schemas["EventCategory"];
export type Actor = Schemas["Actor"];
export type IngestEvent = Schemas["IngestEvent"];
export type IngestEventBatch = Schemas["IngestEventBatch"];
export type IngestSnapshot = Schemas["IngestSnapshot"];
export type IngestBatchResponse = Schemas["IngestBatchResponse"];
export type SnapshotResponse = Schemas["SnapshotResponse"];
export type PingResponse = Schemas["PingResponse"];

/**
 * Machine-readable error envelope returned by the API for non-2xx responses.
 * The OpenAPI spec names this schema `Error`; we alias it here so consumers
 * don't collide with the global `Error` constructor.
 */
export type ApiErrorPayload = Schemas["Error"];

/**
 * One metric value inside `IngestSnapshot.metrics`. The spec uses an inline
 * `oneOf` so there's no generated top-level alias — this type mirrors it.
 */
export interface SnapshotMetricObject {
  value: number;
  unit?: "count" | "minutes" | "ratio" | "percentage" | "score";
  label?: string;
}

export type SnapshotMetric = number | string | SnapshotMetricObject;
