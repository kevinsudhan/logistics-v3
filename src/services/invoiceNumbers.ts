import { supabase } from "../lib/supabase";
import { readyToNumber } from "../lib/documents/invoice";
import type { DocumentData } from "../lib/documents/types";

/**
 * The tax invoice's number, ALG/26-27/0001 on, one per B/L (141).
 *
 * ---------------------------------------------------------------------------
 * Given by the database, never worked out here: two people printing invoices
 * for two jobs at the same moment must get two numbers, one after the other,
 * and a reprint of a B/L's invoice must get the number it already has. The
 * number is taken only when the invoice is otherwise complete, so a draft
 * looked at on Monday does not spend a number in the series on an invoice
 * that goes out on Friday — or never.
 * ---------------------------------------------------------------------------
 */

/** The number a B/L's tax invoice was given, if it has been given one. */
export async function issuedTaxInvoiceNumber(bl: string): Promise<string | null> {
  const key = bl.replace(/\s+/g, " ").trim().toUpperCase();
  if (!key) return null;
  const { data, error } = await supabase.from("tax_invoice_numbers").select("number").eq("bl_number", key).maybeSingle();
  if (error) throw error;
  return (data?.number as string | undefined) ?? null;
}

/** The B/L's number: the one it has, or the next in the series for the financial year of `isoDate`. */
export async function takeTaxInvoiceNumber(bl: string, isoDate: string): Promise<string> {
  const { data, error } = await supabase.rpc("tax_invoice_number", { p_bl: bl, p_date: isoDate });
  if (error) throw error;
  return data as string;
}

/**
 * The invoice as it is about to be made: with the number its B/L has, or —
 * nothing else outstanding — the next one, dated today. Unchanged when it is
 * already numbered or has no B/L to be numbered by.
 */
export async function numberedInvoice(d: DocumentData, isoDate: string): Promise<DocumentData> {
  if (d.invoice?.number || !d.blNumber) return d;
  const number = readyToNumber(d) ? await takeTaxInvoiceNumber(d.blNumber, isoDate) : await issuedTaxInvoiceNumber(d.blNumber);
  return number ? { ...d, invoice: { ...d.invoice, number } } : d;
}
