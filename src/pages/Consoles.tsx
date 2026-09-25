import { useCallback, useEffect, useRef, useState } from "react";
import { useTablesChanges } from "../lib/useTableChanges";
import { Link } from "react-router-dom";
import { AlertCircle, ChevronDown, Layers, Loader2, Plus, Ship } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";
import Select from "../components/Select";
import SchedulePicker from "../components/SchedulePicker";
import {
  CAPACITY_CBM,
  STATUS_HINT,
  STATUS_LABEL,
  STATUS_ORDER,
  listConsoles,
  loadFactor,
  openConsole,
  shipmentsOn,
  updateConsole,
  type Console,
  type ConsoleStatus,
} from "../services/consoles";
import { issueHouseBl } from "../services/consoles";
import { listContainers, type Container } from "../services/containers";
import { listPartners, type Partner } from "../services/partners";
import type { Shipment } from "../services/enquiries";
import { PageSkeleton } from "../components/Loading";
import ConsoleManifest from "../components/ConsoleManifest";

/**
 * The consoles the desk is building.
 *
 * ---------------------------------------------------------------------------
 * WHAT A ROW IS
 *
 * One master bill of lading, and the house bills riding under it. This is the
 * object a consolidator's whole business is made of and the system had no
 * record of it — every shipment carried its own B/L and nothing said which of
 * them shared a box, an agent or a filing.
 *
 * LOAD FACTOR IS THE NUMBER ON THE ROW
 *
 * Space is bought whole and sold by the cubic metre, so the gap between the two
 * is where the money is. A console at 40% is losing money quietly, and the only
 * moment anybody can act on that is while it is still open.
 *
 * It is shown as "not known" rather than as a guess when the container type is
 * not recorded. A load factor computed against an assumed box size would be
 * worse than none, because somebody would believe it.
 * ---------------------------------------------------------------------------
 */

const TONE: Record<ConsoleStatus, "success" | "warning" | "accent" | "neutral" | "danger"> = {
  open: "success",
  closed: "warning",
  sailed: "accent",
  arrived: "neutral",
  cancelled: "danger",
};

function Field({
  label,
  value,
  onCommit,
  type = "text",
  mono,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  type?: string;
  mono?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <label className="block min-w-0">
      <span className="block text-[11px] text-text-secondary">{label}</span>
      <input
        type={type}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
        className={`mt-0.5 h-8 w-full rounded-lg border border-border bg-surface-1 px-2.5 text-[13px] text-text-primary transition-colors placeholder:text-text-muted hover:border-border-strong focus:border-border-strong focus:outline-none ${
          mono ? "font-mono" : ""
        }`}
      />
      {hint && <span className="mt-0.5 block text-[11px] text-text-muted">{hint}</span>}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
        {title}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

export default function Consoles() {
  const [rows, setRows] = useState<Console[]>([]);
  const [containers, setContainers] = useState<Container[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [onBoard, setOnBoard] = useState<Record<string, Shipment[]>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newSailing, setNewSailing] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, ct, p] = await Promise.all([listConsoles(), listContainers(), listPartners()]);
      setRows(c);
      setContainers(ct);
      setPartners(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the consoles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A console edited, or a job put on or taken off one, by anybody (084): the
  // list, and the cargo of the console that is open.
  const openNow = useRef(openId);
  openNow.current = openId;
  useTablesChanges(
    [
      ["consoles", null],
      ["shipments", null],
    ],
    () => {
      void load();
      const id = openNow.current;
      if (id) void shipmentsOn(id).then((cargo) => setOnBoard((p) => ({ ...p, [id]: cargo }))).catch(() => {});
    }
  );

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
      // Re-read the cargo too: issuing a house bill changes a row in it, and a
      // stale list would show the button that was just pressed.
      if (openId) {
        const cargo = await shipmentsOn(openId);
        setOnBoard((p) => ({ ...p, [openId]: cargo }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    }
  };

  async function expand(c: Console) {
    const next = openId === c.id ? null : c.id;
    setOpenId(next);
    if (next && !onBoard[next]?.length) {
      try {
        const cargo = await shipmentsOn(next);
        setOnBoard((p) => ({ ...p, [next]: cargo }));
      } catch {
        // A console whose cargo will not load still shows its own particulars.
      }
    }
  }

  async function create() {
    setBusy(true);
    setAdding(false);
    try {
      const c = await openConsole(newSailing || null);
      await load();
      setOpenId(c.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open a console.");
    } finally {
      setBusy(false);
      setNewSailing("");
    }
  }

  if (loading) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Consoles"
        subtitle="One master bill of lading, and the house bills riding under it. Open one against booked space, put cargo on it, then issue each shipper their own B/L."
        action={
          <div className="relative">
            <button
              onClick={() => setAdding((a) => !a)}
              disabled={busy}
              aria-expanded={adding}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
              Open a console
            </button>
            {adding && (
              <div className="absolute right-0 z-30 mt-1 w-80 rounded-lg border border-border-strong bg-surface-1 p-3 shadow-lg">
                <p className="mb-2 text-[11px] leading-relaxed text-text-secondary">
                  Against booked space, so the route, carrier and dates come across rather than
                  being typed again.
                </p>
                <Select
                  label="Container"
                  value={newSailing}
                  options={[
                    { value: "", label: "No booked space yet" },
                    ...containers.map((c) => ({
                      value: c.id,
                      label: `${c.route} · ${c.container_code}`,
                      hint: `${c.mode} · sails ${c.sailing_date}`,
                    })),
                  ]}
                  onChange={setNewSailing}
                />
                <button
                  onClick={() => void create()}
                  className="mt-2 inline-flex h-8 w-full items-center justify-center rounded-lg bg-brand text-[12px] font-medium text-white transition-colors hover:bg-brand-dark"
                >
                  Open it
                </button>
              </div>
            )}
          </div>
        }
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No consoles yet"
          hint="A console is one master bill of lading with several shippers' cargo under it. Open one against a container you have booked, and the enquiries on that container can be put on it."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((c) => {
            const isOpen = openId === c.id;
            const s = c.summary;
            const sailing = containers.find((x) => x.id === c.sailing_id);
            const lf = loadFactor(
              Number(s?.volume_cbm ?? 0),
              sailing ? (CAPACITY_CBM[sailing.container_code] ?? null) : null
            );
            const list = onBoard[c.id] ?? [];

            return (
              <div key={c.id}>
                <button
                  onClick={() => void expand(c)}
                  aria-expanded={isOpen}
                  className={`card card-interactive flex w-full flex-wrap items-center gap-x-3 gap-y-2 p-3 text-left ${
                    isOpen ? "rounded-b-none border-b-0" : ""
                  }`}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-text-secondary">
                    <Layers size={15} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] font-medium text-text-primary">
                        {c.console_no}
                      </span>
                      <StatusPill tone={TONE[c.status]}>{STATUS_LABEL[c.status]}</StatusPill>
                      <StatusPill tone="neutral">{c.mode}</StatusPill>
                      {c.mbl_number && (
                        <span className="font-mono text-[11px] text-text-muted">
                          MBL {c.mbl_number}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-text-secondary">
                      {[c.pol, c.pod].filter(Boolean).join(" → ") || "Route not set"}
                      {c.etd ? ` · sails ${c.etd}` : ""}
                      {c.carrier ? ` · ${c.carrier}` : ""}
                    </span>
                  </span>

                  <span className="flex items-center gap-4 text-right">
                    <span>
                      <span className="block text-[11px] text-text-secondary">House bills</span>
                      <span className="block text-[13px] font-medium tabular-nums text-text-primary">
                        {s?.house_bills ?? 0}
                        {(s?.issued_bills ?? 0) < (s?.house_bills ?? 0) && (
                          <span className="ml-1 text-[11px] font-normal text-text-warning">
                            {(s?.house_bills ?? 0) - (s?.issued_bills ?? 0)} unissued
                          </span>
                        )}
                      </span>
                    </span>
                    <span>
                      <span className="block text-[11px] text-text-secondary">Load</span>
                      <span
                        className={`block text-[13px] font-medium tabular-nums ${
                          lf === null
                            ? "text-text-muted"
                            : lf < 60
                              ? "text-text-warning"
                              : "text-text-primary"
                        }`}
                      >
                        {lf === null ? "—" : `${lf}%`}
                      </span>
                    </span>
                    <ChevronDown
                      size={14}
                      className={`text-text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  </span>
                </button>

                {isOpen && (
                  <div className="card space-y-5 rounded-t-none p-4">
                    {/* ---- where it is in its life ---- */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {STATUS_ORDER.map((st) => (
                        <button
                          key={st}
                          onClick={() => void run(() => updateConsole(c.id, { status: st }))}
                          title={STATUS_HINT[st]}
                          className={`h-7 rounded-full px-2.5 text-[11px] font-medium transition-colors ${
                            c.status === st
                              ? "bg-brand text-white"
                              : "bg-surface-2 text-text-muted hover:text-text-primary"
                          }`}
                        >
                          {STATUS_LABEL[st]}
                        </button>
                      ))}
                      <span className="ml-2 text-[11px] text-text-muted">
                        {STATUS_HINT[c.status]}
                      </span>
                    </div>

                    <Section title="The master bill">
                      <Field
                        label="MBL number"
                        value={c.mbl_number ?? ""}
                        mono
                        placeholder="The carrier's own"
                        onCommit={(v) =>
                          void run(() => updateConsole(c.id, { mbl_number: v || null }))
                        }
                      />
                      <Field
                        label="MBL date"
                        type="date"
                        value={c.mbl_date ?? ""}
                        onCommit={(v) =>
                          void run(() => updateConsole(c.id, { mbl_date: v || null }))
                        }
                      />
                      <Field
                        label="Carrier"
                        value={c.carrier}
                        onCommit={(v) => void run(() => updateConsole(c.id, { carrier: v }))}
                      />
                      <div className="min-w-0">
                        <span className="block text-[11px] text-text-secondary">
                          Overseas agent
                        </span>
                        <div className="mt-0.5">
                          <Select
                            label="Overseas agent"
                            value={c.agent_id ?? ""}
                            options={[
                              { value: "", label: "Not appointed" },
                              ...partners.map((p) => ({
                                value: p.id,
                                label: p.organisation || p.name,
                                hint: p.organisation ? p.name : undefined,
                              })),
                            ]}
                            onChange={(v) =>
                              void run(() => updateConsole(c.id, { agent_id: v || null }))
                            }
                          />
                        </div>
                        <span className="mt-0.5 block text-[11px] text-text-muted">
                          Who bills us for the far end
                        </span>
                      </div>
                    </Section>

                    <Section title="Voyage">
                      {/* The departure from the sailing schedule: vessel,
                          voyage, ports, dates and cut-off in one go. */}
                      <div className="flex min-w-0 flex-col justify-end gap-1 sm:col-span-2 lg:col-span-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <SchedulePicker
                            mode="sea"
                            from={c.pol}
                            to={c.pod}
                            onPick={(x) =>
                              run(() =>
                                updateConsole(c.id, {
                                  schedule_id: x.id,
                                  carrier: x.carrier ?? c.carrier,
                                  vessel: x.vessel ?? c.vessel,
                                  voyage: x.voyage ?? c.voyage,
                                  pol: x.port_of_loading,
                                  pod: x.port_of_discharge,
                                  etd: x.etd,
                                  eta: x.eta ?? c.eta,
                                  cutoff_date: x.cfs_cutoff ?? x.port_cutoff ?? c.cutoff_date,
                                })
                              )
                            }
                          />
                          {c.schedule_id && (
                            <span className="font-mono text-[11.5px] text-text-muted">From {c.schedule_id}</span>
                          )}
                        </div>
                      </div>
                      <Field
                        label="Vessel"
                        value={c.vessel}
                        onCommit={(v) => void run(() => updateConsole(c.id, { vessel: v }))}
                      />
                      <Field
                        label="Voyage"
                        value={c.voyage}
                        onCommit={(v) => void run(() => updateConsole(c.id, { voyage: v }))}
                      />
                      <Field
                        label="Mother vessel"
                        value={c.mother_vessel}
                        hint="On a transhipment, the ship that arrives"
                        onCommit={(v) => void run(() => updateConsole(c.id, { mother_vessel: v }))}
                      />
                      <Field
                        label="Cut-off"
                        type="date"
                        value={c.cutoff_date ?? ""}
                        onCommit={(v) =>
                          void run(() => updateConsole(c.id, { cutoff_date: v || null }))
                        }
                      />
                    </Section>

                    <Section title="Ports">
                      <Field
                        label="Port of loading"
                        value={c.pol}
                        onCommit={(v) => void run(() => updateConsole(c.id, { pol: v }))}
                      />
                      <Field
                        label="POL code"
                        value={c.pol_code}
                        mono
                        placeholder="INMAA1"
                        onCommit={(v) =>
                          void run(() => updateConsole(c.id, { pol_code: v.toUpperCase() }))
                        }
                      />
                      <Field
                        label="Port of discharge"
                        value={c.pod}
                        onCommit={(v) => void run(() => updateConsole(c.id, { pod: v }))}
                      />
                      <Field
                        label="POD code"
                        value={c.pod_code}
                        mono
                        onCommit={(v) =>
                          void run(() => updateConsole(c.id, { pod_code: v.toUpperCase() }))
                        }
                      />
                      <Field
                        label="Place of delivery"
                        value={c.place_of_delivery}
                        onCommit={(v) =>
                          void run(() => updateConsole(c.id, { place_of_delivery: v }))
                        }
                      />
                      <Field
                        label="Delivery code"
                        value={c.delivery_code}
                        mono
                        onCommit={(v) =>
                          void run(() => updateConsole(c.id, { delivery_code: v.toUpperCase() }))
                        }
                      />
                      <Field
                        label="ETD"
                        type="date"
                        value={c.etd ?? ""}
                        onCommit={(v) => void run(() => updateConsole(c.id, { etd: v || null }))}
                      />
                      <Field
                        label="ETA"
                        type="date"
                        value={c.eta ?? ""}
                        onCommit={(v) => void run(() => updateConsole(c.id, { eta: v || null }))}
                      />
                    </Section>

                    <Section title="Customs filings">
                      <Field
                        label="MLO code"
                        value={c.mlo_code}
                        mono
                        hint="The main line operator's"
                        onCommit={(v) =>
                          void run(() => updateConsole(c.id, { mlo_code: v.toUpperCase() }))
                        }
                      />
                      <Field
                        label="IGM number"
                        value={c.igm_no}
                        mono
                        onCommit={(v) => void run(() => updateConsole(c.id, { igm_no: v }))}
                      />
                      <Field
                        label="CSN number"
                        value={c.csn_no}
                        mono
                        onCommit={(v) => void run(() => updateConsole(c.id, { csn_no: v }))}
                      />
                      <Field
                        label="Cargo identification no"
                        value={c.cargo_identification_no}
                        mono
                        onCommit={(v) =>
                          void run(() => updateConsole(c.id, { cargo_identification_no: v }))
                        }
                      />
                    </Section>

                    {/* ---- the house bills ---- */}
                    <section>
                      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                        House bills on this console
                      </h3>
                      {list.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-[12px] text-text-muted">
                          Nothing on it yet. Put a shipment on a console from its Parties &amp; B/L
                          section.
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[38rem] text-[13px]">
                            <thead>
                              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                                <th className="py-1.5 pr-2 font-medium">Shipment</th>
                                <th className="py-1.5 pr-2 font-medium">Consignee</th>
                                <th className="py-1.5 pr-2 text-right font-medium">Weight</th>
                                <th className="py-1.5 pr-2 text-right font-medium">Volume</th>
                                <th className="py-1.5 pr-2 font-medium">House B/L</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {list.map((sh) => (
                                <tr key={sh.id}>
                                  <td className="py-1.5 pr-2">
                                    <Link
                                      to={`/shipments/${sh.id}`}
                                      className="font-mono text-[12px] text-text-accent hover:underline"
                                    >
                                      {sh.id}
                                    </Link>
                                  </td>
                                  <td className="py-1.5 pr-2 text-text-primary">
                                    {sh.consignee_name || (
                                      <span className="text-text-muted">not named</span>
                                    )}
                                  </td>
                                  <td className="py-1.5 pr-2 text-right tabular-nums text-text-secondary">
                                    {sh.gross_weight_kg === null
                                      ? "—"
                                      : `${sh.gross_weight_kg.toLocaleString("en-IN")} kg`}
                                  </td>
                                  <td className="py-1.5 pr-2 text-right tabular-nums text-text-secondary">
                                    {sh.volume_cbm === null ? "—" : `${sh.volume_cbm} CBM`}
                                  </td>
                                  <td className="py-1.5 pr-2">
                                    {sh.bl_number ? (
                                      <span className="font-mono text-[12px] text-text-primary">
                                        {sh.bl_number}
                                      </span>
                                    ) : (
                                      <button
                                        onClick={() => void run(() => issueHouseBl(sh.id))}
                                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-surface-1 px-2 text-[11px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                                      >
                                        <Ship size={11} />
                                        Issue one
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {s && (
                        <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
                          {s.container_count} container{s.container_count === 1 ? "" : "s"} ·{" "}
                          {s.packages.toLocaleString("en-IN")} packages ·{" "}
                          {Number(s.gross_weight_kg).toLocaleString("en-IN")} kg ·{" "}
                          {Number(s.volume_cbm).toLocaleString("en-IN")} CBM
                          {lf !== null
                            ? ` — ${lf}% of what this box holds.`
                            : " — load factor needs the container type on the booked space."}
                        </p>
                      )}
                    </section>

                    {/* ---- the list for the agent at the other end (090) ---- */}
                    <ConsoleManifest console={c} jobs={list.length} onChanged={() => void load()} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
