import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronDown, Ship } from "lucide-react";
import EnquiryLink from "./EnquiryLink";
import { STATUS_LABEL, enquiriesOn, routeOf, sailsIn, updateContainer, type Container, type ContainerStatus } from "../services/containers";
import type { Enquiry } from "../services/enquiries";

/**
 * Containers the desk holds space on, as the sailing schedule shows them
 * under a departure.
 *
 * Expanding a row asks what is on it, rather than fetching that for every row
 * up front. Most rows are never expanded.
 */

const STATUS_TONE: Record<ContainerStatus, string> = {
  open: "border-text-success/25 bg-bg-success text-text-success",
  closing_soon: "border-text-warning/25 bg-bg-warning text-text-warning",
  full: "border-text-accent/25 bg-bg-accent text-text-accent",
  sailed: "border-border bg-surface-2 text-text-muted",
};

export default function ContainerList({
  containers,
  onChanged,
  onError,
}: {
  containers: Container[];
  onChanged: (notice: string) => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [onBoard, setOnBoard] = useState<Record<string, Enquiry[]>>({});
  const [loadingBoard, setLoadingBoard] = useState(false);

  async function expand(c: Container) {
    if (openId === c.id) return setOpenId(null);
    setOpenId(c.id);
    if (onBoard[c.id]) return;
    setLoadingBoard(true);
    try {
      const list = await enquiriesOn(c.id);
      setOnBoard((prev) => ({ ...prev, [c.id]: list }));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not read what is on that container.");
    } finally {
      setLoadingBoard(false);
    }
  }

  async function setStatus(c: Container, status: ContainerStatus) {
    try {
      await updateContainer(c.id, { status });
      await onChanged(`${c.id} marked ${STATUS_LABEL[status].toLowerCase()}.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : "That did not work.");
    }
  }

  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-1">
      {containers.map((c) => {
        const when = sailsIn(c.sailing_date);
        const open = openId === c.id;
        const list = onBoard[c.id];

        return (
          <div key={c.id}>
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-3 py-2.5">
              <button type="button" onClick={() => void expand(c)} aria-expanded={open} className="flex min-w-[13rem] flex-1 items-start gap-3 text-left">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-text-secondary">
                  <Ship size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="whitespace-nowrap font-mono text-[12px] font-medium text-text-secondary">
                      {c.id} · {c.container_code} {c.mode}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                    {(c.enquiry_count ?? 0) > 0 && (
                      <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10.5px] text-text-secondary">
                        {c.enquiry_count} on board
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-text-secondary">
                    <span className="font-medium text-text-primary">{routeOf(c)}</span>
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays size={11} className="text-text-muted" />
                      {new Date(c.sailing_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      <span className={when.past ? "text-text-muted" : when.urgent ? "font-medium text-text-warning" : "text-text-muted"}>· {when.text}</span>
                    </span>
                    {(c.partner_name || c.partner_org) && (
                      <span className="text-text-muted">{[c.partner_name, c.partner_org].filter(Boolean).join(" · ")}</span>
                    )}
                  </span>
                </span>
                <ChevronDown size={14} className={`mt-1 shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} />
              </button>

              {c.status !== "sailed" && (
                <div className="flex flex-wrap items-center gap-2">
                  {c.status !== "full" && (
                    <button
                      type="button"
                      onClick={() => void setStatus(c, "full")}
                      className="h-7 rounded-lg border border-border bg-surface-1 px-2.5 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                    >
                      Mark full
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void setStatus(c, "sailed")}
                    className="h-7 rounded-lg border border-border bg-surface-1 px-2.5 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                  >
                    Mark sailed
                  </button>
                </div>
              )}
            </div>

            {open && (
              <div className="border-t border-border bg-surface-2 px-3 py-2.5">
                {loadingBoard && !list ? (
                  <p className="text-[12px] text-text-muted">Reading what is on board…</p>
                ) : !list?.length ? (
                  <p className="text-[12px] text-text-muted">
                    Nothing on this container yet. Put an enquiry on it from the{" "}
                    <Link to="/enquiries" className="text-text-accent hover:underline">
                      inbound board
                    </Link>
                    .
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {list.map((e) => (
                      <li key={e.ref}>
                        <EnquiryLink to={`/enquiries/${e.ref}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] hover:underline">
                          <span className="font-mono font-medium text-text-accent">{e.ref}</span>
                          <span className="text-text-primary">{[e.origin, e.destination].filter(Boolean).join(" → ") || "—"}</span>
                          {e.cargo && <span className="text-text-muted">{e.cargo}</span>}
                        </EnquiryLink>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
