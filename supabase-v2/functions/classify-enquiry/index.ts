/**
 * Reads an email and proposes what it is.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DECIDES, AND WHAT IT DOES NOT
 *
 * It answers one question — is this an enquiry — and pulls out the fields the
 * intake queue already has slots for. It writes nothing. The row it describes
 * is created only when somebody presses the button in the CRM, under the same
 * RPCs and the same guards as a row typed by hand.
 *
 * That is deliberate and it is the whole safety argument. A model that files
 * enquiries directly would allocate a permanent reference off a guess, and
 * references are never deleted because the correspondence attached to them is
 * the record of what a customer was told. So this proposes; a person confirms.
 *
 * WHY IT RUNS HERE INSTEAD OF IN THE BROWSER
 *
 * The Gemini key. A key in a browser bundle is a key anyone can read and spend,
 * and this one is attached to a card. It never leaves this function.
 *
 * THIS RUNS ON GEMINI'S FREE TIER, AGAINST LIVE CUSTOMER MAIL
 *
 * A deliberate choice, recorded here because it is not visible from the code.
 *
 * Google's unpaid tier uses submitted content "to provide, improve, and develop
 * Google products", and human reviewers may see it. India is not covered by the
 * EEA/UK/Swiss carve-out that applies the paid terms to free usage. What passes
 * through here is real: rate cards, quotations, and the names, addresses and
 * phone numbers of customers who have not been asked about it — which under the
 * DPDP Act makes Aashish Logistics the data fiduciary for that transfer.
 *
 * Enabling billing on the Google project flips those terms on its own — no code
 * change, no key change, nothing here to edit. At this volume it is a few
 * hundred rupees a month. If nobody has revisited this, revisit it.
 *
 * The function cannot tell which tier the key is on; that is a property of the
 * Google project, not of the request. This comment is the only check there is.
 * ---------------------------------------------------------------------------
 */

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");

/**
 * Overridable because Google retires models faster than this repo changes.
 * 2.5 Flash-Lite retires on 16 October 2026; do not pin to it.
 */
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.1-flash-lite";
/** Tried in order when MODEL is busy or out of free quota. Comma-separated to override. */
const FALLBACK_MODELS = (Deno.env.get("GEMINI_FALLBACK_MODELS") ?? "gemini-3.5-flash-lite,gemini-2.5-flash")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * CORS, and the headers it is easy to forget.
 *
 * supabase-js does not send only Authorization: every call from the browser
 * also carries `apikey` and `x-client-info`. A preflight that allows less than
 * what the browser is about to send is refused by the browser, the request
 * never leaves the tab, and what surfaces is "Failed to send a request to the
 * Edge Function" — which reads like the function is down when it has not been
 * reached at all.
 *
 * The requested headers are reflected rather than listed, so the day the client
 * adds another one this does not have to be debugged a second time. The static
 * list is the fallback for a request that names none.
 */
function cors(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      req.headers.get("Access-Control-Request-Headers") ??
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

let CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/**
 * The shape of an answer.
 *
 * Given to Gemini as a response schema rather than asked for in the prompt,
 * because a prompt asking for JSON gets JSON most of the time, and the times it
 * does not are a parse error in front of somebody trying to file an enquiry.
 * Every field is nullable: a message that does not name a destination should
 * come back with no destination, not an invented one.
 */
const SCHEMA = {
  type: "object",
  properties: {
    is_enquiry: {
      type: "boolean",
      description:
        "True only if the sender is asking about moving cargo, requesting a rate, or following up on one. Replies, invoices, circulars, newsletters and internal mail are not enquiries.",
    },
    confidence: { type: "number", description: "0 to 1." },
    reason: { type: "string", description: "One short sentence. Why it is or is not an enquiry." },
    reference: {
      type: "string",
      nullable: true,
      description:
        "Any enquiry, booking or job reference the message already carries — ENQ NO, ENQUIRY NO, job number — copied exactly as written. Null if there is none. Never invent one.",
    },
    contact_name: { type: "string", nullable: true },
    company: { type: "string", nullable: true },
    email: { type: "string", nullable: true },
    phone: { type: "string", nullable: true },
    origin: { type: "string", nullable: true, description: "Port or city of loading." },
    destination: { type: "string", nullable: true, description: "Port or city of discharge." },
    cargo: { type: "string", nullable: true, description: "What is being shipped, and how much." },
    summary: { type: "string", description: "One or two sentences a colleague could act on." },

    // ---- what a consol agent asks for --------------------------------------
    //
    // A co-loader quotes on these, and until now the answers arrived in a mail
    // and stayed there. The schema is what the model is ALLOWED to return: a
    // field absent here is one it cannot give however plainly the sender wrote
    // it, which is why adding them to the CRM's own catalogue was not enough.
    //
    // Every one is nullable and the prompt says to return nulls freely. These
    // are facts a carrier acts on — a wrong IMO class is a refused booking, a
    // wrong cut-off is cargo that misses the boat — so a gap is wanted over a
    // guess, and nothing here is written without somebody pressing apply.
    // How it travels. Worth the model's attention because the chargeable
    // weight is computed from it: air converts at six times the sea ratio, so
    // a mode read wrong is a quotation wrong by a factor of six. Which is also
    // why the description refuses the obvious inference — a rate request to a
    // seaport is not somebody saying "by sea".
    // ---------------------------------------------------------------------
    // The cargo itself.
    //
    // These were missing, and their absence was the reason a details panel sat
    // empty in front of a mail that described the consignment completely: a
    // field the schema does not name is one the model cannot return however
    // plainly the shipper wrote it. `origin`, `destination` and `cargo` were
    // here; everything that makes them quotable was not.
    // ---------------------------------------------------------------------
    incoterm: {
      type: "string",
      nullable: true,
      description:
        "Three-letter Incoterm as written: EXW, FOB, CIF, DAP, DDP. Only if stated; never inferred from who is arranging the freight.",
    },
    ready_date: {
      type: "string",
      nullable: true,
      description:
        "YYYY-MM-DD. When the cargo is ready for collection or delivery into the CFS. NOT the sailing date and NOT a cut-off.",
    },
    pickup_location: {
      type: "string",
      nullable: true,
      description:
        "Where cargo is collected FROM, if a pickup is asked for. Different from the CFS it is delivered into.",
    },
    piece_count: {
      type: "integer",
      nullable: true,
      description:
        "How many pieces the dimensions below describe, e.g. 10 for '10 cases of 100x120x130'. May equal the package count; may not.",
    },
    piece_length_cm: {
      type: "number",
      nullable: true,
      description:
        "Length of ONE piece in centimetres. Convert from inches (x2.54) or metres (x100) and never from a total. Only when all the cargo is ONE size; with several sizes leave this and the other single-piece fields null and use dimension_lines.",
    },
    piece_width_cm: {
      type: "number",
      nullable: true,
      description: "Width of ONE piece in centimetres.",
    },
    piece_height_cm: {
      type: "number",
      nullable: true,
      description: "Height of ONE piece in centimetres.",
    },
    weight_per_piece_kg: {
      type: "number",
      nullable: true,
      description:
        "Weight of ONE piece in kilograms, only where stated per piece. A single total weight is gross_weight_kg.",
    },
    gross_weight_kg: {
      type: "number",
      nullable: true,
      description:
        "TOTAL gross weight of the consignment in kilograms, including packaging. An unqualified weight is this one. Convert from tonnes (x1000) or pounds (x0.4536).",
    },
    volume_cbm: {
      type: "number",
      nullable: true,
      description:
        "Total volume in cubic metres, only where the sender states it. Do NOT calculate it from the dimensions — the application does that.",
    },
    // Every size, not just one. The single-piece fields above can only hold
    // one, so "12 cartons of 60x40x50 and 2 crates of 120x80x90" either lost a
    // size or — worse — averaged them. One entry per distinct size here, and
    // the application sums them (063).
    dimension_lines: {
      type: "array",
      nullable: true,
      description:
        "One entry per DISTINCT piece size in the whole message or thread, e.g. '12 cartons 60x40x50 cm, 18 kg each' and '2 crates 120x80x90 cm, 140 kg each' are two entries. The same size mentioned twice is one entry; if a later message corrects a size, give only the corrected one. Convert to centimetres and kilograms. Null or empty when no dimensions are given.",
      items: {
        type: "object",
        properties: {
          pieces: { type: "integer", nullable: true, description: "How many pieces of THIS size." },
          length_cm: { type: "number", nullable: true },
          width_cm: { type: "number", nullable: true },
          height_cm: { type: "number", nullable: true },
          weight_per_piece_kg: {
            type: "number",
            nullable: true,
            description: "Weight of ONE piece of this size, only where stated per piece.",
          },
          gross_weight_kg: {
            type: "number",
            nullable: true,
            description:
              "Total weight of all pieces of THIS size, only where stated for this size. Never the consignment total when there is more than one size.",
          },
        },
      },
    },
    consignee_name: {
      type: "string",
      nullable: true,
      description: "The receiver's company name, as it should appear on the bill of lading.",
    },
    consignee_country: {
      type: "string",
      nullable: true,
      description: "The consignee's country, where it is given or unambiguous from their address.",
    },
    stackable: {
      type: "boolean",
      nullable: true,
      description:
        "True or false only where the sender says so, e.g. 'non-stackable' or 'do not stack'. Null when unmentioned.",
    },
    transport_mode: {
      type: "string",
      nullable: true,
      enum: ["sea_lcl", "sea_fcl", "air", "road"],
      description:
        "Only where the sender says so: 'LCL', 'full container', 'we need an air quote', 'by road'. A port of loading is NOT a mode. Null unless stated.",
    },
    // ---------------------------------------------------------------------
    // What the job includes — the Service details panel (061) and the cargo
    // questions (063). Without these in the schema the desk typed them by hand
    // from a mail that stated them plainly.
    // ---------------------------------------------------------------------
    trade_direction: {
      type: "string",
      nullable: true,
      enum: ["export", "import", "cross_trade"],
      description:
        "Seen from India, where this desk is. 'export' when the cargo leaves India, 'import' when it arrives in India, 'cross_trade' when neither end is in India. Only when the sender says so or both ends of the route are named; null otherwise.",
    },
    pickup_required: {
      type: "boolean",
      nullable: true,
      description:
        "True when the sender asks us to collect the cargo from them ('arrange pickup', 'door pickup', 'collect from our factory'). False when they say they will deliver it to the port, airport or CFS themselves. Null when unmentioned — never inferred from the Incoterm.",
    },
    delivery_required: {
      type: "boolean",
      nullable: true,
      description:
        "True when the sender asks for delivery to a door at destination ('door delivery', 'deliver to the consignee's warehouse'). False when they ask for port-to-port or airport-to-airport. Null when unmentioned — a consignee address alone is NOT a delivery request, and never inferred from the Incoterm.",
    },
    delivery_location: {
      type: "string",
      nullable: true,
      description: "Where to deliver at destination, only when a door delivery is asked for.",
    },
    customer_reference: {
      type: "string",
      nullable: true,
      description:
        "The sender's OWN reference for this shipment — their PO number, order number or 'our ref' — copied exactly. Not an enquiry number this desk issued, and not an invoice number of ours.",
    },
    expected_delivery_date: {
      type: "string",
      nullable: true,
      description:
        "YYYY-MM-DD. When the cargo must reach, or is expected at, destination ('needs to reach Frankfurt by 12 Oct'). NOT the ready date and NOT a quote deadline such as 'send the quote by tomorrow'.",
    },
    transit_days: {
      type: "integer",
      nullable: true,
      description:
        "The transit time the sender asks for, in whole days ('within 5 days', 'two weeks' = 14). Null unless a transit time is actually stated.",
    },
    hazardous: {
      type: "boolean",
      nullable: true,
      description:
        "True ONLY when the sender writes that the cargo is dangerous goods / hazardous / DG, or gives a UN number or IMO class. False only when they write non-hazardous, non-DG or general cargo. Otherwise null — including for goods that are often dangerous, such as batteries, paint, perfume or chemicals. The desk confirms that with the shipper; a guess here puts DG paperwork on a job, or leaves it off one.",
    },
    // The party block and the packing list. These have been on `shipments`
    // since 028 and on the CRM's field catalogue for as long, but were never
    // in this schema — so the details panel offered them, the operator saw
    // them blank, and no reading could ever fill one however plainly the
    // shipper had written it.
    consignee_address: {
      type: "string",
      nullable: true,
      description:
        "The consignee's full address as it should print on the bill of lading. Copy as written, including the country line.",
    },
    package_count: {
      type: "integer",
      nullable: true,
      description:
        "How many packages the B/L declares, e.g. 42 for '42 cartons'. NOT the piece count used for stowage dimensions if the mail distinguishes them.",
    },
    package_type: {
      type: "string",
      nullable: true,
      description: "What the packages are: cartons, pallets, drums, crates, bales.",
    },
    hs_code: {
      type: "string",
      nullable: true,
      description:
        "The HS / tariff code, digits only with any dots kept as written. Only if quoted; never inferred from the cargo description.",
    },
    net_weight_kg: {
      type: "number",
      nullable: true,
      description:
        "Net weight in kilograms, excluding packaging. Only when stated as net; a single unqualified weight is the GROSS weight, not this.",
    },
    msds_provided: {
      type: "boolean",
      nullable: true,
      description:
        "True only where the MSDS has actually been sent or attached. A promise to send one is not true.",
    },
    cfs_location: {
      type: "string",
      nullable: true,
      description:
        "Where cargo is delivered to be consolidated. NOT the pickup address: a shipper in Tirupur usually delivers into a Chennai CFS. Only if a place is actually named.",
    },
    cargo_cutoff: {
      type: "string",
      nullable: true,
      description:
        "YYYY-MM-DD. Last date the consol agent accepts cargo. Never inferred from the sailing date.",
    },
    si_cutoff: {
      type: "string",
      nullable: true,
      description: "YYYY-MM-DD. Last date for shipping instructions, only if stated as such.",
    },
    marks_and_numbers: {
      type: "string",
      nullable: true,
      description:
        "What is stencilled on the packages, printed as-is on the bill of lading. Often literally 'NIL'. Copy what was written; do not tidy it.",
    },
    freight_terms: {
      type: "string",
      nullable: true,
      enum: ["prepaid", "collect"],
      description:
        "Who pays the carrier. Do NOT derive it from the incoterm — EXW cargo is frequently shipped prepaid by arrangement.",
    },
    notify_name: {
      type: "string",
      nullable: true,
      description:
        "Who is told on arrival. Often the consignee and often not, commonly the buyer's customs broker. Only if named separately.",
    },
    notify_address: { type: "string", nullable: true },
    un_number: {
      type: "string",
      nullable: true,
      description: "Hazardous only. Four digits, written 'UN 1263'. Return just the digits.",
    },
    imo_class: {
      type: "string",
      nullable: true,
      description:
        "Hazardous only. The IMDG class, such as '3' or '8'. NEVER inferred from the cargo description.",
    },
    packing_group: { type: "string", nullable: true, enum: ["I", "II", "III"] },
    flash_point_c: {
      type: "number",
      nullable: true,
      description: "Hazardous only, in Celsius. Convert from Fahrenheit if given that way.",
    },
  },
  required: ["is_enquiry", "confidence", "reason", "summary"],
};

/**
 * Writing a reply, which is a different job with a different failure.
 *
 * A wrong classification costs somebody ten seconds. A wrong reply goes to a
 * customer over an employee's name, and on a freight desk the expensive version
 * of that is an invented number: a rate, a transit time, a free-days allowance
 * that nobody at Aashish agreed to but that the customer has now been quoted in
 * writing. So the strongest instruction here is the one about figures.
 *
 * It writes the reply only. No subject, no sign-off, no signature — the CRM
 * already seeds the signature into the editor and a second one written by a
 * model is how a reply goes out signed twice.
 */
const DRAFT_SYSTEM = [
  "You draft replies for a freight forwarder in Chennai — Aashish Logistics Global — handling",
  "LCL and FCL ocean freight, air freight and customs clearance, mostly on India lanes to and",
  "from Colombo, Jebel Ali, Singapore and Jeddah.",
  "",
  "Write the reply the employee would send. British business English, courteous and direct,",
  "the register of a shipping desk rather than a marketing email.",
  "",
  "Rules, in order of importance:",
  "- NEVER state a rate, transit time, free-days allowance, validity, schedule or any other",
  "  figure unless it appears verbatim in the thread you were given. If the customer asked for",
  "  a number you do not have, say it is being worked out and will follow — do not estimate,",
  "  do not give a range, do not repeat a figure from a different shipment.",
  "- Do not promise anything about capacity, timing or acceptance that the thread does not",
  "  already support.",
  "- Answer what was actually asked. If the message asks three things, address three.",
  "- If something essential is missing — commodity, weight, volume, incoterm, ready date —",
  "  ask for it plainly rather than writing around it.",
  "- Keep it short. Four sentences is usually enough and a long reply is rarely a better one.",
  "",
  "Output the body of the reply as plain text and nothing else. No subject line. No greeting",
  "block beyond a normal salutation. No sign-off, no name, no signature — those are added",
  "afterwards. No markdown, no bullet characters unless the content is genuinely a list.",
].join("\n");

/**
 * Reading a partner's reply to a rate request.
 *
 * A different job again from classifying and from drafting, and the failure it
 * has to avoid is the same one the drafter avoids from the other side: an
 * invented number. Here the number is being READ rather than written, so the
 * rule is absence over approximation — a rate this cannot find must come back
 * null, because a wrong figure on the comparison board is one somebody quotes
 * the customer from.
 */
const QUOTE_SYSTEM = [
  "You read replies from freight agents and forwarders to a request for a rate.",
  "",
  "Pull out what they quoted. Rules, in order of importance:",
  "- Copy figures EXACTLY as written. Never convert a currency, never round, never",
  "  add a number that is not in the message.",
  "- If several figures appear, take the ALL-IN or total freight rate. If the reply",
  "  breaks charges down without a total, return null for amount and put the",
  "  breakdown verbatim in notes. Do not add the components up yourself.",
  "- currency is the ISO code where you can tell — USD, INR, AED, LKR. Rs and INR",
  "  are the same thing. If it is genuinely unclear, return null rather than guess.",
  "- declined is true only if they say they cannot take it or have no space. An",
  "  agent asking for more information has NOT declined.",
  "- transit_days is a whole number of days in transit. A sailing date is not a",
  "  transit time.",
  "- notes is a short plain-text summary of anything a person would need: what the",
  "  rate covers, what it excludes, conditions, the vessel offered.",
  "",
  "Return nulls freely. An honest gap is useful; a confident wrong number is not.",
].join("\n");

const QUOTE_SCHEMA = {
  type: "object",
  properties: {
    amount: { type: "number", nullable: true, description: "The all-in rate, exactly as written." },
    currency: { type: "string", nullable: true },
    basis: { type: "string", nullable: true, description: "Per CBM, per container, lumpsum." },
    transit_days: { type: "integer", nullable: true },
    valid_until: { type: "string", nullable: true, description: "YYYY-MM-DD if a date is given." },
    space_confirmed: { type: "boolean", nullable: true },
    declined: { type: "boolean" },
    notes: { type: "string" },
  },
  required: ["declined", "notes"],
};

/**
 * Writing the rate request itself, when somebody asks for it to be written.
 *
 * ---------------------------------------------------------------------------
 * THE TEMPLATE IS STILL THE DEFAULT
 *
 * This is not what sends by default and should not become it. The deterministic
 * request copies every figure straight off the enquiry row and cannot get one
 * wrong; this one is reached only when an operator presses a button and says in
 * their own words what the mail should do — a chaser, a specific question, a
 * tone for a partner they know.
 *
 * SO THE RULE ABOUT FIGURES IS THE SAME RULE
 *
 * Every number in the output must come from the shipment details supplied. A
 * rate request that invents a volume gets quoted against cargo that does not
 * exist, and the quote comes back looking perfectly reasonable.
 */
const RFQ_SYSTEM = [
  "You write rate requests for a freight forwarder in Chennai - Aashish Logistics Global -",
  "to its overseas agents, consolidators and carriers.",
  "",
  "You are given the shipment details this desk holds, and an instruction from the employee",
  "about what this particular request should say. Write the email.",
  "",
  "Rules, in order of importance:",
  "- Use ONLY the shipment details supplied. Never invent or estimate a weight, volume,",
  "  piece count, date, rate or route. If the employee asks you to mention something the",
  "  details do not contain, ask the partner for it rather than stating it.",
  "- NEVER write a fill-in placeholder - no [vessel name], no [insert date], no XXXX, no",
  "  blanks to complete. This text is sent as written and a bracket in it goes to the",
  "  partner. Turn the gap into a question instead: 'please confirm the vessel and voyage'.",
  "- A figure the EMPLOYEE states in their instruction is theirs to state, and you may use",
  "  it. The rule above is about figures nobody supplied.",
  "- Follow the employee's instruction. It is the reason this is being written rather than",
  "  the standard template.",
  "- Always ask for what a rate request exists to get, unless the instruction says otherwise:",
  "  the all-in rate and its basis, space and the next sailing, transit time, and validity.",
  "- State the shipment details clearly. A partner should not have to reply asking what the",
  "  cargo is.",
  "- British business English, courteous and direct - the register of a shipping desk.",
  "- Keep it short. A partner reads twenty of these a day.",
  "",
  "Output HTML for the body only: <p>, <ul>, <li>, <strong>, <br>. No <html>, no <head>, no",
  "subject line, no markdown, no code fences. End with a sign-off naming the sender given.",
].join("\n");

/**
 * Reading a mail for news about a shipment already moving (072).
 *
 * Agents, airlines and carriers write "flight departed", "vessel sailed on the
 * 2nd", "cargo delivered, POD attached", "rolled over to next week's vessel".
 * This pulls those out so the desk can tick the step with one click.
 *
 * The failure to avoid is a plan read as a fact: a pre-alert that says "ETD
 * 2 Oct" is not a departure, and a departure ticked from it puts a milestone
 * on a job whose cargo is still in the warehouse. So only what the mail says
 * HAS happened is an event; a changed plan is a schedule change, and a plan
 * that has not changed is nothing at all.
 */
const TRACK_SYSTEM = [
  "You read mail about freight shipments that are already booked, for a forwarder in Chennai.",
  "You are given the shipment's own details and one message. List what the message says has",
  "happened to THIS shipment.",
  "",
  "Rules, in order of importance:",
  "- Only what HAS happened, stated as done: departed, sailed, airborne, landed, arrived,",
  "  discharged, customs cleared, out for delivery, delivered, received at the warehouse or CFS,",
  "  stuffed, gated in. A plan, a schedule, an ETD or ETA, 'will depart', 'expected to arrive'",
  "  and a pre-alert that only gives dates are NOT events.",
  "- EXCEPT a change of plan: a delay, a rollover to another vessel or flight, or a new ETD or",
  "  ETA replacing an earlier one. Report those as delayed, rolled_over or schedule_changed, and",
  "  put the new dates in new_etd and new_eta.",
  "- Only this shipment. Match it by the reference, house or master bill, container, flight,",
  "  vessel or route given. If the message is about a different shipment, or you cannot tell,",
  "  return no events.",
  "- Read only the newest message. Quoted history below it (lines after 'From:', 'On ... wrote:',",
  "  '-----Original Message-----') was already read when it arrived.",
  "- date is YYYY-MM-DD, resolved against the date the message was sent. time is HH:MM, only if",
  "  the message gives one. Null when not stated. Never invent a date.",
  "- detail is one short sentence in plain words a colleague reads: what happened, where, on",
  "  which flight or vessel. No prices, no phone numbers, no names of people.",
  "- evidence is the words from the message that say it, copied exactly, under 20 words.",
  "",
  "Return an empty list freely. A missed update costs a click; a wrong one ticks a milestone",
  "that did not happen.",
].join("\n");

const TRACK_SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: [
              "cargo_received", "stuffed", "gate_in", "loaded", "departed", "in_transit", "arrived",
              "discharged", "customs_cleared", "gate_out", "out_for_delivery", "delivered", "delayed",
              "rolled_over", "schedule_changed", "cancelled", "other",
            ],
          },
          date: { type: "string", nullable: true, description: "YYYY-MM-DD when it happened." },
          time: { type: "string", nullable: true, description: "HH:MM local, only if stated." },
          location: { type: "string", nullable: true },
          detail: { type: "string" },
          evidence: { type: "string" },
          new_etd: { type: "string", nullable: true, description: "YYYY-MM-DD, for a changed plan only." },
          new_eta: { type: "string", nullable: true, description: "YYYY-MM-DD, for a changed plan only." },
        },
        required: ["kind", "detail", "evidence"],
      },
    },
  },
  required: ["events"],
};

const SYSTEM = [
  "You read email for a freight forwarder in Chennai that handles LCL and FCL ocean freight,",
  "air freight and customs clearance. Lanes are mostly India to and from Colombo, Jebel Ali,",
  "Singapore and Jeddah.",
  "",
  "Decide whether the message is a NEW enquiry the desk should quote, and pull out the details.",
  "",
  "Rules:",
  "- Take details from what the sender wrote, never from the mail headers. A website contact form",
  "  arrives from the form mailer, not from the customer; the customer's own address is in the body.",
  "- NEVER return one of our own people as the contact. Anything at aashishlogistics.com or",
  "  aashishlogisticsglobal.com is a colleague, not a customer — that includes the signature at the",
  "  bottom of a message somebody here forwarded. On a forwarded or replied message the contact is",
  "  the ORIGINAL sender further down the thread. If the only name and address in the message are",
  "  ours, return null for contact_name, company, email and phone rather than naming a colleague.",
  "- Leave a field null when the message does not say. Do not infer a port from a country, do not",
  "  expand an abbreviation you are not sure of, and never invent a figure.",
  "- A subject carrying an enquiry reference — ENQ NO, ENQUIRY NO, ENQ#, ENQ, or the same idea",
  "  written another way — means this desk has already numbered this as an enquiry. Set",
  "  is_enquiry true, and put the reference itself in `reference` exactly as written. This rule",
  "  wins over the two below it: a numbered enquiry stays an enquiry even when the body reads as",
  "  a forward, a booking instruction, or a reply.",
  "- Otherwise, a reply in an existing thread about an existing quotation is NOT a new enquiry.",
  "- Otherwise, an invoice, statement, circular, newsletter or delivery notification is NOT an",
  "  enquiry.",
  "- If it is ambiguous, say so in the reason and give a confidence below 0.5. A person reads this",
  "  before anything is filed, so an honest maybe is more useful than a confident guess.",
].join("\n");

Deno.serve(async (req) => {
  // Set per request so every response below carries the right headers, including
  // the error paths — a 500 without CORS is an error the browser cannot read.
  CORS = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (!GEMINI_KEY) {
    return json({ error: "GEMINI_API_KEY is not set on this function." }, 500);
  }

  /**
   * GET lists the models this key can actually reach.
   *
   * Google's model names move, and a wrong one fails as a 404 that reads like
   * the function is broken. One request settles which id to pin.
   */
  if (req.method === "GET") {
    const r = await fetch(`${BASE}/models?key=${GEMINI_KEY}`);
    const body = await r.text();
    if (!r.ok) return json({ error: "Could not list models.", status: r.status, body }, 502);
    const names = (JSON.parse(body).models ?? [])
      .map((m: { name?: string }) => m.name?.replace(/^models\//, ""))
      .filter(Boolean);
    return json({ configured: MODEL, available: names });
  }

  if (req.method !== "POST") return json({ error: "POST a message." }, 405);

  let input: {
    subject?: string;
    from?: string;
    body?: string;
    /**
     * "classify" reads a message, "draft" answers one, "quote" reads a rate out
     * of a reply, "rfq" writes a rate request from shipment details.
     */
    mode?: "classify" | "draft" | "quote" | "rfq" | "tracking";
    /** Draft only: what the operator wants said, in their own words. */
    instruction?: string;
    /** Tracking only: the shipment's own details, and when the message was sent. */
    context?: string;
    sent_at?: string;
  };
  try {
    input = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const drafting = input.mode === "draft";
  const quoting = input.mode === "quote";
  const writingRfq = input.mode === "rfq";
  const tracking = input.mode === "tracking";
  const text = (input.body ?? "").trim();
  if (!text && !input.subject) return json({ error: "Nothing to read." }, 400);

  /**
   * Trimmed before it is sent.
   *
   * A long reply chain is mostly quoted history the model does not need to
   * decide anything, and input is what this costs. 12k characters is a
   * generous single message and a short thread.
   */
  const excerpt = text.slice(0, 12000);

  const prompt = [
    drafting
      ? "Reply to this message."
      : quoting
        ? "Read the rate out of this reply."
        : writingRfq
          ? "Write a rate request from these shipment details."
          : tracking
            ? `The shipment:\n${(input.context ?? "").slice(0, 2000)}\n\nThe message was sent ${input.sent_at ?? "(date unknown)"}.`
            : "",
    // Today's date, for a classification: "ready on the 2nd", "must reach by
    // 12 Oct" and "next Monday" carry no year, and without a date to anchor
    // them the model can only guess one or leave a date it plainly read blank.
    !drafting && !quoting && !writingRfq && !tracking
      ? `Today is ${new Date().toISOString().slice(0, 10)}. Resolve dates without a year to the next such date on or after today.`
      : "",
    `Subject: ${input.subject ?? "(none)"}`,
    `From: ${input.from ?? "(unknown)"}`,
    "",
    excerpt,
    // The operator's steer goes last, where it reads as the most recent
    // instruction rather than as part of the customer's message.
    drafting && input.instruction?.trim()
      ? `\n---\nThe employee sending this reply wants it to say: ${input.instruction.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const body = JSON.stringify({
    systemInstruction: {
      parts: [
        {
          text: drafting
            ? DRAFT_SYSTEM
            : quoting
              ? QUOTE_SYSTEM
              : writingRfq
                ? RFQ_SYSTEM
                : tracking
                  ? TRACK_SYSTEM
                  : SYSTEM,
        },
      ],
    },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    // Prose gets a little room to vary; a classification does not. Zero on a
    // reply produces the same four stiff sentences for every message.
    generationConfig: drafting || writingRfq
      ? { temperature: 0.4 }
      : {
          responseMimeType: "application/json",
          responseSchema: quoting ? QUOTE_SCHEMA : tracking ? TRACK_SCHEMA : SCHEMA,
          temperature: 0,
        },
  });

  /**
   * Retried, because the free tier says no at random.
   *
   * Measured, not assumed: four identical requests during testing produced one
   * 503 "this model is currently experiencing high demand" and three clean
   * answers. Without a retry that is an operator pressing a button and getting
   * an error for no reason they can see or fix, on a message that would have
   * classified perfectly a second later.
   *
   * Only 429 and 5xx are retried. A 400 is a request this code got wrong and a
   * 403 is a key problem; sending either again just spends the quota twice.
   */
  let r: Response | null = null;
  let raw = "";
  let used = MODEL;
  // Then the next model, when this one stays busy: measured on 23 Sep 2026, the
  // configured model answered 503 "high demand" to twelve requests in a row
  // across three minutes. Free-tier limits are per model, so a 429 on one is
  // not a 429 on the next.
  const models = [MODEL, ...FALLBACK_MODELS.filter((m) => m !== MODEL)];
  tries: for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise((ok) => setTimeout(ok, 600));
      try {
        r = await fetch(`${BASE}/models/${model}:generateContent?key=${GEMINI_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
      } catch {
        // A dropped connection is worth another go for the same reason a 503 is.
        continue;
      }
      raw = await r.text();
      used = model;
      if (r.ok || (r.status !== 429 && r.status < 500)) break tries;
    }
  }
  if (!r) return json({ error: "Could not reach Gemini." }, 502);
  if (!r.ok) {
    // Google's message is kept: it distinguishes a bad key from a retired model
    // from a quota refusal, and those need three different fixes.
    return json({ error: "Gemini refused the request.", status: r.status, detail: raw.slice(0, 800) }, 502);
  }

  try {
    const parsed = JSON.parse(raw);
    const part = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!part) {
      // A blocked or empty candidate is not a crash. Say what came back.
      return json(
        { error: "Gemini returned no content.", detail: JSON.stringify(parsed).slice(0, 800) },
        502
      );
    }
    // What it cost, so the bill is never a surprise nobody can explain.
    const usage = parsed.usageMetadata ?? null;

    // A draft is prose. Parsing it as JSON would throw on the first apostrophe.
    // Both prose modes come back as text rather than JSON. A fenced block is
    // stripped: the prompt forbids markdown and the model mostly complies, and
    // "mostly" would put ```html into somebody's outgoing mail.
    if (drafting || writingRfq) {
      const text = part.trim().replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
      return json({ draft: text, model: used, usage });
    }

    const answer = JSON.parse(part);

    /*
      "Hazardous" only on the sender's word.

      Told in the schema not to, the model still marks lithium batteries, paint
      and perfume hazardous because it knows they usually are. Usually is the
      problem: a guess puts DG paperwork on a job, and the desk confirms this
      with the shipper, not with a model. So a yes stands only with a UN number
      or IMO class beside it, or where the message itself says so.
    */
    if (!quoting && !tracking && answer.hazardous === true && !answer.un_number && !answer.imo_class) {
      const said = /\b(dangerous goods|hazardous|hazmat|haz\b|non-?haz|DGR?\b|IMDG|IMO class|UN\s?\d{4})/i;
      if (!said.test(`${input.subject ?? ""}\n${excerpt}`)) answer.hazardous = null;
    }

    return json({ ...answer, model: used, usage });
  } catch (e) {
    return json({ error: "Could not read Gemini's answer.", detail: String(e) }, 502);
  }
});
