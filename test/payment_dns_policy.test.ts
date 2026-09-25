import assert from "node:assert/strict";
import test from "node:test";
import { paymentEventSchema, processPaymentEvent } from "../src/payment_dns_policy";

const baseEvent = paymentEventSchema.parse({
  event_id: "evt_risk_88",
  event_type: "payment_authorized",
  occurred_at: "2026-09-25T09:00:00.000Z",
  merchant_id: "merchant_4",
  risk_score: 88,
  sending_domain: "receipts.example.com",
  notification_records: [
    { record_type: "TXT", name: "_dmarc", content: "v=DMARC1; p=quarantine" }
  ]
});

test("high-risk payment holds DNS changes and emits an auditable decision", async () => {
  let writes = 0;
  const client = {
    dns: {
      domain: {
        add: async () => { writes += 1; return { zone_id: "zone_test" }; },
        verify: async () => { writes += 1; return {}; },
      },
      record: { upsert: async () => { writes += 1; return {}; } },
    },
    email: {
      domain: {
        verify: async () => { writes += 1; return {}; },
        rotate_dkim: async () => { writes += 1; return {}; },
      },
    },
  };

  const result = await processPaymentEvent(baseEvent, client);
  assert.equal(result.outcome, "review_required");
  assert.equal(result.event_id, "evt_risk_88");
  assert.match(result.audit_notification, /payment_authorized/);
  assert.equal(writes, 0);
});

test("settled low-risk payment uses the returned zone id for each record", async () => {
  const zones: string[] = [];
  const event = { ...baseEvent, event_id: "evt_ok_12", event_type: "payment_settled" as const, risk_score: 12 };
  const client = {
    dns: {
      domain: {
        add: async () => ({ zone_id: "zone_live_42" }),
        verify: async () => ({}),
      },
      record: { upsert: async (input: { zone_id: string }) => { zones.push(input.zone_id); return {}; } },
    },
    email: {
      domain: {
        verify: async () => ({}),
        rotate_dkim: async () => ({}),
      },
    },
  };

  const result = await processPaymentEvent(event, client);
  assert.equal(result.outcome, "dns_updated");
  assert.deepEqual(zones, ["zone_live_42"]);
});
