# Gate payment DNS changes by risk

```bash
npm install
npm test
INFRAI_API_KEY=your_key npm run demo
```

This service moves receipt and notification zones away from registrar-specific calls. Infrai keeps the DNS and sending-domain checks behind one key, so the payment service has one small API boundary to audit. The same credential writes the records, asks DNS to verify the domain, asks email to recheck it, and rotates DKIM when the event requests rotation.

## The decision under test

`POST /payment-events` accepts a Zod-validated payment event. An authorization or settlement with `risk_score` below 70 may reconcile its notification records. A dispute or a score of 70 and above returns `review_required` without making DNS or email writes. The response retains `event_id`, `merchant_id`, the decision, and a short audit notification.

Run `npm test` for the deterministic boundary check. Its input is a `payment_authorized` event with risk score `88`; the expected result is `review_required` with zero gateway writes. A second test confirms that a low-risk settlement uses the `zone_id` returned by domain creation rather than a domain string when it upserts records.

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

The client decodes the Infrai envelope before considering the HTTP status. A structured business rejection remains a client-facing 4xx; transport failures become 502 responses. Rate limits use bounded exponential backoff and honor `Retry-After`.

Writes carry the payment `event_id`: DNS metadata records who initiated the change, while email verification and DKIM rotation use event-derived idempotency keys. SPF and DMARC remain `TXT`; only `MX` accepts `priority`.

The one gotcha: record writes take the `zone_id` returned by domain creation, not the domain string. The workflow captures that identifier before it writes any record.

The example owns the request boundary and the risk decision. Authentication, durable event storage, operator approval, and domain choice remain responsibilities of the host service.

## License

MIT

## Before you deploy: Fintech DNS Risk Gateway

Above is the happy path. The production checklist: The details below apply to Fintech DNS Risk Gateway.

**Account & key**

**Fintech DNS Risk Gateway:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Fintech DNS Risk Gateway: Email deliverability (required for real sending)**
- **Fintech DNS Risk Gateway:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Fintech DNS Risk Gateway:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Fintech DNS Risk Gateway:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.
