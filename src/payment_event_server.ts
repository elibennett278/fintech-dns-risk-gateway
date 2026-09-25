import { createServer } from "node:http";
import { InfraiDnsClient, InfraiError } from "./infrai_dns_client";
import { paymentEventSchema, processPaymentEvent } from "./payment_dns_policy";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const infrai = new InfraiDnsClient(apiKey);

function send(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/payment-events") {
    send(response, 404, { error: "route not found" });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const parsedJson: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const parsed = paymentEventSchema.safeParse(parsedJson);
    if (!parsed.success) {
      send(response, 400, { error: "invalid payment event", issues: parsed.error.issues });
      return;
    }
    send(response, 200, await processPaymentEvent(parsed.data, infrai));
  } catch (error) {
    if (error instanceof SyntaxError) {
      send(response, 400, { error: "request body must be JSON" });
    } else if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.code, message: error.message });
    } else {
      send(response, 502, { error: "upstream request failed" });
    }
  }
}).listen(Number(process.env.PORT ?? 3000), () => {
  console.log(`Payment DNS service listening on http://localhost:${process.env.PORT ?? 3000}`);
});
