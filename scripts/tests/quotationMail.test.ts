import { brandImages, imageType, withContentIds } from "../../src/lib/inlineBrand";
import { quotationHtml, quotationSubject } from "../../src/lib/quotationMail";
import { confirmationHtml, confirmationMessage, confirmationSubject } from "../../src/lib/confirmationMail";
import type { Customer, Enquiry, Quote } from "../../src/services/enquiries";
import type { QuoteLine } from "../../src/services/quoteLines";

/**
 * The quotation mail, and the logo it carries inside the message.
 *
 * A customer reads this before anyone at the desk sees it again, so the
 * checks are on what reaches them: the logo sent as part of the mail rather
 * than a link Outlook blocks, nothing printed that the job does not hold, and
 * no markup of ours leaking into the message.
 */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const ORIGIN = "https://logisticsdemosif.netlify.app";

console.log("\nthe logo, found in a body");
const body = `<p>Hi</p><img src="${ORIGIN}/brand/aashish-logo-email.jpg" width="300" alt="x"><img src="https://cdn.example.com/brand/x.png"><img src="${ORIGIN}/other/y.png"><img src='/brand/mark.png'><img src="${ORIGIN}/brand/aashish-logo-email.jpg">`;
const found = brandImages(body, ORIGIN);
is("our /brand/ images, each once", found.map((f) => f.file), ["aashish-logo-email.jpg", "mark.png"]);
is("another origin is left alone", found.some((f) => f.src.includes("cdn.example.com")), false);
is("a content id per file", found[0].contentId, "aashish-logo-email.jpg@aashish-logistics");
const swapped = withContentIds(body, found);
is("every use swapped for its cid", swapped.split('src="cid:aashish-logo-email.jpg@aashish-logistics"').length - 1, 2);
is("single quotes too", swapped.includes("src='cid:mark.png@aashish-logistics'"), true);
is("the rest untouched", swapped.includes("https://cdn.example.com/brand/x.png") && swapped.includes(`${ORIGIN}/other/y.png`), true);
is("nothing found, nothing changed", withContentIds("<p>x</p>", []), "<p>x</p>");
is("types", [imageType("a.jpg"), imageType("a.PNG"), imageType("a.gif")], ["image/jpeg", "image/png", "image/gif"]);
is("a name with odd characters is not ours", brandImages(`<img src="${ORIGIN}/brand/../secret.png">`, ORIGIN).length, 0);

console.log("\nthe mail");
const enquiry = {
  ref: "ALG09005-26",
  origin: "Chennai (MAA)",
  destination: "Frankfurt (FRA)",
  cargo: "Lithium-ion battery packs <for solar>",
  ready_date: "2026-10-02",
  transport_mode: "air",
  incoterm: "fca",
  package_count: 12,
  package_type: "cartons",
  piece_count: null,
  gross_weight_kg: 480,
  volume_cbm: 1.44,
} as unknown as Enquiry;
const customer = { name: "Kevin Sudhan", company: "kevin imports" } as unknown as Customer;
const quote = { version: 1, created_at: "2026-09-23T06:00:00Z", valid_until: "2026-09-30", amount_inr: 185000 } as unknown as Quote;
const line = { description: "Air freight", unit: "kg", quantity: 480, currency: "USD", rate: 4.1, amount_inr: 165000 } as unknown as QuoteLine;
const base = { enquiry, customer, quote, lines: [line], terms: [], fromName: "Aarathy" };

const html = quotationHtml({ ...base, logoSrc: `${ORIGIN}/brand/aashish-logo-email.jpg`, acceptUrl: "https://x/q/abc" });
is("the logo, sized for Outlook by its width", html.includes(`<img src="${ORIGIN}/brand/aashish-logo-email.jpg" width="300" alt="Aashish Logistics Global Pvt Ltd"`), true);
is("the send will find it", brandImages(html, ORIGIN).length, 1);
is("no logo address: the name set in type", quotationHtml(base).includes("AASHISH LOGISTICS GLOBAL") && !quotationHtml(base).includes("<img"), true);
is("reference, date and validity", ["ALG09005-26", "23 Sep 2026", "30 Sep 2026"].every((t) => html.includes(t)), true);
is("prepared for the company, attention the person", html.includes("kevin imports") && html.includes("Attn: Kevin Sudhan"), true);
is("the route", html.includes("Chennai (MAA)") && html.includes("Frankfurt (FRA)"), true);
is("mode and incoterm in words", html.includes("Air freight") && html.includes("FCA"), true);
is("packages, weight and volume", html.includes("12 cartons · 480 kg · 1.44 CBM"), true);
is("markup in the cargo is escaped", html.includes("&lt;for solar&gt;"), true);
is("each charge with its unit", html.includes("per kg") && html.includes("480 &times; USD&nbsp;4.1"), true);
is("the total", html.includes("₹1,85,000"), true);
is("accept only with a link", [html.includes("Accept this quotation"), quotationHtml(base).includes("Accept this quotation")], [true, false]);
is("signed by the sender", html.includes("Aarathy"), true);
is("the registered details in the footer", html.includes("GSTIN 33ABDCA2229C1ZD") && html.includes("Anna Nagar"), true);
is("no comments of ours in the customer's mail", html.includes("<!--"), false);
const bare = quotationHtml({ ...base, lines: [], enquiry: { ...enquiry, package_count: null, gross_weight_kg: null, volume_cbm: null, incoterm: null } as unknown as Enquiry });
is("no charges: says so", bare.includes("Charges as discussed."), true);
is("an unknown fact is not a line", bare.includes("Packages &amp; weight") || bare.includes(">Incoterm<"), false);
is("subject keeps the reference", quotationSubject({ enquiry, quote }), "Quotation ALG09005-26 · Chennai (MAA) – Frankfurt (FRA)");

console.log("\nthe booking confirmation, on the same letterhead");
const full = {
  ...enquiry,
  piece_count: 12,
  piece_length_cm: 60,
  piece_width_cm: 40,
  piece_height_cm: 50,
  pickup_required: true,
  pickup_location: "Plot 14, SIPCOT",
  delivery_required: false,
  delivery_location: "Should not show",
  consignee_name: "Hofmann GmbH",
  consignee_country: "Germany",
  customer_reference: "PO-7781",
  special_handling: "Keep upright",
} as unknown as Enquiry;
const accepted = { ...quote, basis: "Per kg, all in, ex Chennai", sailing_date: "2026-10-04" } as unknown as Quote;
const conf = confirmationHtml({ enquiry: full, customer, quote: accepted, fromName: "Aarathy", logoSrc: `${ORIGIN}/brand/aashish-logo-email.jpg`, date: new Date(2026, 8, 24) });
is("the same logo, carried the same way", brandImages(conf, ORIGIN).length, 1);
is("titled and dated", conf.includes(">BOOKING CONFIRMATION<") && conf.includes("24 Sep 2026"), true);
is("a long title steps down a size", conf.includes('font-size:19px;font-weight:800;letter-spacing:.16em;">BOOKING CONFIRMATION'), true);
is("the customer's own reference in the header, once", conf.split("PO-7781").length - 1, 1);
is("greeting by name", conf.includes("Dear Kevin Sudhan,"), true);
is("pieces with their size", conf.includes("12 at 60 × 40 × 50 cm"), true);
is("collection, because it is required", conf.includes("Plot 14, SIPCOT"), true);
is("delivery not required, so not a line", conf.includes("Should not show"), false);
is("consignee, special handling, sailing", ["Hofmann GmbH, Germany", "Keep upright", "04 Oct 2026"].every((t) => conf.includes(t)), true);
is("the rate agreed, set apart, with its basis", conf.includes("Rate agreed") && conf.includes("₹1,85,000") && conf.includes("Per kg, all in, ex Chennai"), true);
is("what happens next", conf.includes("What happens next") && conf.includes("please reply to confirm"), true);
is("the reference to keep in replies", conf.includes("Please keep <strong"), true);
is("the registered details in the footer", conf.includes("GSTIN 33ABDCA2229C1ZD"), true);
is("no accepted quote: no rate block", confirmationHtml({ enquiry: full, customer, quote: null }).includes("Rate agreed"), false);
is("no name: a proper greeting", confirmationMessage({ customer: null }).startsWith("Dear Sir or Madam,"), true);
is("the subject keeps the reference in brackets", confirmationSubject(full), "[ALG09005-26] Booking confirmation — Chennai (MAA) to Frankfurt (FRA)");
is("no comments of ours in it either", conf.includes("<!--"), false);

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
