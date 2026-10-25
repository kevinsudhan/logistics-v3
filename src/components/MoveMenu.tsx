import { useRef, useState } from "react";
import { Archive, ChevronDown, Folder, FolderInput, Inbox, ShieldAlert } from "lucide-react";
import type { FolderId, MailFolder } from "../services/backend";
import { useMenu } from "../lib/useMenu";

/**
 * Outlook's "Move to": every folder a message can be filed in — the Inbox,
 * Archive, the person's own folders, and Junk — less the one it is in.
 * Sent, Drafts and Deleted Items are not destinations here: Delete is its own
 * button, and a message is not moved into Sent or Drafts.
 */
export default function MoveMenu({
  folders,
  current,
  onMove,
  compact,
}: {
  folders: MailFolder[];
  current: FolderId;
  onMove: (to: FolderId, label: string) => void;
  /** Icon only, for a narrow bar. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Arrows, Escape and Tab work in it (lib/useMenu).
  const menu = useRef<HTMLDivElement>(null);
  useMenu(menu, open, () => setOpen(false));
  const targets = folders.filter((f) => f.id !== current && f.id !== "sent" && f.id !== "drafts" && f.id !== "deleted");
  const icon = (id: FolderId) => (id === "inbox" ? Inbox : id === "archive" ? Archive : id === "junk" ? ShieldAlert : Folder);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Move to a folder"
        aria-label="Move to a folder"
        className={`flex h-8 items-center gap-1 rounded-lg border border-border text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary ${compact ? "px-2" : "px-2.5"}`}
      >
        <FolderInput size={13} />
        {!compact && <span>Move to</span>}
        <ChevronDown size={11} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div ref={menu} className="absolute left-0 top-9 z-30 max-h-80 w-60 overflow-y-auto rounded-xl border border-border bg-surface-1 p-1 shadow-lg">
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">Move to</p>
            {targets.map((f) => {
              const Icon = icon(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onMove(f.id, f.label);
                  }}
                  style={{ paddingLeft: 10 + (f.depth ?? 0) * 14 }}
                  className="flex w-full items-center gap-2 rounded-lg py-1.5 pr-2.5 text-left text-[13px] text-text-primary hover:bg-surface-2"
                >
                  <Icon size={13} className="shrink-0 text-text-muted" />
                  <span className="truncate">{f.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
