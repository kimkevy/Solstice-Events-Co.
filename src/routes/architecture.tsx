import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/architecture")({
  head: () => ({
    meta: [
      { title: "Async Check-In Architecture — Solstice Events Co." },
      {
        name: "description",
        content:
          "End-to-end design of Solstice's event-driven check-in: queue publish, signed vendor webhook, attendee state machine, idempotency rules and test strategy.",
      },
      { property: "og:title", content: "Async Check-In Architecture — Solstice Events Co." },
      {
        property: "og:description",
        content:
          "Flow diagram, payload schemas, state machine transitions and the duplicate-scan test matrix.",
      },
    ],
  }),
  component: Architecture,
});

const flow = `Kiosk (scan)
   │  POST scanBadge  (returns in ~10ms)
   ▼
Check-In Service
   │ 1. load attendee by badge
   │ 2. CAS: NOT_CHECKED_IN|PRINT_FAILED -> CHECK_IN_PENDING  (rejects duplicates)
   │ 3. publish PrintRequested  ──────────────►  RabbitMQ  exchange: solstice.print
   │                                             routing key: print.requested
   │                                             messageId = printJobId (dedupe key)
   ▼                                                     │
UI shows "Printing…"                                     ▼
                                                  Vendor print worker
                                                         │
   ┌──────── POST /api/public/print-webhook ◄────────────┘
   │         x-solstice-signature: HMAC-SHA256(raw body, shared secret)
   ▼
Webhook handler
   │ verify signature -> validate schema -> dedupe eventId
   │ guard printJobId match + sequence > lastEventSeq
   │ CHECK_IN_PENDING -> CHECKED_IN (or PRINT_FAILED)
   ▼
UI poll / SSE  ->  "Checked in"`;

const printRequested = `{
  "eventType": "PrintRequested",
  "printJobId": "pj_att_a_7f31c9d2",   // idempotency key
  "attendeeId": "att_a",
  "badgeCode": "SOL-1001",
  "attendeeName": "Amara Otieno",
  "ticketType": "Full Pass",
  "requestedAt": "2026-08-20T09:41:12.004Z"
}`;

const printCompleted = `{
  "eventType": "PrintCompleted",       // or "PrintFailed"
  "eventId": "evt_pj_att_a_7f31c9d2_1",// dedupe key for replays
  "sequence": 1,                       // monotonic per printJobId
  "printJobId": "pj_att_a_7f31c9d2",
  "attendeeId": "att_a",
  "printerId": "printer-hall-a-02",
  "failureReason": null,
  "completedAt": "2026-08-20T09:41:14.550Z"
}`;

const transitions = [
  ["NOT_CHECKED_IN", "Scan", "CHECK_IN_PENDING", "Publishes PrintRequested"],
  ["CHECK_IN_PENDING", "Scan", "CHECK_IN_PENDING", "DUPLICATE_IGNORED — no new job"],
  ["CHECK_IN_PENDING", "PrintCompleted", "CHECKED_IN", "Applied once, sequence-guarded"],
  ["CHECK_IN_PENDING", "PrintFailed", "PRINT_FAILED", "Job cleared, rescan retries"],
  ["CHECKED_IN", "Scan", "CHECKED_IN", "DUPLICATE_IGNORED — already printed"],
  ["CHECKED_IN", "PrintCompleted (replay)", "CHECKED_IN", "Dropped: stale sequence / seen eventId"],
  ["PRINT_FAILED", "Scan", "CHECK_IN_PENDING", "New printJobId issued"],
];

const tests = [
  {
    name: "Attendee A — happy path",
    body: "Scan returns ACCEPTED with a printJobId, state is CHECK_IN_PENDING, exactly one message on the queue. After the signed webhook, state is CHECKED_IN.",
  },
  {
    name: "Attendee B — delayed / out-of-order webhook",
    body: "Deliver sequence 2 then sequence 1 for the same job: the later sequence wins and the stale one is rejected with reason `stale_sequence`. State never regresses out of CHECKED_IN.",
  },
  {
    name: "Attendee C — rapid duplicate scan",
    body: "Two scans in the same tick while PENDING, and one after CHECKED_IN: only the first returns ACCEPTED, the rest return DUPLICATE_IGNORED and the queue depth stays at 1.",
  },
  {
    name: "Security & robustness",
    body: "Unsigned or wrongly-signed webhook -> 401. Malformed payload -> 422. Callback for a superseded printJobId -> ignored (`job_mismatch`). Replayed eventId -> ignored, still 200 so the vendor stops retrying.",
  },
];

function Block({ title, code }: { title: string; code: string }) {
  return (
    <div className="panel p-5">
      <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      <pre className="mt-3 overflow-x-auto text-xs leading-relaxed text-foreground/90">{code}</pre>
    </div>
  );
}

function Architecture() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12">
      <Link to="/" className="text-sm text-primary hover:underline">
        ← Back to kiosk
      </Link>
      <h1 className="mt-4 text-4xl font-bold">Asynchronous Check-In Architecture</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        The deprecated vendor REST call is replaced by a broker hand-off. The kiosk never blocks on
        the printer; the vendor reports completion through a signed webhook, and the attendee state
        machine makes every path idempotent.
      </p>

      <section className="mt-10 space-y-4">
        <Block title="1. End-to-end flow" code={flow} />
        <div className="grid gap-4 md:grid-cols-2">
          <Block title="2a. Queue message — PrintRequested" code={printRequested} />
          <Block title="2b. Webhook payload — PrintCompleted" code={printCompleted} />
        </div>
      </section>

      <section className="panel mt-4 overflow-x-auto p-5">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          3. State machine transitions
        </h3>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="pb-2 pr-4">From</th>
              <th className="pb-2 pr-4">Trigger</th>
              <th className="pb-2 pr-4">To</th>
              <th className="pb-2">Rule</th>
            </tr>
          </thead>
          <tbody>
            {transitions.map((t) => (
              <tr key={t.join()} className="border-t border-border/60">
                <td className="py-2 pr-4 font-mono text-xs">{t[0]}</td>
                <td className="py-2 pr-4 text-xs">{t[1]}</td>
                <td className="py-2 pr-4 font-mono text-xs text-primary">{t[2]}</td>
                <td className="py-2 text-xs text-muted-foreground">{t[3]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2">
        {tests.map((t) => (
          <article key={t.name} className="panel p-5">
            <h3 className="font-semibold">{t.name}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{t.body}</p>
          </article>
        ))}
      </section>

      <section className="panel mt-4 p-5 text-sm text-muted-foreground">
        <h3 className="text-sm font-semibold uppercase tracking-widest">Production notes</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            The claim step is a single SQL compare-and-set (
            <code>UPDATE attendees SET state='CHECK_IN_PENDING', print_job_id=$1 WHERE id=$2 AND state IN ('NOT_CHECKED_IN','PRINT_FAILED')</code>
            ) — concurrency safety comes from the database, not from application locks.
          </li>
          <li>
            Publish inside a transactional outbox so a crash between the state change and the broker
            write cannot lose a print job; a relay drains the outbox with confirms enabled.
          </li>
          <li>
            Webhook secret lives in the secret store as <code>VENDOR_WEBHOOK_SECRET</code>; the
            handler compares HMACs in constant time and always answers 200 for verified events.
          </li>
          <li>
            A watchdog moves jobs stuck in <code>CHECK_IN_PENDING</code> past the vendor SLA to{" "}
            <code>PRINT_FAILED</code> so staff can rescan.
          </li>
          <li>
            The kiosk polls every second here; at multi-hall scale switch to SSE fanned out from the
            webhook handler (poll remains the fallback).
          </li>
        </ul>
      </section>
    </main>
  );
}
