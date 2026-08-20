import {
  CheckInState,
  canRequestPrint,
  duplicateMessage,
  type Attendee,
  type ScanOutcome,
} from "./types";
import { claimForPrint, findByBadge, listAttendeesFromStore } from "./store.server";
import { publishPrintRequested } from "./broker.server";

export function snapshot(): Attendee[] {
  return listAttendeesFromStore();
}

export async function handleScan(input: {
  badgeCode: string;
  origin: string;
  delayMs?: number | undefined;
  redeliver?: boolean | undefined;
}): Promise<ScanOutcome> {
  const attendee = findByBadge(input.badgeCode);
  if (!attendee) {
    return {
      status: "UNKNOWN_BADGE",
      state: null,
      printJobId: null,
      message: `No attendee found for badge ${input.badgeCode}.`,
    };
  }

  // Idempotency gate: PENDING or CHECKED_IN never produces a second print job.
  if (!canRequestPrint(attendee.state)) {
    return {
      status: "DUPLICATE_IGNORED",
      state: attendee.state,
      printJobId: attendee.printJobId,
      message: duplicateMessage(attendee.state),
    };
  }

  const printJobId = `pj_${attendee.id}_${crypto.randomUUID().slice(0, 8)}`;
  const claimed = claimForPrint(attendee, printJobId);
  if (!claimed) {
    const current = findByBadge(input.badgeCode);
    return {
      status: "DUPLICATE_IGNORED",
      state: current?.state ?? CheckInState.CHECK_IN_PENDING,
      printJobId: current?.printJobId ?? null,
      message: duplicateMessage(current?.state ?? CheckInState.CHECK_IN_PENDING),
    };
  }

  await publishPrintRequested(
    {
      eventType: "PrintRequested",
      printJobId,
      attendeeId: claimed.id,
      badgeCode: claimed.badgeCode,
      attendeeName: claimed.name,
      ticketType: claimed.ticketType,
      requestedAt: new Date().toISOString(),
    },
    { origin: input.origin, delayMs: input.delayMs, redeliver: input.redeliver },
  );

  return {
    status: "ACCEPTED",
    state: CheckInState.CHECK_IN_PENDING,
    printJobId,
    message: "Badge print queued.",
  };
}
