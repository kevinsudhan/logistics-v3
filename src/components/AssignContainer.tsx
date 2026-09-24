import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Ship, X } from "lucide-react";
import Select from "./Select";
import {
  assignContainer,
  listOpenContainers,
  routeOf,
  sailsIn,
  type Container,
} from "../services/containers";

/**
 * Putting an enquiry on a container, from the board.
 *
 * ---------------------------------------------------------------------------
 * THE PICKER TAKES THE BUTTON'S PLACE
 *
 * Rather than appearing beneath it — the same rule the hand-off picker follows,
 * for the same reason: a control that moves when you press it makes you re-find
 * the thing you were already pointing at.
 *
 * WHY THE LIST IS FETCHED ON OPEN
 *
 * A board of forty enquiries would otherwise load the container list forty
 * times to fill forty pickers that nobody opened. It is fetched when somebody
 * actually asks, and kept for the rest of the visit.
 *
 * SAILED CONTAINERS ARE NOT OFFERED
 *
 * The database refuses them, so offering one only produces a refusal. Space
 * that has left is not space.
 * ---------------------------------------------------------------------------
 */

/** Held across instances: the list is the same for every row on the board. */
let cached: Container[] | null = null;

export default function AssignContainer({
  enquiryRef,
  current,
  onChanged,
}: {
  enquiryRef: string;
  /** The container it is already on, if any. */
  current?: string | null;
  onChanged: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [options, setOptions] = useState<Container[]>(cached ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!picking || cached) return;
    let stale = false;
    void listOpenContainers()
      .then((list) => {
        cached = list;
        if (!stale) setOptions(list);
      })
      .catch((e) => !stale && setError(e instanceof Error ? e.message : "Could not load containers."));
    return () => {
      stale = true;
    };
  }, [picking]);

  async function put(sailingId: string | null) {
    setPicking(false);
    setBusy(true);
    setError(null);
    try {
      await assignContainer(enquiryRef, sailingId);
      // The load counts on the sailing schedule are now stale.
      cached = null;
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not put it on that container.");
    } finally {
      setBusy(false);
    }
  }

  // Already on one. Say which, and offer to take it off.
  if (current && !picking) {
    const on = (cached ?? options).find((c) => c.id === current);
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Link
          to="/sailing-schedule"
          title={on ? `${on.container_code} ${routeOf(on)}` : "On a container"}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-text-success/25 bg-bg-success px-2.5 text-[12px] font-medium text-text-success transition-colors hover:border-text-success/50"
        >
          <Ship size={12} />
          {on ? `${on.container_code} · ${routeOf(on)}` : current}
        </Link>
        <button
          onClick={() => void put(null)}
          disabled={busy}
          title="Take it off this container"
          aria-label="Take it off this container"
          className="grid size-6 place-items-center rounded text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary disabled:opacity-50"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
        </button>
      </span>
    );
  }

  if (picking) {
    return (
      <span className="inline-flex items-center gap-2">
        <Select
          label="Put this enquiry on a container"
          className="w-64"
          value=""
          onChange={(v) => {
            if (v) void put(v);
            else setPicking(false);
          }}
          options={[
            { value: "", label: "Choose a container…" },
            ...options.map((c) => {
              const when = sailsIn(c.sailing_date);
              return {
                value: c.id,
                label: `${c.container_code} · ${routeOf(c)}`,
                hint: [
                  `sails ${when.text}`,
                  c.partner_org || c.partner_name || null,
                  (c.enquiry_count ?? 0) > 0 ? `${c.enquiry_count} on board` : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
              };
            }),
          ]}
        />
        <button
          onClick={() => setPicking(false)}
          className="text-[11px] text-text-secondary hover:text-text-primary"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        onClick={() => setPicking(true)}
        disabled={busy}
        title="Put this enquiry on a container"
        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-60"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Ship size={12} />}
        Container
      </button>
      {error && <span className="max-w-xs text-[11px] text-text-danger">{error}</span>}
    </span>
  );
}
