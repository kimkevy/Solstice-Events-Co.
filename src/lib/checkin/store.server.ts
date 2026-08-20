import {
  CheckInState,
  applyCallback,
  type Attendee,
  type CallbackResult,
  type PrintCompleted,
} from "./types";

/**
 * In-memory projection of the attendee table. In production this is a Postgres
 * row updated with `UPDATE ... WHERE state = 'NOT_CHECKED_IN'` (compare-and-set)
 * so concurrent kiosks cannot both win a scan.
 */
type Store = {
  attendees: Map<string, Attendee>;
  seenEventIds: Set<string>;
  /** Simulated vendor queue (RabbitMQ `solstice.print.requested`). */
  outbox: unknown[];
  locks: Set<string>;
};

const SEED: Array<Omit<Attendee, "state" | "printJobId" | "lastEventSeq" | "updatedAt" | "message">> =
  [
    { id: "att_a", name: "Amara Otieno", badgeCode: "SOL-1001", ticketType: "Full Pass" },
    { id: "att_b", name: "Ben Kariuki", badgeCode: "SOL-1002", ticketType: "Speaker" },
    { id: "att_c", name: "Chiara Rossi", badgeCode: "SOL-1003", ticketType: "Full Pass" },
    { id: "att_d", name: "Daniel Mwangi", badgeCode: "SOL-1004", ticketType: "Expo Only" },
  ];

const globalRef = globalThis as unknown as { __solsticeStore?: Store | undefined };

export function getStore(): Store {
  if (!globalRef.__solsticeStore) {
    globalRef.__solsticeStore = {
      attendees: new Map(
        SEED.map((a) => [
          a.id,
          {
            ...a,
            state: CheckInState.NOT_CHECKED_IN,
            printJobId: null,
            lastEventSeq: 0,
            updatedAt: new Date().toISOString(),
            message: null,
          } satisfies Attendee,
        ]),
      ),
      seenEventIds: new Set<string>(),
      outbox: [],
      locks: new Set<string>(),
    };
  }
  return globalRef.__solsticeStore;
}

export function listAttendeesFromStore(): Attendee[] {
  return [...getStore().attendees.values()];
}

export function findByBadge(badgeCode: string): Attendee | undefined {
  return listAttendeesFromStore().find(
    (a) => a.badgeCode.toLowerCase() === badgeCode.trim().toLowerCase(),
  );
}

/**
 * Atomic compare-and-set: claims the attendee for printing.
 * Returns null when another scan already owns the transition.
 */
export function claimForPrint(attendee: Attendee, printJobId: string): Attendee | null {
  const store = getStore();
  if (store.locks.has(attendee.id)) return null;
  store.locks.add(attendee.id);
  try {
    const current = store.attendees.get(attendee.id);
    if (!current || (current.state !== CheckInState.NOT_CHECKED_IN && current.state !== CheckInState.PRINT_FAILED)) {
      return null;
    }
    current.state = CheckInState.CHECK_IN_PENDING;
    current.printJobId = printJobId;
    current.lastEventSeq = 0;
    current.updatedAt = new Date().toISOString();
    current.message = "Print job queued with vendor.";
    return current;
  } finally {
    store.locks.delete(attendee.id);
  }
}

export function applyVendorCallback(event: PrintCompleted): CallbackResult | { applied: false; state: null; reason: "unknown_attendee" } {
  const store = getStore();
  const attendee = store.attendees.get(event.attendeeId);
  if (!attendee) return { applied: false, state: null, reason: "unknown_attendee" };
  return applyCallback(attendee, event, store.seenEventIds);
}

export function resetStore(): void {
  delete globalRef.__solsticeStore;
  getStore();
}
