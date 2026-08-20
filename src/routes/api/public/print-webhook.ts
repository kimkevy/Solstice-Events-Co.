import { createFileRoute } from "@tanstack/react-router";
import { printCompletedSchema } from "@/lib/checkin/types";

async function verify(body: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const { webhookSecret } = await import("@/lib/checkin/broker.server");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/print-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (!(await verify(raw, request.headers.get("x-solstice-signature")))) {
          return new Response("invalid signature", { status: 401 });
        }
        const parsed = printCompletedSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
          return Response.json({ error: "invalid payload" }, { status: 422 });
        }
        const { applyVendorCallback } = await import("@/lib/checkin/store.server");
        const result = applyVendorCallback(parsed.data);
        // Always 200 on a well-formed, verified event so the vendor stops retrying.
        return Response.json({ applied: result.applied, reason: result.reason });
      },
    },
  },
});
