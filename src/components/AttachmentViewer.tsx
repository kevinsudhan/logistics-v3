import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowDownToLine, Loader2, Minus, Plus, X } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { downloadBytes, kindOf, type ViewerFile } from "../lib/attachmentFiles";
import { useDialog } from "../lib/useDialog";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * An attachment shown inside the app, full screen: a PDF page by page, a
 * picture, or text — with Download and Close.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT A NEW TAB
 *
 * An attachment used to open in a new tab. In the installed app that meant
 * leaving it: a browser tab on a computer, a browser sheet on Android (which
 * does not draw PDFs at all, so it downloaded instead), and on an iPhone
 * Safari, which cannot reach a file held inside the app and showed a blank
 * page. Drawn here, it looks the same everywhere.
 *
 * PDFs are drawn with PDF.js (Firefox's reader) onto canvases, so a phone that
 * has no PDF viewer of its own still shows them. Pinned to the 4.x line: 5 and
 * later need a newer Node than the build uses, and newer phones than the desk has.
 * This module is loaded only when somebody opens an attachment.
 * ---------------------------------------------------------------------------
 */

export default function AttachmentViewer({
  name,
  load,
  onClose,
}: {
  /** Shown while the file is fetched. */
  name: string;
  /** Fetches the file; called once when the viewer opens. */
  load: () => Promise<ViewerFile>;
  onClose: () => void;
}) {
  const [file, setFile] = useState<ViewerFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState(0);

  useEffect(() => {
    let live = true;
    load()
      .then((f) => live && setFile(f))
      .catch((e) => live && setError(e instanceof Error ? e.message : "The file could not be opened."));
    return () => {
      live = false;
    };
    // `load` is a fresh closure every render of the caller; it is called once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab stays in the viewer, and focus goes back to the file that was opened.
  const panel = useRef<HTMLDivElement>(null);
  useDialog(panel, undefined, { escape: false });

  // Escape closes the viewer and nothing behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const kind = file ? kindOf(file) : null;
  const zoomable = kind === "pdf" || kind === "image";

  return (
    <div ref={panel} className="fixed inset-0 z-[60] flex flex-col bg-[#1c2230]" role="dialog" aria-modal="true" aria-label={`${name} — attachment`}>
      <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-white sm:px-4">
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium" title={name}>
          {name}
          {file && (
            <span className="ml-2 text-[11.5px] font-normal text-white/60">
              {size(file.bytes.byteLength)}
              {kind === "pdf" && pages ? ` · ${pages} page${pages === 1 ? "" : "s"}` : ""}
            </span>
          )}
        </p>
        {zoomable && (
          <div className="flex items-center gap-0.5 rounded-lg border border-white/15 p-0.5">
            <button type="button" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} className="grid size-7 place-items-center rounded-md hover:bg-white/10" aria-label="Zoom out" title="Zoom out">
              <Minus size={14} />
            </button>
            <button type="button" onClick={() => setZoom(1)} className="h-7 min-w-[46px] rounded-md px-1 text-[11.5px] tabular-nums hover:bg-white/10" title="Fit to width">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} className="grid size-7 place-items-center rounded-md hover:bg-white/10" aria-label="Zoom in" title="Zoom in">
              <Plus size={14} />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => file && downloadBytes(file)}
          disabled={!file}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-medium text-[#1c2230] hover:bg-white/90 disabled:opacity-50"
        >
          <ArrowDownToLine size={13} />
          <span className="hidden sm:inline">Download</span>
        </button>
        <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white" aria-label="Close" title="Close">
          <X size={18} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto overscroll-contain" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {error ? (
          <Centre>
            <AlertCircle size={20} className="text-red-300" />
            <p className="mt-2 max-w-sm text-[13px] text-white/85">{error}</p>
          </Centre>
        ) : !file ? (
          <Centre>
            <Loader2 size={20} className="animate-spin text-white/70" />
            <p className="mt-2 text-[12.5px] text-white/70">Opening {name}…</p>
          </Centre>
        ) : kind === "pdf" ? (
          <PdfPages bytes={file.bytes} zoom={zoom} onPages={setPages} onError={setError} />
        ) : kind === "image" ? (
          <ImageView file={file} zoom={zoom} />
        ) : kind === "text" ? (
          <pre className="mx-auto my-4 max-w-4xl whitespace-pre-wrap rounded-lg bg-white p-4 font-mono text-[12.5px] text-[#1c2230] sm:my-6">
            {new TextDecoder().decode(file.bytes)}
          </pre>
        ) : (
          <Centre>
            <p className="max-w-sm text-[13px] text-white/85">
              {name} can't be shown here. Download it to open it on this device.
            </p>
            <button type="button" onClick={() => downloadBytes(file)} className="mt-3 flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-medium text-[#1c2230]">
              <ArrowDownToLine size={13} /> Download
            </button>
          </Centre>
        )}
      </div>
    </div>
  );
}

function Centre({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center p-6 text-center">{children}</div>;
}

function ImageView({ file, zoom }: { file: ViewerFile; zoom: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: file.contentType || "image/png" }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  if (!url) return null;
  return (
    // Block and auto margins rather than a centring flexbox: zoomed wider than
    // the screen, a centred flex item is cut off on the left where no scroll
    // reaches it.
    <div className="p-3 sm:p-6">
      <img
        src={url}
        alt={file.name}
        style={{ maxWidth: zoom === 1 ? "100%" : "none", width: zoom === 1 ? undefined : `${zoom * 100}%` }}
        className="mx-auto block rounded bg-white shadow-lg"
      />
    </div>
  );
}

/**
 * Every page of a PDF, drawn at the width of the screen (times the zoom) and
 * at the screen's pixel density, so text is sharp on a phone as well.
 */
function PdfPages({ bytes, zoom, onPages, onError }: { bytes: Uint8Array; zoom: number; onPages: (n: number) => void; onError: (m: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let live = true;
    // A copy: PDF.js takes the buffer over to its worker, and the Download
    // button still needs the bytes afterwards.
    const task = pdfjs.getDocument({ data: bytes.slice() });
    task.promise
      .then((d) => {
        if (!live) return;
        setDoc(d);
        onPages(d.numPages);
      })
      .catch(() => live && onError("This PDF could not be read. Download it to open it on this device."));
    return () => {
      live = false;
      void task.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl px-2 py-3 sm:px-6 sm:py-6">
      {/* Measured inside the padding: the page is the width of what is left. */}
      <div ref={box} className="w-full">
      {doc && width > 0
        ? Array.from({ length: doc.numPages }, (_, i) => <PdfPage key={i} doc={doc} number={i + 1} width={Math.min(width, 1100) * zoom} />)
        : null}
      {!doc && (
        <div className="flex justify-center py-10">
          <Loader2 size={20} className="animate-spin text-white/70" />
        </div>
      )}
      </div>
    </div>
  );
}

function PdfPage({ doc, number, width }: { doc: pdfjs.PDFDocumentProxy; number: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  const draw = useCallback(async () => {
    const page = await doc.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const scale = width / base.width;
    const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
    const viewport = page.getViewport({ scale: scale * ratio });
    const c = canvas.current;
    if (!c) return null;
    c.width = Math.floor(viewport.width);
    c.height = Math.floor(viewport.height);
    c.style.width = `${Math.floor(viewport.width / ratio)}px`;
    c.style.height = `${Math.floor(viewport.height / ratio)}px`;
    setHeight(viewport.height / ratio);
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    return page.render({ canvasContext: ctx, viewport });
  }, [doc, number, width]);

  useEffect(() => {
    let task: pdfjs.RenderTask | null = null;
    let cancelled = false;
    void draw().then((t) => {
      if (cancelled) t?.cancel();
      else task = t;
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [draw]);

  return (
    <div className="mb-3 sm:mb-4" style={{ minHeight: height ?? width * 1.3 }}>
      {/* Block and auto margins, as for a picture: zoomed in, the page must scroll, not be cut off on the left. */}
      <canvas ref={canvas} className="mx-auto block max-w-none rounded-sm bg-white shadow-lg" aria-label={`Page ${number}`} />
    </div>
  );
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
