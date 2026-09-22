/**
 * The public surface: pick a document, give it a record, get a PDF.
 */
import { DOCUMENTS, documentSpec } from "./registry";
import {
  documentDataFromBooking,
  documentDataFromEnquiry,
  readiness,
} from "./data";
import { renderDocument } from "./render";
import { renderQuotationPdf, type QuotationPdfInput } from "./quotation";
import type { DocSpec, DocumentData } from "./types";

export {
  DOCUMENTS,
  documentSpec,
  readiness,
  documentDataFromBooking,
  documentDataFromEnquiry,
};
export type { DocSpec, DocumentData };
export type { DataKey } from "./types";

const filename = (spec: DocSpec, data: DocumentData) =>
  `ARX-${spec.numberPrefix}-${data.documentNumber}-${spec.id}.pdf`;

export function generateDocument(spec: DocSpec, data: DocumentData): void {
  renderDocument(spec, data).save(filename(spec, data));
}

/**
 * Opens the document to be read, rather than saving it to be filed.
 *
 * ---------------------------------------------------------------------------
 * READING AND KEEPING ARE DIFFERENT ACTS
 *
 * Downloading was the only thing on offer, so checking whether a B/L draft had
 * the right consignee meant putting a file in Downloads, opening it, reading
 * it, and then having a stale copy on the machine for ever. Most of the time
 * nobody wants the file at all — they want to look at it.
 *
 * The blob url is revoked on a timer rather than immediately: the new tab needs
 * it long enough to load, and there is no event here that fires when it has.
 * A minute is far longer than a PDF takes and short enough that a morning of
 * checking documents does not hold every one of them in memory.
 *
 * Returns false when the tab was blocked, so the caller can say so instead of
 * leaving somebody pressing a button that appears to do nothing.
 * ---------------------------------------------------------------------------
 */
export function viewDocument(spec: DocSpec, data: DocumentData): boolean {
  const url = renderDocument(spec, data).output("bloburl") as unknown as string;
  const tab = window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return Boolean(tab);
}

/** Readiness for every document against one record, for the UI list. */
export function documentStatuses(data: DocumentData) {
  return DOCUMENTS.map((spec) => ({ spec, ...readiness(data, spec.requires) }));
}

/**
 * The same PDF, as bytes to attach to a mail.
 *
 * ---------------------------------------------------------------------------
 * The third thing you can do with a generated document, after saving it and
 * opening it. It is the one that was missing, and its absence set the shape of
 * the working day: generate the quotation, find it in Downloads, switch to
 * Outlook, attach it, write the mail there — at which point the thread is in
 * Outlook, the CRM never sees the reply, and nothing it knows about this
 * enquiry includes the fact that a quotation went out.
 *
 * `arraybuffer` rather than the blob url `viewDocument` uses: nothing is being
 * shown, so there is no object url to hold open and revoke.
 * ---------------------------------------------------------------------------
 */
export function documentBytes(
  spec: DocSpec,
  data: DocumentData
): { name: string; contentType: string; bytes: Uint8Array } {
  const buffer = renderDocument(spec, data).output("arraybuffer") as ArrayBuffer;
  return {
    name: filename(spec, data),
    contentType: "application/pdf",
    bytes: new Uint8Array(buffer),
  };
}

export { renderQuotationPdf, type QuotationPdfInput } from "./quotation";

/**
 * The quotation as a file, ready to attach or save.
 *
 * Its own path rather than going through `documentBytes`, because the
 * quotation is not built from the registry's label-and-value sections — it is a
 * rate table, and it needs the charge lines and the terms that the generic
 * `DocumentData` bag does not carry.
 */
export function quotationFile(input: QuotationPdfInput): {
  name: string;
  contentType: string;
  bytes: Uint8Array;
} {
  const version = input.quote.version > 1 ? `-v${input.quote.version}` : "";
  return {
    name: `Quotation-${input.enquiry.ref}${version}.pdf`,
    contentType: "application/pdf",
    bytes: new Uint8Array(renderQuotationPdf(input).output("arraybuffer") as ArrayBuffer),
  };
}
