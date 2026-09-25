import { InfraiDnsClient } from "./infrai_dns_client";
import { paymentEventSchema, processPaymentEvent } from "./payment_dns_policy";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before running the example");

const event = paymentEventSchema.parse({
  event_id: "evt_settlement_1042",
  event_type: "payment_settled",
  occurred_at: "2026-09-25T09:00:00.000Z",
  merchant_id: "merchant_clinic_17",
  risk_score: 18,
  sending_domain: "receipts.example.com",
  rotate_dkim: true,
  notification_records: [
    { record_type: "TXT", name: "@", content: "v=spf1 include:mail.example.net -all", ttl: 300 },
    { record_type: "TXT", name: "_dmarc", content: "v=DMARC1; p=quarantine", ttl: 300 }
  ]
});

console.log(await processPaymentEvent(event, new InfraiDnsClient(apiKey)));
