import { createContext, useContext, useState } from "react";
import { useTablesChanges, type Watch } from "./useTableChanges";

/**
 * One subscription for a page, and a version number per table for everything
 * inside it.
 *
 * ---------------------------------------------------------------------------
 * WHY
 *
 * The job file is a shell with a dozen tabs and panels, each reading its own
 * table: containers, pickups, customs, files, the HAWB, tracking, invoices.
 * Every one subscribing for itself would open a dozen channels per job opened.
 * Instead the page subscribes once, to every table it shows, filtered to this
 * job, and counts the changes per table. A tab asks for the count of the
 * tables it reads and puts it in its load effect's dependencies:
 *
 *   const live = useLiveVersion("shipment_containers");
 *   useEffect(() => void load(), [load, live]);
 *
 * so it reads itself again when, and only when, one of its tables moves.
 *
 * A tab that holds unsaved edits (the HAWB) checks for them before reloading:
 * somebody else's save must not wipe what this person is typing.
 * ---------------------------------------------------------------------------
 */

type Versions = Record<string, number>;

const LiveContext = createContext<Versions | null>(null);

/** Subscribes to the tables and counts their changes; `onChange` also hears which moved. */
export function useLiveVersions(watches: readonly Watch[], onChange?: (tables: Set<string>) => void, enabled = true): Versions {
  const [versions, setVersions] = useState<Versions>({});
  useTablesChanges(
    watches,
    (tables) => {
      setVersions((v) => {
        const next = { ...v };
        for (const t of tables) next[t] = (next[t] ?? 0) + 1;
        return next;
      });
      onChange?.(tables);
    },
    enabled
  );
  return versions;
}

/** Hands the counts to everything inside. */
export function LiveVersions({ value, children }: { value: Versions; children: React.ReactNode }) {
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

/** Changes whenever any of these tables changes in the nearest LiveVersions. Zero outside one. */
export function useLiveVersion(...tables: string[]): number {
  const v = useContext(LiveContext);
  return v ? tables.reduce((sum, t) => sum + (v[t] ?? 0), 0) : 0;
}

/** Every table keyed to one job, filtered to it. */
export const SHIPMENT_TABLES = [
  "shipment_checkpoints",
  "shipment_containers",
  "shipment_customs",
  "shipment_movements",
  "shipment_parties",
  "shipment_routings",
  "shipment_track_links",
  "warehouse_receipts",
  "house_airwaybills",
  "house_airwaybill_history",
  "house_bills",
  "house_bill_history",
  "tracking_events",
  "tracking_positions",
  "tracking_snapshots",
  "invoices",
  "bills",
] as const;

/** Every table keyed to one enquiry, filtered to it. */
export const ENQUIRY_TABLES = [
  "enquiry_events",
  "enquiry_parties",
  "enquiry_dimensions",
  "enquiry_files",
  "enquiry_messages",
  "enquiry_threads",
  "partner_assignments",
  "partner_quotes",
  "quotes",
] as const;

export const shipmentWatches = (shipmentId: string): Watch[] => SHIPMENT_TABLES.map((t) => [t, `shipment_id=eq.${shipmentId}`] as const);
export const enquiryWatches = (ref: string): Watch[] => ENQUIRY_TABLES.map((t) => [t, `enquiry_ref=eq.${ref.toUpperCase()}`] as const);
