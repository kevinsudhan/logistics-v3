import { useEffect, useRef, useState } from "react";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Check, ChevronDown } from "lucide-react";
import { FONT_CHOICES, HIGHLIGHT_COLORS, MAIL_COLOR, SIZE_CHOICES, TEXT_COLORS } from "../../lib/mailStyle";

/**
 * The drop-downs on the mail editor's toolbar (25 Sep 2026): font, size, font
 * colour, highlight, alignment, link and table.
 *
 * Every control here keeps the editor's selection: a mousedown that moved
 * focus would take the highlighted text with it, and the command would then
 * apply to nothing. The one exception is typing into a field (a link address,
 * a custom colour), where the editor remembers the selection and puts it back
 * before the command runs.
 */

/** A toolbar button that never takes focus from the text. */
export function ToolButton({
  label,
  onClick,
  active = false,
  disabled = false,
  children,
  wide = false,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`h-7 ${wide ? "px-1.5 gap-1" : "w-7"} inline-flex items-center justify-center rounded text-[12px] transition-colors disabled:opacity-40 ${
        active ? "bg-surface-1 text-text-primary shadow-[inset_0_0_0_1px_var(--border-strong)]" : "text-text-secondary hover:bg-surface-1 hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}

export const Divider = () => <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden />;

/** A button with a panel under it, closed by a click elsewhere or Escape. */
export function Menu({
  label,
  button,
  open,
  onOpen,
  onClose,
  children,
  width = 200,
  wide = true,
  active = false,
}: {
  label: string;
  button: React.ReactNode;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  wide?: boolean;
  active?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    // Escape closes the menu, not the whole compose window behind it.
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [open, onClose]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? onClose() : onOpen())}
        className={`h-7 inline-flex items-center gap-0.5 rounded text-[12px] ${wide ? "px-1.5" : "px-1"} ${
          open || active ? "bg-surface-1 text-text-primary shadow-[inset_0_0_0_1px_var(--border-strong)]" : "text-text-secondary hover:bg-surface-1 hover:text-text-primary"
        }`}
      >
        {button}
        <ChevronDown size={11} className="shrink-0 opacity-60" />
      </button>
      {open && (
        <div
          role="menu"
          style={{ width }}
          className="absolute left-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-surface-1 p-1 shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  );
}

const itemClass = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-text-primary hover:bg-surface-2";

export function FontMenu({ current, open, onOpen, onClose, onPick }: { current: string; open: boolean; onOpen: () => void; onClose: () => void; onPick: (css: string) => void }) {
  return (
    <Menu label="Font" open={open} onOpen={onOpen} onClose={onClose} width={210} button={<span className="w-[92px] truncate text-left">{current}</span>}>
      {FONT_CHOICES.map((f) => (
        <button key={f.label} type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(f.css)} className={itemClass} style={{ fontFamily: f.css }}>
          <span className="w-3 shrink-0">{current === f.label && <Check size={12} />}</span>
          <span className="text-[13px]">{f.label}</span>
        </button>
      ))}
    </Menu>
  );
}

export function SizeMenu({ current, open, onOpen, onClose, onPick }: { current: number | null; open: boolean; onOpen: () => void; onClose: () => void; onPick: (pt: number) => void }) {
  return (
    <Menu label="Font size" open={open} onOpen={onOpen} onClose={onClose} width={84} button={<span className="w-7 text-left tabular-nums">{current ?? ""}</span>}>
      {SIZE_CHOICES.map((pt) => (
        <button key={pt} type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(pt)} className={`${itemClass} tabular-nums`}>
          <span className="w-3 shrink-0">{current === pt && <Check size={12} />}</span>
          {pt}
        </button>
      ))}
    </Menu>
  );
}

/** Font colour and highlight share one shape: a way to take it off, a grid, and (for font colour) any colour. */
export function ColorMenu({
  kind,
  open,
  onOpen,
  onClose,
  onPick,
  last,
  onRemember,
}: {
  kind: "text" | "highlight";
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** null = automatic colour, or no highlight. */
  onPick: (hex: string | null) => void;
  last: string;
  /** Keep the selection before a field takes focus. */
  onRemember: () => void;
}) {
  const colors = kind === "text" ? TEXT_COLORS : HIGHLIGHT_COLORS;
  const [custom, setCustom] = useState(last);
  return (
    <div className="flex items-stretch">
      <button
        type="button"
        title={kind === "text" ? "Font colour" : "Highlight"}
        aria-label={kind === "text" ? "Font colour" : "Highlight"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPick(last)}
        className="h-7 w-7 inline-flex flex-col items-center justify-center rounded-l text-text-secondary hover:bg-surface-1 hover:text-text-primary"
      >
        {kind === "text" ? (
          <span className="text-[13px] font-semibold leading-none">A</span>
        ) : (
          <span className="rounded-sm px-0.5 text-[11px] font-semibold leading-none" style={{ background: last, color: "#000" }}>
            ab
          </span>
        )}
        <span className="mt-0.5 h-[3px] w-4 rounded-sm" style={{ background: last }} />
      </button>
      <Menu label={kind === "text" ? "More font colours" : "More highlight colours"} open={open} onOpen={onOpen} onClose={onClose} width={kind === "text" ? 212 : 188} wide={false} button={null}>
        <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(null)} className={itemClass}>
          {kind === "text" ? (
            <>
              <span className="size-3.5 shrink-0 rounded-sm border border-border" style={{ background: MAIL_COLOR }} /> Automatic
            </>
          ) : (
            <>
              <span className="size-3.5 shrink-0 rounded-sm border border-border bg-white" /> No colour
            </>
          )}
        </button>
        <div className={`grid gap-1 p-1.5 ${kind === "text" ? "grid-cols-10" : "grid-cols-7"}`}>
          {colors.map((c) => (
            <button
              key={c.hex}
              type="button"
              title={c.name}
              aria-label={c.name}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(c.hex)}
              className="size-[17px] rounded-sm border border-black/15 hover:scale-110 hover:shadow"
              style={{ background: c.hex }}
            />
          ))}
        </div>
        {kind === "text" && (
          <label className="flex items-center gap-2 border-t border-border px-2 pb-1 pt-2 text-[12px] text-text-secondary" onMouseDown={onRemember}>
            <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0" />
            <span className="flex-1">More colours</span>
            <button type="button" onClick={() => onPick(custom)} className="rounded border border-border px-2 py-0.5 text-[11px] text-text-primary hover:bg-surface-2">
              Use
            </button>
          </label>
        )}
      </Menu>
    </div>
  );
}

const ALIGNS = [
  { command: "justifyLeft", label: "Align left", icon: AlignLeft },
  { command: "justifyCenter", label: "Centre", icon: AlignCenter },
  { command: "justifyRight", label: "Align right", icon: AlignRight },
  { command: "justifyFull", label: "Justify", icon: AlignJustify },
] as const;

export function AlignMenu({ current, open, onOpen, onClose, onPick }: { current: string; open: boolean; onOpen: () => void; onClose: () => void; onPick: (command: string) => void }) {
  const Now = (ALIGNS.find((a) => a.command === current) ?? ALIGNS[0]).icon;
  return (
    <Menu label="Alignment" open={open} onOpen={onOpen} onClose={onClose} width={150} wide={false} button={<Now size={14} />}>
      {ALIGNS.map((a) => (
        <button key={a.command} type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(a.command)} className={itemClass}>
          <a.icon size={14} className="shrink-0" /> {a.label}
          {current === a.command && <Check size={12} className="ml-auto" />}
        </button>
      ))}
    </Menu>
  );
}

/** Pick a size by pointing, as Outlook's Insert Table grid does. */
export function TableMenu({ open, onOpen, onClose, onPick, icon }: { open: boolean; onOpen: () => void; onClose: () => void; onPick: (rows: number, cols: number) => void; icon: React.ReactNode }) {
  const [at, setAt] = useState<[number, number]>([0, 0]);
  const N = 8;
  return (
    <Menu label="Insert table" open={open} onOpen={onOpen} onClose={onClose} width={170} wide={false} button={icon}>
      <div className="p-1.5" onMouseLeave={() => setAt([0, 0])}>
        <div className="grid grid-cols-8 gap-[3px]">
          {Array.from({ length: N * N }, (_, i) => {
            const r = Math.floor(i / N) + 1;
            const c = (i % N) + 1;
            const on = r <= at[0] && c <= at[1];
            return (
              <button
                key={i}
                type="button"
                aria-label={`${r} by ${c} table`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setAt([r, c])}
                onClick={() => onPick(r, c)}
                className={`size-[15px] rounded-[2px] border ${on ? "border-brand bg-brand" : "border-border bg-surface-1"}`}
              />
            );
          })}
        </div>
        <p className="mt-1.5 text-center text-[11px] text-text-secondary">{at[0] ? `${at[1]} × ${at[0]} table` : "Insert table"}</p>
      </div>
    </Menu>
  );
}

/** The address a link goes to, and the words it shows when nothing was selected. */
export function LinkMenu({
  open,
  onOpen,
  onClose,
  selectedText,
  initialHref,
  onApply,
  onRemove,
  icon,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  selectedText: string;
  initialHref: string;
  onApply: (href: string, text: string) => void;
  onRemove: (() => void) | null;
  icon: React.ReactNode;
}) {
  const [href, setHref] = useState(initialHref);
  const [text, setText] = useState("");
  useEffect(() => {
    if (open) {
      setHref(initialHref);
      setText("");
    }
  }, [open, initialHref]);
  const apply = () => {
    if (href.trim()) onApply(href.trim(), text.trim());
  };
  return (
    <Menu label="Link (Ctrl+K)" open={open} onOpen={onOpen} onClose={onClose} width={260} wide={false} button={icon}>
      <div className="space-y-2 p-1.5">
        <label className="block text-[11px] text-text-secondary">
          Address
          <input
            autoFocus
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                apply();
              }
            }}
            placeholder="https://… or name@company.com"
            className="mt-1 h-8 w-full text-[12px]"
          />
        </label>
        {!selectedText && (
          <label className="block text-[11px] text-text-secondary">
            Text to show
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  apply();
                }
              }}
              placeholder="The address itself"
              className="mt-1 h-8 w-full text-[12px]"
            />
          </label>
        )}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          {onRemove ? (
            <button type="button" onClick={onRemove} className="text-[12px] text-text-danger hover:underline">
              Remove link
            </button>
          ) : (
            <span />
          )}
          <button type="button" onClick={apply} className="h-7 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark">
            {onRemove ? "Update" : "Insert"}
          </button>
        </div>
      </div>
    </Menu>
  );
}
