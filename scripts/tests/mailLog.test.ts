import { domainOf, mailKind, recipientsText, refInSubject } from "../../src/lib/mailLog";
import { confirmationSubject } from "../../src/lib/confirmationMail";
import { preAlertSubject } from "../../src/lib/preAlertMail";
import { movementOrderSubject, shipmentUpdateSubject } from "../../src/lib/shipmentUpdateMail";
import { trackingMailSubject } from "../../src/lib/trackingLinkMail";

/**
 * Reading a sent mail back from its subject (086): what kind it was, and which
 * job it was about — against the subjects the CRM itself writes.
 */

let pass = 0,
  fail = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${label}${
      ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`
    }`
  );
  ok ? pass++ : fail++;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const ref = "ALG09004-26";
const confirmation = confirmationSubject({ ref, origin: "Chennai", destination: "Jebel Ali" } as any);
const preAlert = preAlertSubject({ ref, mode: "sea_fcl", houseBill: "HBL/26-27/0001", masterBill: "MSKU7654321", vessel: "MSC AURORA", voyage: "FA412E", flightNumber: null, etd: "2026-10-02", etdTime: null, portOfLoading: "Chennai (INMAA)", portOfDischarge: "Jebel Ali (AEJEA)" } as any);
const update = shipmentUpdateSubject({ ref, origin: "Chennai", destination: "Jebel Ali" });
const tracking = trackingMailSubject({ ref, origin: "Chennai", destination: "Jebel Ali" });
const pickup = movementOrderSubject({ kind: "pickup", ref, date: "2026-10-01" } as any);

console.log("\nthe CRM's own subjects");
is("booking confirmation", [mailKind(confirmation), refInSubject(confirmation)], ["confirmation", ref]);
is("pre-alert", [mailKind(preAlert), refInSubject(preAlert)], ["pre_alert", ref]);
is("shipment update", [mailKind(update), refInSubject(update)], ["update", ref]);
is("tracking link", [mailKind(tracking), refInSubject(tracking)], ["tracking", ref]);
is("pickup request", [mailKind(pickup), refInSubject(pickup)], ["transport", ref]);
is("delivery request", mailKind("[ALG09004-26] Delivery request — 4 Oct 2026"), "transport");
is("a quotation has no brackets but still finds its job", [mailKind("Quotation ALG09004-26 · Chennai → Jebel Ali"), refInSubject("Quotation ALG09004-26 · Chennai → Jebel Ali")], ["quotation", ref]);
is("a rate request to partners", [mailKind("Rate request from Parasu"), refInSubject("[PALG09003-26] Rate request from Parasu")], ["rfq", "PALG09003-26"]);

console.log("\nmail written in Outlook");
is("a reply is a reply, even to a quotation", mailKind("RE: Quotation ALG09004-26"), "reply");
is("and keeps its job", refInSubject("RE: Quotation ALG09004-26"), ref);
is("a forward", mailKind("FW: [ALG09004-26] Booking confirmation"), "forward");
is("a German reply prefix", mailKind("AW: Anfrage"), "reply");
is("anything else", [mailKind("Container availability next week"), refInSubject("Container availability next week")], ["other", null]);
is("no subject", [mailKind(null), refInSubject(undefined)], ["other", null]);
is("PALG is not read as ALG", refInSubject("[PALG09003-26] Rate request"), "PALG09003-26");
is("lower case is still a reference", refInSubject("re: quotation alg09004-26"), ref);

console.log("\nwho it went to");
is("a domain", domainOf("Ops@GFP.ae"), "gfp.ae");
is("two named, and the rest counted", recipientsText([{ name: "Omar", address: "ops@gfp.ae" }, { name: "", address: "docs@gfp.ae" }, { name: "Wei", address: "wei@pcs.sg" }]), "Omar <ops@gfp.ae>, docs@gfp.ae +1");
is("a name that is only the address", recipientsText([{ name: "ops@gfp.ae", address: "ops@gfp.ae" }]), "ops@gfp.ae");
is("nobody", recipientsText([]), "");

console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
