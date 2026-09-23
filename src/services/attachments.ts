import { supabase } from "../lib/supabase";
import { base64ToBytes, bytesToBase64 } from "../lib/base64";
import { getAttachmentBytes, type OutgoingAttachment } from "./graphMail";

/**
 * The files an enquiry keeps.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BYTES ARE COPIED
 *
 * A Graph attachment id resolves only against the mailbox that holds the
 * message, using that person's token. Filing the id would file the shipper's
 * MSDS against the enquiry in a way that works for exactly one member of staff
 * — the one who already had it — and stops working the day they leave. So the
 * file is copied into the CRM's own bucket and stops belonging to a mailbox.
 *
 * WHY THE PATH IS UNIQUIFIED AND THE NAME IS NOT
 *
 * Two mails three weeks apart both attaching "invoice.pdf" are two different
 * invoices. Storage would treat the second as a replacement for the first, so
 * the path carries a timestamp while the name shown is what the sender called
 * it — which is what somebody is looking for when they scan the list.
 * ---------------------------------------------------------------------------
 */

const BUCKET = "enquiry-files";

export interface EnquiryFile {
  id: string;
  enquiry_ref: string;
  name: string;
  content_type: string;
  size_bytes: number | null;
  path: string;
  source: "mail" | "upload" | "generated";
  message_id: string | null;
  subject: string | null;
  filed_by: string | null;
  filed_at: string;
  /** What the file is — "Packing list", "HAWB" (065). */
  document_type: string | null;
  /** The number printed on it: the invoice number, the B/L number. */
  reference_number: string | null;
  /** Only an admin can delete it or take this off. */
  protected: boolean;
}

/** The kinds of paper a job collects, in roughly the order it collects them. */
export const DOCUMENT_TYPES = [
  "Commercial invoice",
  "Packing list",
  "Purchase order",
  "MSDS",
  "DG declaration",
  "Shipping bill",
  "Customs declaration",
  "VGM",
  "Certificate of origin",
  "Insurance certificate",
  "Booking confirmation",
  "HAWB",
  "MAWB",
  "House B/L",
  "Master B/L",
  "Delivery order",
  "Proof of delivery",
  "Other",
];

/** Everything filed against one enquiry, newest first. */
export async function listFiles(ref: string): Promise<EnquiryFile[]> {
  const { data, error } = await supabase
    .from("enquiry_files")
    .select("*")
    .eq("enquiry_ref", ref.toUpperCase())
    .order("filed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EnquiryFile[];
}

/**
 * Save an attachment off a message onto the enquiry.
 *
 * Returns null when this exact attachment is already filed against this
 * enquiry — the unique index in 049 catches it, because nothing on the message
 * tells somebody they already pressed save. That is a no-op worth reporting
 * calmly rather than an error worth showing.
 */
export async function fileMailAttachment(input: {
  enquiryRef: string;
  messageId: string;
  attachmentId: string;
  subject?: string | null;
}): Promise<EnquiryFile | null> {
  const ref = input.enquiryRef.toUpperCase();
  const a = await getAttachmentBytes(input.messageId, input.attachmentId);

  const path = `${ref}/${Date.now()}-${safeName(a.name)}`;
  const { error: up } = await supabase.storage
    .from(BUCKET)
    .upload(path, base64ToBytes(a.contentBytes), {
      contentType: a.contentType || "application/octet-stream",
      upsert: false,
    });
  if (up) throw up;

  const { data, error } = await supabase
    .from("enquiry_files")
    .insert({
      enquiry_ref: ref,
      name: a.name,
      content_type: a.contentType || "application/octet-stream",
      size_bytes: a.size,
      path,
      source: "mail",
      message_id: input.messageId,
      subject: input.subject ?? null,
      filed_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    })
    .select()
    .single();

  if (error) {
    // Already filed. Take the orphaned copy back out rather than leaving bytes
    // in the bucket that no row points at.
    await supabase.storage.from(BUCKET).remove([path]);
    if (error.code === "23505") return null;
    throw error;
  }
  return data as EnquiryFile;
}

/**
 * A file somebody chose from their computer, filed against the job.
 *
 * The same bucket and table as mail attachments and generated documents, so
 * the enquiry and the shipment see one set of files.
 */
export async function uploadFile(input: {
  enquiryRef: string;
  file: File;
  documentType: string;
  referenceNumber?: string | null;
  protected?: boolean;
}): Promise<EnquiryFile> {
  const ref = input.enquiryRef.toUpperCase();
  const path = `${ref}/${Date.now()}-${safeName(input.file.name)}`;
  const contentType = input.file.type || "application/octet-stream";

  const { error: up } = await supabase.storage
    .from(BUCKET)
    .upload(path, input.file, { contentType, upsert: false });
  if (up) throw up;

  const { data, error } = await supabase
    .from("enquiry_files")
    .insert({
      enquiry_ref: ref,
      name: input.file.name,
      content_type: contentType,
      size_bytes: input.file.size,
      path,
      source: "upload",
      document_type: input.documentType,
      reference_number: input.referenceNumber?.trim() || null,
      protected: input.protected ?? false,
      filed_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    })
    .select()
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }
  return data as EnquiryFile;
}

/** Correct what a filed file is, or protect it. */
export async function updateFileMeta(
  id: string,
  patch: Partial<Pick<EnquiryFile, "document_type" | "reference_number" | "protected">>
): Promise<void> {
  const { error } = await supabase.from("enquiry_files").update(patch).eq("id", id);
  if (error) throw error;
}

/** A file this CRM produced, kept alongside the ones that arrived. */
export async function fileGeneratedDocument(input: {
  enquiryRef: string;
  name: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<EnquiryFile> {
  const ref = input.enquiryRef.toUpperCase();
  const path = `${ref}/${Date.now()}-${safeName(input.name)}`;

  const { error: up } = await supabase.storage
    .from(BUCKET)
    .upload(path, input.bytes, { contentType: input.contentType, upsert: false });
  if (up) throw up;

  const { data, error } = await supabase
    .from("enquiry_files")
    .insert({
      enquiry_ref: ref,
      name: input.name,
      content_type: input.contentType,
      size_bytes: input.bytes.byteLength,
      path,
      source: "generated",
      filed_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    })
    .select()
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }
  return data as EnquiryFile;
}

/**
 * A link to read the file with.
 *
 * Signed and short-lived because the bucket is private: these are customer
 * commercial documents, and a url that keeps working after the tab is closed
 * is one that gets pasted into a chat and outlives the reason it was made.
 */
export async function fileUrl(path: string, seconds = 300): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error) throw error;
  return data.signedUrl;
}

/** Take a file back off an enquiry — the row first, then the bytes. */
export async function removeFile(file: EnquiryFile): Promise<void> {
  // `.select()` so a delete the rules refused (a protected file, somebody
  // else's upload) is reported rather than looking like it worked.
  const { data, error } = await supabase
    .from("enquiry_files")
    .delete()
    .eq("id", file.id)
    .select("id");
  if (error) throw error;
  if (!data?.length) {
    throw new Error(
      file.protected
        ? "This file is protected. Only an admin can delete it."
        : "Only the person who filed this, or an admin, can delete it."
    );
  }
  // Order matters: a failed delete here leaves bytes nothing points at, which
  // is wasteful. The other order leaves a row pointing at nothing, which is a
  // broken link on the screen.
  await supabase.storage.from(BUCKET).remove([file.path]);
}

/** A filed file, ready to go back out on a mail. */
export async function asOutgoing(file: EnquiryFile): Promise<OutgoingAttachment> {
  const { data, error } = await supabase.storage.from(BUCKET).download(file.path);
  if (error) throw error;
  return {
    name: file.name,
    contentType: file.content_type,
    contentBytes: bytesToBase64(new Uint8Array(await data.arrayBuffer())),
  };
}

/**
 * A filename safe to put in a storage path.
 *
 * Supabase storage keys allow a limited set, and a shipper's attachment is
 * routinely called something like "PL & INV (final) — Müller.pdf". The display
 * name keeps all of that; only the path is flattened.
 */
function safeName(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[^\w.\-]+/g, "_")
      .replace(/_+/g, "_")
      .slice(-120) || "file"
  );
}
