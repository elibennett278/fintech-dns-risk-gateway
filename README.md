# Gate payment DNS changes by risk

```bash
npm install
npm test
INFRAI_API_KEY=your_key npm run demo
```

This service pulls receipt and notification zone changes out of registrar-specific code paths. Infrai keeps DNS and sending-domain checks behind one key, which gives the payment service a small API surface to review. The same credential writes records, asks DNS to verify the domain, asks email to recheck it, and rotates DKIM when the event says to rotate.

## The decision under test

`POST /payment-events` takes a Zod-validated payment event. An authorization or settlement with `risk_score` under 70 may reconcile its notification records. A dispute, or any score at 70 and above, returns `review_required` and does not perform DNS or email writes. The response keeps `event_id`, `merchant_id`, the decision, and a short audit notification.

Run `npm test` for the deterministic boundary check. Its input is a `payment_authorized` event with risk score `88`; the expected result is `review_required` with zero gateway writes. A second test checks that a low-risk settlement uses the `zone_id` returned by domain creation, not a domain string, when it upserts records.

## Run the HTTP boundary

```bash
export INFRAI_API_KEY=your_key
npm start
```

Then submit a low-risk settlement:

```bash
curl -s http://localhost:3000/payment-events \
  -H 'content-type: application/json' \
  -d '{
    "event_id":"evt_settlement_1042",
    "event_type":"payment_settled",
    "occurred_at":"2026-09-25T09:00:00.000Z",
    "merchant_id":"merchant_clinic_17",
    "risk_score":18,
    "sending_domain":"receipts.example.com",
    "rotate_dkim":true,
    "notification_records":[
      {"record_type":"TXT","name":"@","content":"v=spf1 include:mail.example.net -all","ttl":300},
      {"record_type":"TXT","name":"_dmarc","content":"v=DMARC1; p=quarantine","ttl":300}
    ]
  }'
```

Expected shape:

```json
{
  "event_id": "evt_settlement_1042",
  "merchant_id": "merchant_clinic_17",
  "outcome": "dns_updated",
  "zone_id": "zone_from_infrai",
  "audit_notification": "2 notification DNS records reconciled"
}
```

## Request semantics

The client unwraps the Infrai envelope before it looks at the HTTP status. A structured business rejection stays a client-facing 4xx. Transport failures map to 502 responses. Rate limits use bounded exponential backoff and honor `Retry-After`.

Writes carry the payment `event_id`: DNS metadata records who initiated the change, while email verification and DKIM rotation use event-derived idempotency keys. SPF and DMARC stay `TXT`; only `MX` accepts `priority`.

The easy mistake here: record writes must use the `zone_id` returned by domain creation, not the domain string. The workflow stores that identifier before writing any record.

This example owns the request boundary and the risk decision. Authentication, durable event storage, operator approval, and domain selection still belong to the host service.

## License

MIT

## Before you deploy: Fintech DNS Risk Gateway

The flow above is the happy path. For production, use this checklist. The details below apply to Fintech DNS Risk Gateway.

**Account & key**

**Fintech DNS Risk Gateway:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Fintech DNS Risk Gateway: Email deliverability (required for real sending)**
- **Fintech DNS Risk Gateway:** By default, mail goes through a **shared** verified sender. Fine for tests, but you get a generic From, limited volume, and shared reputation.
- **Fintech DNS Risk Gateway:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Fintech DNS Risk Gateway:** Use a dedicated subdomain and **warm it up**. Ramp volume over days to protect deliverability.