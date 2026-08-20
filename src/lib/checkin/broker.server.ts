import { printRequestedSchema, type PrintRequested } from "./types";
import { getStore } from "./store.server";

/**
 * Broker adapter. In production this is an amqplib channel:
 *   channel.publish("solstice.print", "print.requested", Buffer.from(JSON.stringify(msg)),
 *                   { persistent: true, messageId: msg.printJobId })
 * The `messageId` is the idempotency key the vendor dedupes on.
 * Here the vendor consumer is simulated so the flow is demoable end-to-end.
 */
export type PublishOptions = {
  origin: string;
  /** Simulated vendor processing delay in ms. */
  delayMs?: number;
  /** Simulate a duplicate/out-of-order redelivery of the same callback. */
  redeliver?: boolean;
};

export function webhookSecret(): string {
  return process.env["VENDOR_WEBHOOK_SECRET"] ?? "solstice-dev-shared-secret";
}

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function publishPrintRequested(
  message: PrintRequested,
  options: PublishOptions,
): Promise<void> {
  const msg = printRequestedSchema.parse(message);
  getStore().outbox.push(msg);
  void simulateVendor(msg, options);
}

/** Stand-in for the vendor's printer worker + webhook emitter. */
async function simulateVendor(msg: PrintRequested, options: PublishOptions) {
  const delay = options.delayMs ?? 2500;
  await new Promise((r) => setTimeout(r, delay));
  const body = JSON.stringify({
    eventType: "PrintCompleted",
    eventId: `evt_${msg.printJobId}_1`,
    sequence: 1,
    printJobId: msg.printJobId,
    attendeeId: msg.attendeeId,
    printerId: "printer-hall-a-02",
    completedAt: new Date().toISOString(),
  });
  const signature = await sign(body);
  const post = () =>
    fetch(`${options.origin}/api/public/print-webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-solstice-signature": signature },
      body,
    }).catch((error) => console.error("vendor callback failed", error));
  await post();
  if (options.redeliver) {
    await new Promise((r) => setTimeout(r, 400));
    await post();
  }
}
