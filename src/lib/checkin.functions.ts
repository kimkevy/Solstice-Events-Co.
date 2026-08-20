import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const scanInput = z.object({
  badgeCode: z.string().min(1).max(64),
  delayMs: z.number().int().min(0).max(15000).optional(),
  redeliver: z.boolean().optional(),
});

export const listAttendees = createServerFn({ method: "GET" }).handler(async () => {
  const { snapshot } = await import("./checkin/scan.server");
  return snapshot();
});

export const scanBadge = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => scanInput.parse(data))
  .handler(async ({ data }) => {
    const { handleScan } = await import("./checkin/scan.server");
    const origin = new URL(getRequest().url).origin;
    return handleScan({ ...data, origin });
  });

export const resetKiosk = createServerFn({ method: "POST" }).handler(async () => {
  const { resetStore } = await import("./checkin/store.server");
  resetStore();
  return { ok: true };
});
