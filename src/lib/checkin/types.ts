import { z } from "zod";

/** Attendee check-in state machine. */
export const CheckInState = {
  NOT_CHECKED_IN: "NOT_CHECKED_IN",
  CHECK_IN_PENDING: "CHECK_IN_PENDING",
  CHECKED_IN: "CHECKED_IN",
  PRINT_FAILED: "PRINT_FAILED",
} as const;
export type CheckInState = (typeof CheckInState)[keyof typeof CheckInState];

export type Attendee = {
  id: string;
  name: string;
  badgeCode: string;
  ticketType: string;
  state: CheckInState;
  /** Idempotency key of the in-flight or completed print job. */
  printJobId: string | null;
  /** Monotonic vendor sequence of the last applied callback (out-of-order guard). */
  lastEventSeq: number;
  updatedAt: string;
  message: string | null;
};

/** Message published to the vendor queue: solstice.print.requested */
export const printRequestedSchema = z.object({
  eventType: z.literal("PrintRequested"),
  printJobId: z.string().min(8),
  attendeeId: z.string().min(1),
  badgeCode: z.string().min(1),
  attendeeName: z.string().min(1),
  ticketType: z.string().min(1),
  requestedAt: z.string(),
});
export type PrintRequested = z.infer<typeof printRequestedSchema>;

/** Vendor webhook body: POST /api/public/print-webhook */
export const printCompletedSchema = z.object({
  eventType: z.enum(["PrintCompleted", "PrintFailed"]),
  eventId: z.string().min(1),
  /** Vendor-assigned monotonic sequence per print job. */
  sequence: z.number().int().nonnegative(),
  printJobId: z.string().min(1),
  attendeeId: z.string().min(1),
  printerId: z.string().optional(),
  failureReason: z.string().optional(),
  completedAt: z.string(),
});
export type PrintCompleted = z.infer<typeof printCompletedSchema>;

export type ScanOutcome =
  | { status: "ACCEPTED"; state: CheckInState; printJobId: string; message: string }
  | { status: "DUPLICATE_IGNORED"; state: CheckInState; printJobId: string | null; message: string }
  | { status: "UNKNOWN_BADGE"; state: null; printJobId: null; message: string };

/**
 * Pure transition rules — the single source of truth for idempotency.
 * A scan only creates work from NOT_CHECKED_IN / PRINT_FAILED.
 */
export function canRequestPrint(state: CheckInState): boolean {
  return state === CheckInState.NOT_CHECKED_IN || state === CheckInState.PRINT_FAILED;
}

export function duplicateMessage(state: CheckInState): string {
  return state === CheckInState.CHECK_IN_PENDING
    ? "Badge already printing — no duplicate print requested."
    : "Already checked in — no duplicate print requested.";
}

export type CallbackResult =
  | { applied: true; state: CheckInState; reason: "applied" }
  | { applied: false; state: CheckInState; reason: "stale_sequence" | "job_mismatch" | "replayed" };

/**
 * Applies a vendor callback to an attendee. Safe against replays,
 * out-of-order delivery and callbacks for superseded print jobs.
 */
export function applyCallback(
  attendee: Attendee,
  event: PrintCompleted,
  seenEventIds: Set<string>,
): CallbackResult {
  if (seenEventIds.has(event.eventId)) {
    return { applied: false, state: attendee.state, reason: "replayed" };
  }
  if (attendee.printJobId !== event.printJobId) {
    return { applied: false, state: attendee.state, reason: "job_mismatch" };
  }
  if (event.sequence <= attendee.lastEventSeq) {
    return { applied: false, state: attendee.state, reason: "stale_sequence" };
  }
  const next =
    event.eventType === "PrintCompleted" ? CheckInState.CHECKED_IN : CheckInState.PRINT_FAILED;
  attendee.state = next;
  attendee.lastEventSeq = event.sequence;
  attendee.updatedAt = new Date().toISOString();
  attendee.message =
    event.eventType === "PrintCompleted"
      ? `Badge printed${event.printerId ? ` on ${event.printerId}` : ""}.`
      : (event.failureReason ?? "Printer error — rescan to retry.");
  if (event.eventType === "PrintFailed") attendee.printJobId = null;
  seenEventIds.add(event.eventId);
  return { applied: true, state: next, reason: "applied" };
}
