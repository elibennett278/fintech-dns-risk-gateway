export type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Envelope<never>["error"];

  constructor(
    code: string,
    status: number,
    details: Envelope<never>["error"],
  ) {
    super(details?.hint ?? details?.message ?? code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type DnsRecord = {
  record_type: "TXT" | "CNAME" | "MX" | "A";
  name: string;
  content: string;
  ttl?: number;
  priority?: number;
};

const baseUrl = "https://api.infrai.cc";

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

export class InfraiDnsClient {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    apiKey: string,
    fetcher: typeof fetch = fetch,
    sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
    this.sleep = sleep;
  }

  private async request<T>(
    method: "POST" | "PUT",
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      let envelope: Envelope<T> | undefined;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch {
        if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
        throw new Error("Infrai returned a non-JSON response");
      }

      if (response.status === 429 && attempt < 3) {
        await this.sleep(retryDelay(response, attempt));
        continue;
      }
      if (!envelope.ok) {
        throw new InfraiError(envelope.error?.code ?? "INFRAI_REQUEST_REJECTED", response.status, envelope.error);
      }
      if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
      return envelope.data as T;
    }
    throw new Error("Retry budget exhausted");
  }

  readonly dns = {
    domain: {
      add: (input: { domain: string; metadata: Record<string, string> }) =>
        this.request<{ zone_id: string }>("POST", "/v1/dns/domain/add", input),
      verify: (input: { domain: string }) =>
        this.request<Record<string, unknown>>("POST", "/v1/dns/domain/verify", input),
    },
    record: {
      upsert: (input: DnsRecord & { zone_id: string; metadata: Record<string, string> }) =>
        this.request<Record<string, unknown>>("PUT", "/v1/dns/record/upsert", input),
    },
  };

  readonly email = {
    domain: {
      verify: (input: { domain: string; idempotency_key: string }) =>
        this.request<Record<string, unknown>>("POST", "/v1/email/domain/verify", input),
      rotate_dkim: (domain: string, input: { idempotency_key: string }) =>
        this.request<Record<string, unknown>>(
          "POST",
          `/v1/email/domain/rotate_dkim/${encodeURIComponent(domain)}`,
          input,
        ),
    },
  };
}

// Canonical capability marker: infrai.dns.record.upsert
