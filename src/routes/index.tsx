import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, ScanLine, CheckCircle2, AlertTriangle, Circle, RotateCcw } from "lucide-react";

import { listAttendees, scanBadge, resetKiosk } from "@/lib/checkin.functions";
import { CheckInState, type Attendee, type ScanOutcome } from "@/lib/checkin/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Solstice Check-In Kiosk — Async Badge Printing" },
      {
        name: "description",
        content:
          "Event-driven check-in kiosk for Solstice Events Co: queue-published print jobs, webhook completion callbacks and duplicate-scan protection.",
      },
      { property: "og:title", content: "Solstice Check-In Kiosk — Async Badge Printing" },
      {
        property: "og:description",
        content:
          "Scan a badge, watch the pending print job resolve to Checked In via the vendor webhook callback.",
      },
    ],
  }),
  component: Kiosk,
});

const stateStyles: Record<string, { label: string; className: string; icon: typeof Circle }> = {
  [CheckInState.NOT_CHECKED_IN]: {
    label: "Not checked in",
    className: "bg-muted text-muted-foreground",
    icon: Circle,
  },
  [CheckInState.CHECK_IN_PENDING]: {
    label: "Printing…",
    className: "bg-pending/20 text-pending",
    icon: Loader2,
  },
  [CheckInState.CHECKED_IN]: {
    label: "Checked in",
    className: "bg-success/20 text-success",
    icon: CheckCircle2,
  },
  [CheckInState.PRINT_FAILED]: {
    label: "Print failed",
    className: "bg-destructive/20 text-destructive",
    icon: AlertTriangle,
  },
};

function StateBadge({ state }: { state: Attendee["state"] }) {
  const s = stateStyles[state]!;
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${s.className}`}
    >
      <Icon className={`h-3.5 w-3.5 ${state === CheckInState.CHECK_IN_PENDING ? "animate-spin" : ""}`} />
      {s.label}
    </span>
  );
}

function Kiosk() {
  const [badge, setBadge] = useState("");
  const [delayMs, setDelayMs] = useState(2500);
  const [redeliver, setRedeliver] = useState(false);
  const [log, setLog] = useState<Array<{ at: string; text: string; kind: ScanOutcome["status"] }>>([]);

  const fetchAttendees = useServerFn(listAttendees);
  const scan = useServerFn(scanBadge);
  const reset = useServerFn(resetKiosk);
  const queryClient = useQueryClient();

  const { data: attendees = [] } = useQuery({
    queryKey: ["attendees"],
    queryFn: () => fetchAttendees(),
    // Polling keeps the kiosk live; swap for SSE at scale (see /architecture).
    refetchInterval: 1000,
  });

  const scanMutation = useMutation({
    mutationFn: (badgeCode: string) => scan({ data: { badgeCode, delayMs, redeliver } }),
    onSuccess: (outcome) => {
      setLog((prev) =>
        [
          { at: new Date().toLocaleTimeString(), text: outcome.message, kind: outcome.status },
          ...prev,
        ].slice(0, 8),
      );
      void queryClient.invalidateQueries({ queryKey: ["attendees"] });
    },
  });

  const submit = (code: string) => {
    if (!code.trim()) return;
    scanMutation.mutate(code.trim());
    setBadge("");
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-primary">
            Solstice Events Co.
          </p>
          <h1 className="mt-2 text-4xl font-bold">Check-In Kiosk</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Scans publish a <code>PrintRequested</code> message to the vendor queue and return
            instantly. Badges flip to <span className="text-success">Checked in</span> only when the
            vendor's <code>PrintCompleted</code> webhook lands.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/architecture"
            className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
          >
            Architecture &amp; tests
          </Link>
          <Button
            variant="secondary"
            onClick={async () => {
              await reset();
              setLog([]);
              void queryClient.invalidateQueries({ queryKey: ["attendees"] });
            }}
          >
            <RotateCcw className="mr-2 h-4 w-4" /> Reset
          </Button>
        </div>
      </header>

      <section className="panel aurora mt-10 p-6">
        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(badge);
          }}
        >
          <ScanLine className="h-6 w-6 text-primary" />
          <Input
            autoFocus
            value={badge}
            onChange={(e) => setBadge(e.target.value)}
            placeholder="Scan or type badge code (e.g. SOL-1001)"
            className="h-12 max-w-sm flex-1 text-base"
          />
          <Button type="submit" size="lg" disabled={scanMutation.isPending}>
            {scanMutation.isPending ? "Publishing…" : "Scan badge"}
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap items-center gap-6 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            Vendor delay
            <select
              value={delayMs}
              onChange={(e) => setDelayMs(Number(e.target.value))}
              className="rounded-md border border-border bg-secondary px-2 py-1 text-foreground"
            >
              <option value={800}>0.8s</option>
              <option value={2500}>2.5s</option>
              <option value={8000}>8s (delayed callback)</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={redeliver}
              onChange={(e) => setRedeliver(e.target.checked)}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            Redeliver callback twice (replay test)
          </label>
        </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        {attendees.map((a) => (
          <article key={a.id} className="panel flex flex-col gap-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{a.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {a.badgeCode} · {a.ticketType}
                </p>
              </div>
              <StateBadge state={a.state} />
            </div>
            <p className="text-sm text-muted-foreground">{a.message ?? "Awaiting first scan."}</p>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>job: {a.printJobId ?? "—"}</span>
              <button
                className="rounded-md border border-border px-2 py-1 hover:bg-secondary"
                onClick={() => submit(a.badgeCode)}
              >
                Simulate scan
              </button>
            </div>
          </article>
        ))}
      </section>

      <section className="panel mt-8 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Scan responses
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          {log.length === 0 && <li className="text-muted-foreground">No scans yet.</li>}
          {log.map((entry, i) => (
            <li key={i} className="flex gap-3">
              <span className="text-muted-foreground">{entry.at}</span>
              <span
                className={
                  entry.kind === "ACCEPTED"
                    ? "text-success"
                    : entry.kind === "DUPLICATE_IGNORED"
                      ? "text-pending"
                      : "text-destructive"
                }
              >
                {entry.kind}
              </span>
              <span>{entry.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
