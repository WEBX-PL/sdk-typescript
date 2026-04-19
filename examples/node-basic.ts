/**
 * Minimal Node example. Run with:
 *   WEPEOPLE_API_KEY=wp_live_... WEPEOPLE_BASE_URL=https://... \
 *     pnpm tsx examples/node-basic.ts
 */
import { WePeopleClient, WePeopleApiError } from "../src/index";

const apiKey = process.env.WEPEOPLE_API_KEY;
const baseUrl = process.env.WEPEOPLE_BASE_URL;
if (!apiKey || !baseUrl) {
  console.error("Set WEPEOPLE_API_KEY and WEPEOPLE_BASE_URL");
  process.exit(1);
}

const client = new WePeopleClient({ apiKey, baseUrl });

async function main() {
  const ping = await client.ping();
  console.log("connected as app:", ping.app.slug);

  const res = await client.ingestEvents([
    {
      eventType: "ticket.resolved",
      category: "project_management",
      actor: { email: "alex@acme.com", displayName: "Alex" },
      duration: 240,
      metadata: { ticket_id: "DEMO-1", priority: "high" },
    },
    {
      eventType: "ticket.reopened",
      category: "project_management",
      actor: { email: "alex@acme.com" },
      metadata: { ticket_id: "DEMO-1" },
    },
  ]);
  console.log(
    `accepted ${res.accepted} / rejected ${res.rejected} (req ${res.requestId})`
  );

  await client.ingestSnapshot({
    snapshotType: "tickets_open",
    actor: { email: "alex@acme.com" },
    metrics: {
      tickets_open: 7,
      sla_attainment: { value: 0.92, unit: "ratio", label: "SLA" },
    },
  });
  console.log("snapshot sent");
}

main().catch((err) => {
  if (err instanceof WePeopleApiError) {
    console.error(`[${err.status} ${err.code}] ${err.message}`, {
      requestId: err.requestId,
    });
  } else {
    console.error(err);
  }
  process.exit(1);
});
