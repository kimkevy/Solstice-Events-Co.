import { describe, it, expect, beforeEach, vi } from "vitest";
import { CheckInState, applyCallback, type PrintCompleted } from "../types";
import { getStore, resetStore, findByBadge } from "../store.server";
import { handleScan } from "../scan.server";

vi.mock("../broker.server", () => ({
  webhookSecret: () => "test",
  publishPrintRequested: async (msg: unknown) => {
    getStore().outbox.push(msg);
  },
}));

const callback = (over: Partial<PrintCompleted> & { printJobId: string; attendeeId: string }) =>
  ({
    eventType: "PrintCompleted",
    eventId: `evt_${Math.random()}`,
    sequence: 1,
    printerId: "printer-1",
    completedAt: new Date().toISOString(),
    ...over,
  }) as PrintCompleted;

const deliver = (event: PrintCompleted) => {
  const store = getStore();
  return applyCallback(store.attendees.get(event.attendeeId)!, event, store.seenEventIds);
};

const scan = (badgeCode: string) => handleScan({ badgeCode, origin: "http://test" });

beforeEach(() => resetStore());

describe("Attendee A — first-time check-in", () => {
  it("accepts the scan, queues exactly one job and completes on webhook", async () => {
    const outcome = await scan("SOL-1001");
    expect(outcome.status).toBe("ACCEPTED");
    expect(findByBadge("SOL-1001")!.state).toBe(CheckInState.CHECK_IN_PENDING);
    expect(getStore().outbox).toHaveLength(1);

    const jobId = findByBadge("SOL-1001")!.printJobId!;
    expect(deliver(callback({ printJobId: jobId, attendeeId: "att_a" })).applied).toBe(true);
    expect(findByBadge("SOL-1001")!.state).toBe(CheckInState.CHECKED_IN);
  });
});

describe("Attendee B — delayed / out-of-order webhooks", () => {
  it("keeps the newest sequence and rejects the stale one", async () => {
    await scan("SOL-1002");
    const jobId = findByBadge("SOL-1002")!.printJobId!;

    expect(deliver(callback({ printJobId: jobId, attendeeId: "att_b", sequence: 2 })).applied).toBe(true);
    const stale = deliver(callback({ printJobId: jobId, attendeeId: "att_b", sequence: 1 }));
    expect(stale.applied).toBe(false);
    expect(stale.reason).toBe("stale_sequence");
    expect(findByBadge("SOL-1002")!.state).toBe(CheckInState.CHECKED_IN);
  });

  it("ignores a replayed eventId and a superseded printJobId", async () => {
    await scan("SOL-1002");
    const jobId = findByBadge("SOL-1002")!.printJobId!;
    const event = callback({ printJobId: jobId, attendeeId: "att_b" });
    expect(deliver(event).applied).toBe(true);
    expect(deliver(event).reason).toBe("replayed");
    expect(deliver(callback({ printJobId: "pj_stale", attendeeId: "att_b" })).reason).toBe(
      "job_mismatch",
    );
  });
});

describe("Attendee C — duplicate scans", () => {
  it("blocks a second scan while PENDING", async () => {
    const first = await scan("SOL-1003");
    const second = await scan("SOL-1003");
    expect(first.status).toBe("ACCEPTED");
    expect(second.status).toBe("DUPLICATE_IGNORED");
    expect(second.state).toBe(CheckInState.CHECK_IN_PENDING);
    expect(getStore().outbox).toHaveLength(1);
  });

  it("blocks concurrent rapid scans and scans after CHECKED_IN", async () => {
    const results = await Promise.all([scan("SOL-1003"), scan("SOL-1003"), scan("SOL-1003")]);
    expect(results.filter((r) => r.status === "ACCEPTED")).toHaveLength(1);
    expect(getStore().outbox).toHaveLength(1);

    const jobId = findByBadge("SOL-1003")!.printJobId!;
    deliver(callback({ printJobId: jobId, attendeeId: "att_c" }));
    const afterCheckedIn = await scan("SOL-1003");
    expect(afterCheckedIn.status).toBe("DUPLICATE_IGNORED");
    expect(afterCheckedIn.state).toBe(CheckInState.CHECKED_IN);
    expect(getStore().outbox).toHaveLength(1);
  });
});

describe("unknown badge + retry after failure", () => {
  it("rejects unknown badges", async () => {
    expect((await scan("SOL-9999")).status).toBe("UNKNOWN_BADGE");
  });

  it("allows a rescan after PrintFailed", async () => {
    await scan("SOL-1004");
    const jobId = findByBadge("SOL-1004")!.printJobId!;
    deliver(
      callback({
        printJobId: jobId,
        attendeeId: "att_d",
        eventType: "PrintFailed",
        failureReason: "Out of badge stock",
      }),
    );
    expect(findByBadge("SOL-1004")!.state).toBe(CheckInState.PRINT_FAILED);
    expect((await scan("SOL-1004")).status).toBe("ACCEPTED");
    expect(getStore().outbox).toHaveLength(2);
  });
});
