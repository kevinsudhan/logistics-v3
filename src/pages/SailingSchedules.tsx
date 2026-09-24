import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowDown, ArrowUp, CalendarRange, Check, ChevronDown, Download, Loader2, Pencil, Plus, Save, Trash2, Upload, X } from "lucide-react";
import AddContainer from "../components/AddContainer";
import ContainerList from "../components/ContainerList";
import PageHeader from "../components/PageHeader";
import { failureText } from "../lib/errorText";
import { downloadWorkbook, stamped } from "../lib/xlsx";
import { readSpreadsheet } from "../lib/xlsxRead";
import { SCHEDULE_COLUMNS, schedulesFromSheet, type ImportResult, type ScheduleInput } from "../lib/schedules";
import { todayIST } from "../lib/progress";
import { listContainers, type Container } from "../services/containers";
import { listPartners, type Partner } from "../services/partners";
import { departureName, importSchedules, listSchedules, removeSchedule, saveSchedule, STATUS_LABEL, type Schedule } from "../services/schedules";

/**
 * The sailing schedule: departures the rest of the system is built from.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS FOR
 *
 * A shipment, a console, a container and a quotation each pick their departure
 * from here, and the vessel or flight, the ports, the cut-offs and the dates
 * come with it — typed once, here, instead of on every booking that sails on
 * it.
 *
 * GETTING SCHEDULES IN
 *
 * One at a time with Create, or a whole carrier's sheet with Upload: the
 * common header names are understood (POL, POD, "Vessel name", "CFS cut
 * off"), each row that cannot be read is named by line, and nothing is
 * written until the preview is accepted. Download writes the same columns, so
 * a sheet can go out, be edited, and come back.
 *
 * THE CONTAINERS ON EACH DEPARTURE
 *
 * The boxes the desk holds space in are added under the sailing they go on,
 * and open to show what is on board: one page for the departure and the
 * space on it, where there used to be three. A container from before this,
 * tied to no departure, is listed under the table until it sails.
 *
 * SAVED FILTERS
 *
 * A view somebody uses every morning — "Chennai to Jebel Ali, sea, upcoming" —
 * is saved under a name in this browser. It is a convenience of the person,
 * not a record, which is why it is not in the database.
 * ---------------------------------------------------------------------------
 */

type View = "upcoming" | "all" | "past" | "cancelled";
interface Filters {
  view: View;
  mode: "" | "sea" | "air";
  service: "" | "LCL" | "FCL" | "AIR";
  q: string;
}
const DEFAULT: Filters = { view: "upcoming", mode: "", service: "", q: "" };
const SAVED_KEY = "sailing-schedule:saved-filters";

type SortKey = "id" | "port_of_loading" | "port_of_discharge" | "etd" | "eta" | "cfs_cutoff" | "port_cutoff" | "transit_days";

export default function SailingSchedules() {
  const [rows, setRows] = useState<Schedule[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<Filters>(DEFAULT);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "etd", dir: 1 });
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);
  const [preview, setPreview] = useState<(ImportResult & { file: string }) | null>(null);
  const [saved, setSaved] = useState<Array<{ name: string; filters: Filters }>>([]);
  const [reportName, setReportName] = useState("");
  const [containers, setContainers] = useState<Container[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<Schedule | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const upload = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [schedules, boxes] = await Promise.all([listSchedules(), listContainers().catch(() => [] as Container[])]);
      setRows(schedules);
      setContainers(boxes);
    } catch (e) {
      setError(failureText(e, "Could not load the schedule.").message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void listPartners()
      .then(setPartners)
      .catch(() => setPartners([]));
    try {
      setSaved(JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]"));
    } catch {
      setSaved([]);
    }
  }, [load]);

  function persist(next: Array<{ name: string; filters: Filters }>) {
    setSaved(next);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {
      // A browser that will not store it still filters; it just does not remember.
    }
  }

  const today = todayIST();
  const visible = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return rows
      .filter((r) =>
        f.view === "cancelled"
          ? r.status === "cancelled"
          : f.view === "past"
            ? r.etd < today && r.status !== "cancelled"
            : f.view === "upcoming"
              ? r.etd >= today && r.status !== "cancelled"
              : true,
      )
      .filter((r) => !f.mode || r.mode === f.mode)
      .filter((r) => !f.service || r.services.includes(f.service))
      .filter(
        (r) =>
          !q ||
          [r.id, r.carrier, r.vessel, r.voyage, r.flight_number, r.port_of_receipt, r.port_of_loading, r.port_of_discharge, r.final_destination]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
      )
      .sort((a, b) => {
        const x = a[sort.key] ?? "";
        const y = b[sort.key] ?? "";
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
  }, [rows, f, sort, today]);

  const onDeparture = useMemo(() => {
    const m = new Map<string, Container[]>();
    for (const c of containers) if (c.schedule_id) m.set(c.schedule_id, [...(m.get(c.schedule_id) ?? []), c]);
    return m;
  }, [containers]);
  // Tied to no departure on the list, and still to sail.
  const loose = useMemo(() => {
    const ids = new Set(rows.map((r) => r.id));
    return containers.filter((c) => (!c.schedule_id || !ids.has(c.schedule_id)) && c.status !== "sailed");
  }, [containers, rows]);
  const changed = async (message: string) => {
    setNotice(message);
    await load();
  };

  function download() {
    const cols = SCHEDULE_COLUMNS;
    downloadWorkbook(stamped("sailing-schedule"), [
      {
        name: "Sailing schedule",
        columns: cols.map((c) => ({ header: c.header, width: c.width })),
        rows: visible.map((r) =>
          cols.map((c) => {
            const v = (r as unknown as Record<string, unknown>)[c.key];
            if (c.key === "services") return (v as string[]).join(" ");
            if (c.date) return v ? new Date(`${v}T00:00:00`) : null;
            return (v as string | number | null) ?? null;
          }),
        ),
      },
    ]);
  }

  async function pickFile(file: File) {
    setError(null);
    try {
      const sheet = await readSpreadsheet(file);
      setPreview({ ...schedulesFromSheet(sheet), file: file.name });
    } catch (e) {
      setError(failureText(e, "Could not read that file.").message);
    }
  }

  const header = (key: SortKey, label: string) => (
    <th className="whitespace-nowrap px-2 py-2 font-medium">
      <button
        type="button"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : 1 }))}
        className="inline-flex items-center gap-1 hover:text-text-primary"
      >
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
  const day = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

  return (
    <div>
      <PageHeader
        title="Sailing schedule"
        subtitle="Departures, and the containers the desk holds space in on each. Bookings, consoles and quotations pick from here."
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={download}
              disabled={!visible.length}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary disabled:opacity-50"
            >
              <Download size={13} /> Download Excel
            </button>
            <button
              type="button"
              onClick={() => upload.current?.click()}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary"
            >
              <Upload size={13} /> Upload Excel
            </button>
            <input
              ref={upload}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void pickFile(file);
              }}
            />
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark"
            >
              <Plus size={13} /> Create sailing schedule
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {notice && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-bg-success px-3 py-2.5 text-[12px] text-text-success">
          <Check size={13} className="mt-px shrink-0" />
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* ---- filters ---- */}
      <div className="card mb-3 flex flex-wrap items-center gap-2 p-3">
        <select value={f.view} onChange={(e) => setF({ ...f, view: e.target.value as View })} className="h-8" aria-label="Which departures">
          <option value="upcoming">Upcoming</option>
          <option value="all">Show all</option>
          <option value="past">Departed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as Filters["mode"] })} className="h-8" aria-label="Mode">
          <option value="">Sea and air</option>
          <option value="sea">Sea</option>
          <option value="air">Air</option>
        </select>
        <select value={f.service} onChange={(e) => setF({ ...f, service: e.target.value as Filters["service"] })} className="h-8" aria-label="Service">
          <option value="">Any service</option>
          <option value="LCL">LCL</option>
          <option value="FCL">FCL</option>
          <option value="AIR">Air</option>
        </select>
        <input
          value={f.q}
          onChange={(e) => setF({ ...f, q: e.target.value })}
          placeholder="Port, vessel, carrier or schedule ID"
          className="h-8 min-w-[220px] flex-1"
        />
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
        <input value={reportName} onChange={(e) => setReportName(e.target.value)} placeholder="Report name" className="h-8 w-40" />
        <button
          type="button"
          disabled={!reportName.trim()}
          onClick={() => {
            persist([...saved.filter((s) => s.name !== reportName.trim()), { name: reportName.trim(), filters: f }]);
            setReportName("");
          }}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          <Save size={12} /> Save filter
        </button>
        <button type="button" onClick={() => setF(DEFAULT)} className="h-8 px-2 text-[12px] text-text-secondary hover:text-text-primary">
          Clear all
        </button>
      </div>
      {saved.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {saved.map((s) => (
            <span key={s.name} className="inline-flex items-center overflow-hidden rounded-full border border-border bg-surface-1 text-[12px]">
              <button type="button" onClick={() => setF(s.filters)} className="px-2.5 py-1 text-text-secondary hover:text-text-primary">
                {s.name}
              </button>
              <button
                type="button"
                onClick={() => persist(saved.filter((x) => x.name !== s.name))}
                className="border-l border-border px-1.5 py-1 text-text-muted hover:text-text-danger"
                aria-label={`Forget ${s.name}`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ---- the list ---- */}
      {loading && !rows.length ? (
        <p className="py-8 text-[13px] text-text-muted">Loading…</p>
      ) : !rows.length ? (
        <div className="rounded-card border border-dashed border-border-strong bg-surface-1 p-10 text-center">
          <CalendarRange size={20} className="mx-auto text-text-muted" />
          <p className="mt-2 text-[14px] font-medium text-text-primary">No sailings yet</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-text-secondary">Create one, or upload a carrier&rsquo;s schedule as Excel or CSV.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-surface-2 text-left text-[11px] text-text-secondary">
                <th className="px-2 py-2 font-medium">S.No</th>
                {header("id", "Schedule ID")}
                <th className="px-2 py-2 font-medium">Services</th>
                <th className="px-2 py-2 font-medium">Port of receipt</th>
                {header("port_of_loading", "Port of loading")}
                {header("port_of_discharge", "Port of discharge")}
                <th className="px-2 py-2 font-medium">Final destination</th>
                {header("cfs_cutoff", "CFS cut-off")}
                {header("port_cutoff", "Port cut-off")}
                {header("etd", "ETD")}
                {header("eta", "ETA")}
                {header("transit_days", "Transit")}
                <th className="px-2 py-2 font-medium">Carrier / vessel</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Containers</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => {
                const boxes = onDeparture.get(r.id) ?? [];
                const open = openId === r.id;
                const onBoard = boxes.reduce((n, c) => n + (c.enquiry_count ?? 0), 0);
                return (
                  <Fragment key={r.id}>
                    <tr className={`border-t border-border ${open ? "bg-surface-2/60" : ""}`}>
                      <td className="px-2 py-2 text-text-muted">{i + 1}</td>
                      <td className="px-2 py-2">
                        <button type="button" onClick={() => setEditing(r)} className="font-mono text-[12px] font-medium text-text-accent hover:underline">
                          {r.id}
                        </button>
                      </td>
                      <td className="px-2 py-2">{r.services.join(" ")}</td>
                      <td className="px-2 py-2">{r.port_of_receipt}</td>
                      <td className="px-2 py-2">{r.port_of_loading}</td>
                      <td className="px-2 py-2">{r.port_of_discharge}</td>
                      <td className="px-2 py-2">{r.final_destination}</td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">{day(r.cfs_cutoff)}</td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">{day(r.port_cutoff)}</td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">{day(r.etd)}</td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">{day(r.eta)}</td>
                      <td className="px-2 py-2 tabular-nums">{r.transit_days == null ? "" : `${r.transit_days}d`}</td>
                      <td className="px-2 py-2">{departureName(r)}</td>
                      <td className={`px-2 py-2 ${r.status === "cancelled" ? "text-text-danger" : "text-text-secondary"}`}>{STATUS_LABEL[r.status]}</td>
                      <td className="whitespace-nowrap px-2 py-2">
                        {r.mode === "air" ? (
                          <span className="text-text-muted">—</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setOpenId(open ? null : r.id)}
                            aria-expanded={open}
                            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] hover:bg-surface-2 ${boxes.length ? "font-medium text-text-primary" : "text-text-muted"}`}
                          >
                            {boxes.length ? `${boxes.length} ${boxes.length === 1 ? "box" : "boxes"}${onBoard ? ` · ${onBoard} on board` : ""}` : "None"}
                            <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
                          </button>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-1 py-1 text-right">
                        <button
                          type="button"
                          onClick={() => setEditing(r)}
                          className="rounded p-1 text-text-muted hover:text-text-primary"
                          aria-label={`Edit ${r.id}`}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Delete ${r.id}? Bookings that picked it keep their dates.`))
                              void removeSchedule(r.id)
                                .then(load)
                                .catch((e) => setError(failureText(e, "Could not delete it.").message));
                          }}
                          className="rounded p-1 text-text-muted hover:text-text-danger"
                          aria-label={`Delete ${r.id}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-surface-2/60">
                        <td colSpan={16} className="px-3 pb-3 pt-1">
                          {/* Pinned to the left edge, so a wide table scrolled sideways still shows it. */}
                          <div className="sticky left-3 max-w-[calc(100vw-4rem)] lg:max-w-4xl">
                            {boxes.length > 0 && <ContainerList containers={boxes} onChanged={changed} onError={setError} />}
                            <button
                              type="button"
                              disabled={r.status === "cancelled"}
                              onClick={() => setAddingTo(r)}
                              className="mt-2 flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border-strong bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary disabled:opacity-50"
                            >
                              <Plus size={13} /> Add a container on this sailing
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!visible.length && (
                <tr>
                  <td colSpan={16} className="px-2 py-6 text-center text-[12.5px] text-text-muted">
                    Nothing matches these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {loose.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-1 text-[13px] font-medium text-text-primary">Containers not on a departure</h2>
          <p className="mb-2 text-[12px] text-text-muted">Added before containers went under their sailing. They stay here until they sail.</p>
          <ContainerList containers={loose} onChanged={changed} onError={setError} />
        </section>
      )}

      {addingTo && (
        <AddContainer
          partners={partners}
          schedule={addingTo}
          onClose={() => setAddingTo(null)}
          onAdded={(c) => {
            setAddingTo(null);
            setOpenId(addingTo.id);
            void changed(`${c.id} added on ${addingTo.id}.`);
          }}
        />
      )}

      {editing && (
        <ScheduleForm
          schedule={editing === "new" ? null : editing}
          carriers={partners.filter((p) => p.role === "carrier" || p.role === "consol_partner")}
          ports={[
            ...new Set(rows.flatMap((r) => [r.port_of_receipt, r.port_of_loading, r.port_of_discharge, r.final_destination]).filter(Boolean) as string[]),
          ].sort()}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      {preview && (
        <UploadPreview
          result={preview}
          onClose={() => setPreview(null)}
          onDone={async () => {
            await load();
          }}
        />
      )}
    </div>
  );
}

/** Create or edit one departure. */
function ScheduleForm({
  schedule,
  carriers,
  ports,
  onClose,
  onSaved,
}: {
  schedule: Schedule | null;
  carriers: Partner[];
  ports: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [s, setS] = useState<ScheduleInput>(
    schedule
      ? { ...schedule }
      : {
          mode: "sea",
          services: ["LCL", "FCL"],
          carrier: null,
          vessel: null,
          voyage: null,
          flight_number: null,
          port_of_receipt: null,
          port_of_loading: "",
          port_of_discharge: "",
          final_destination: null,
          cfs_cutoff: null,
          port_cutoff: null,
          si_cutoff: null,
          etd: "",
          eta: null,
          status: "scheduled",
          notes: null,
        },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ScheduleInput>(k: K, v: ScheduleInput[K]) => setS((x) => ({ ...x, [k]: v }));
  const text = (k: keyof ScheduleInput) => (v: string) => set(k, (v.trim() || null) as never);
  const air = s.mode === "air";
  const problem =
    !s.port_of_loading.trim() || !s.port_of_discharge.trim() || !s.etd
      ? "Port of loading, port of discharge and ETD are needed."
      : s.eta && s.eta < s.etd
        ? "ETA is before ETD."
        : null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveSchedule({ ...s, id: schedule?.id });
      await onSaved();
    } catch (e) {
      setError(failureText(e, "Could not save it.").message);
      setBusy(false);
    }
  }

  const input = (label: string, k: keyof ScheduleInput, type = "text", list?: string) => (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-text-secondary">{label}</span>
      <input
        type={type}
        list={list}
        value={((s[k] as string | null) ?? "").toString().slice(0, type === "date" ? 10 : undefined)}
        onChange={(e) => (k === "port_of_loading" || k === "port_of_discharge" || k === "etd" ? set(k, e.target.value as never) : text(k)(e.target.value))}
        className="h-8 w-full"
      />
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Sailing schedule"
    >
      <div className="card mt-8 w-full max-w-3xl p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-text-primary">{schedule ? `Edit ${schedule.id}` : "Create sailing schedule"}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-text-muted hover:text-text-primary" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <datalist id="schedule-ports">
          {ports.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <datalist id="schedule-carriers">
          {carriers.map((c) => (
            <option key={c.id} value={c.organisation || c.name} />
          ))}
        </datalist>

        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <div className="sm:col-span-2">
            <span className="mb-0.5 block text-[11px] text-text-secondary">Mode and services</span>
            <div className="flex flex-wrap gap-1.5">
              {(["sea", "air"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() =>
                    setS((x) => ({
                      ...x,
                      mode: m,
                      services: m === "air" ? ["AIR"] : x.services.filter((v) => v !== "AIR").length ? x.services.filter((v) => v !== "AIR") : ["LCL", "FCL"],
                    }))
                  }
                  className={`h-8 rounded-lg border px-3 text-[12px] ${s.mode === m ? "border-brand bg-brand text-white" : "border-border text-text-secondary"}`}
                >
                  {m === "sea" ? "Sea" : "Air"}
                </button>
              ))}
              {!air &&
                (["LCL", "FCL"] as const).map((sv) => (
                  <label key={sv} className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px]">
                    <input
                      type="checkbox"
                      checked={s.services.includes(sv)}
                      onChange={(e) => set("services", e.target.checked ? [...s.services, sv] : s.services.filter((x) => x !== sv))}
                    />
                    {sv}
                  </label>
                ))}
            </div>
          </div>
          {input(air ? "Airline" : "Carrier / line", "carrier", "text", "schedule-carriers")}
          {air ? input("Flight number", "flight_number") : input("Vessel", "vessel")}
          {!air && input("Voyage", "voyage")}
          {input("Port of receipt", "port_of_receipt", "text", "schedule-ports")}
          {input(air ? "Airport of loading *" : "Port of loading *", "port_of_loading", "text", "schedule-ports")}
          {input(air ? "Airport of discharge *" : "Port of discharge *", "port_of_discharge", "text", "schedule-ports")}
          {input("Final destination", "final_destination", "text", "schedule-ports")}
          {input("ETD *", "etd", "date")}
          {input("ETA", "eta", "date")}
          {input("CFS cut-off", "cfs_cutoff", "date")}
          {input("Port cut-off", "port_cutoff", "date")}
          {!air && input("SI cut-off", "si_cutoff", "date")}
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-text-secondary">Status</span>
            <select value={s.status} onChange={(e) => set("status", e.target.value as ScheduleInput["status"])} className="h-8 w-full">
              {(Object.keys(STATUS_LABEL) as Array<Schedule["status"]>).map((k) => (
                <option key={k} value={k}>
                  {STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2 md:col-span-4">
            <span className="mb-0.5 block text-[11px] text-text-secondary">Notes</span>
            <input value={s.notes ?? ""} onChange={(e) => text("notes")(e.target.value)} className="h-8 w-full" />
          </label>
        </div>

        {(error || problem) && <p className={`mt-3 text-[12px] ${error ? "text-text-danger" : "text-text-muted"}`}>{error ?? problem}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 rounded-lg border border-border px-4 text-[12px] text-text-secondary">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || Boolean(problem)}
            onClick={() => void save()}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-4 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/** What an uploaded sheet will do, before it does it. */
function UploadPreview({ result, onClose, onDone }: { result: ImportResult & { file: string }; onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Awaited<ReturnType<typeof importSchedules>> | null>(null);
  const updates = result.rows.filter((r) => r.id).length;
  const fresh = result.rows.length - updates;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Upload preview"
    >
      <div className="card mt-8 w-full max-w-2xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-text-primary">Upload {result.file}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-text-muted hover:text-text-primary" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {outcome ? (
          <>
            <p className="text-[13px] text-text-primary">
              {outcome.created} created, {outcome.updated} updated
              {outcome.failed.length ? `, ${outcome.failed.length} did not save` : ""}.
            </p>
            {outcome.failed.length > 0 && (
              <ul className="mt-2 max-h-40 overflow-y-auto text-[12px] text-text-danger">
                {outcome.failed.map((x) => (
                  <li key={x.row}>
                    Row {x.row}: {x.message}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={onClose} className="h-8 rounded-lg bg-brand px-4 text-[12px] font-medium text-white">
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] text-text-primary">
              {fresh} new {fresh === 1 ? "sailing" : "sailings"}
              {updates ? `, ${updates} ${updates === 1 ? "update" : "updates"} to existing schedules` : ""}.
            </p>
            {result.ignored.length > 0 && <p className="mt-1 text-[12px] text-text-muted">Columns not used: {result.ignored.join(", ")}.</p>}
            {result.errors.length > 0 && (
              <>
                <p className="mt-3 text-[12px] font-medium text-text-danger">
                  {result.errors.length} {result.errors.length === 1 ? "row" : "rows"} will be skipped:
                </p>
                <ul className="mt-1 max-h-40 overflow-y-auto text-[12px] text-text-danger">
                  {result.errors.map((x, i) => (
                    <li key={i}>
                      Line {x.line}: {x.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {result.rows.length > 0 && (
              <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-border">
                <table className="w-full text-[12px]">
                  <tbody>
                    {result.rows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t border-border first:border-t-0">
                        <td className="px-2 py-1 font-mono text-text-muted">{r.id ?? "new"}</td>
                        <td className="px-2 py-1">
                          {r.port_of_loading} → {r.port_of_discharge}
                        </td>
                        <td className="px-2 py-1 tabular-nums">{r.etd}</td>
                        <td className="px-2 py-1">{departureName(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="h-8 rounded-lg border border-border px-4 text-[12px] text-text-secondary">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !result.rows.length}
                onClick={async () => {
                  setBusy(true);
                  const o = await importSchedules(result.rows);
                  setOutcome(o);
                  setBusy(false);
                  await onDone();
                }}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-4 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {busy && <Loader2 size={13} className="animate-spin" />}
                Import {result.rows.length}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
