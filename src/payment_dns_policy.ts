import { z } from "zod";
import type { InfraiDnsClient } from "./infrai_dns_client";

export const paymentEventSchema = z.object({
  event_id: z.string().min(1).max(128),
  event_type: z.enum(["payment_authorized", "payment_settled", "payment_disputed"]),
  occurred_at: z.string().datetime(),
  merchant_id: z.string().min(1).max(128),
  risk_score: z.number().min(0).max(100),
  sending_domain: z.string().min(3).max(253),
  notification_records: z.array(z.object({
    record_type: z.enum(["TXT", "CNAME", "MX", "A"]),
    name: z.string().min(1).max(253),
    content: z.string().min(1),
    ttl: z.number().int().positive().optional(),
    priority: z.number().int().min(0).optional(),
  })).min(1),
  rotate_dkim: z.boolean().default(false),
}).superRefine((event, context) => {
  event.notification_records.forEach((record, index) => {
    if (record.priority !== undefined && record.record_type !== "MX") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["notification_records", index, "priority"],
        message: "priority is valid only for MX records",
      });
    }
  });
});

export type PaymentEvent = z.infer<typeof paymentEventSchema>;
export type PaymentDecision = {
  event_id: string;
  merchant_id: string;
  outcome: "dns_updated" | "review_required";
  audit_notification: string;
  zone_id?: string;
};

export function decidePaymentAction(event: PaymentEvent): PaymentDecision["outcome"] {
  return event.risk_score >= 70 || event.event_type === "payment_disputed"
    ? "review_required"
    : "dns_updated";
}

export async function processPaymentEvent(
  event: PaymentEvent,
  infrai: Pick<InfraiDnsClient, "dns" | "email">,
): Promise<PaymentDecision> {
  const outcome = decidePaymentAction(event);
  if (outcome === "review_required") {
    return {
      event_id: event.event_id,
      merchant_id: event.merchant_id,
      outcome,
      audit_notification: `DNS held for review after ${event.event_type}`,
    };
  }

  const domain = await infrai.dns.domain.add({
    domain: event.sending_domain,
    metadata: { event_id: event.event_id, merchant_id: event.merchant_id },
  });
  for (const record of event.notification_records) {
    await infrai.dns.record.upsert({
      zone_id: domain.zone_id,
      ...record,
      metadata: { event_id: event.event_id, merchant_id: event.merchant_id },
    });
  }
  await infrai.dns.domain.verify({ domain: event.sending_domain });
  await infrai.email.domain.verify({
    domain: event.sending_domain,
    idempotency_key: `${event.event_id}:email-verify`,
  });
  if (event.rotate_dkim) {
    await infrai.email.domain.rotate_dkim(event.sending_domain, {
      idempotency_key: `${event.event_id}:dkim-rotate`,
    });
  }

  return {
    event_id: event.event_id,
    merchant_id: event.merchant_id,
    outcome,
    zone_id: domain.zone_id,
    audit_notification: `${event.notification_records.length} notification DNS records reconciled`,
  };
}
