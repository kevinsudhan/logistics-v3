import ackCodes from "./icegate/ackCodes.json";
import type { CsnDraft } from "./icegateCsn";

/**
 * ---------------------------------------------------------------------------
 * READING ICEGATE'S REPLY TO A CSN FILE
 *
 * ICEGATE answers every file it receives, by mail or on the upload page, with
 * a file named after the one it answers:
 *
 *   …_SFL.json  the file did not match the schema ("structure failed"). Each
 *               failure comes with its JSON pointer and the schema keyword.
 *   …_ACK.json  the file was read and checked against Customs' data. Every
 *               object comes back with error codes, "000" where it passed. A
 *               positive ACK carries the CSN number and date, and the cargo
 *               identification numbers (MCIN / PCIN) Customs gave.
 *
 * Customs' own ACK samples do not agree with each other, or with the guide's
 * ACK schema, on where things sit: mastrCnsgnmtDec or mastrCnsgmtDec,
 * houseCargoDec or hcargoDec, error codes beside an object or inside it,
 * numbers as strings or not. So this follows no fixed path. It walks the whole
 * file and takes the error codes, the house sub-line and the sequence numbers
 * from wherever they are.
 *
 * The error texts are the guide's list (section 7, `icegate/ackCodes.json`),
 * used when a reply gives a code without its description.
 * ---------------------------------------------------------------------------
 */

const CODES = ackCodes as Record<string, string>;

export interface CsnReplyError {
  code: string;
  message: string;
  /** What it is about, in the desk's words: "Vessel", "Container", "Parties and description". */
  object: string;
  /** The field, when the reply names one (SFL). */
  field?: string;
  /** On a house line. */
  house: boolean;
  /** Which house, by the sub-line it was filed under (ACK)… */
  subLine?: number;
  /** …or by its place in the file's list of houses (SFL). */
  entry?: number;
  /** A container, item or port of call, by its sequence number. */
  seq?: { kind: "container" | "item" | "call"; n: number };
  /** Where, as the reply puts it. */
  path: string;
}

export interface CsnReply {
  kind: "ACK" | "SFL";
  /** The reporting event of the file answered: SCE, SCX, SCA. */
  event: string;
  /** The sender the file came from: the desk's ICEGATE ID. */
  sender: string;
  port: string;
  /** P (live) or T (test), as the file was sent. */
  indicator: string;
  /** The file's job number, which is how the CRM finds the file answered. */
  jobNo: number | null;
  /** yyyy-mm-dd, when the reply dates itself that way. */
  date: string;
  accepted: boolean;
  /** The CSN number and date (yyyy-mm-dd), on a positive ACK. */
  csnNo: string;
  csnDate: string;
  /** The master line's cargo identification number, when Customs gave one. */
  masterCin: { type: string; no: string } | null;
  /** Each house's, by sub-line. */
  houseCins: Array<{ subLine: number; type: string; no: string }>;
  errors: CsnReplyError[];
  /** SFL: ICEGATE's own summary, "Schema validation failure". */
  status?: string;
}

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const cut = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);
/** yyyymmdd to yyyy-mm-dd; anything else, as nothing. */
const isoOf = (v: unknown) => {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(str(v));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
};
const posInt = (v: unknown) => {
  const n = Number(str(v));
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** The objects of the file, by the start of their names in any casing. */
const OBJECTS: Array<[RegExp, string]> = [
  [/^headerfield/, "File header"],
  [/^decref/, "Declaration reference"],
  [/^authprsn/, "Authorised person"],
  [/^vesseldtls/, "Vessel"],
  [/^voyagedtls/, "Voyage"],
  [/^mcref/, "Master B/L"],
  [/^hcref/, "House B/L"],
  [/^prevref/, "Previous reference (PCIN)"],
  [/^supref/, "CSN reference"],
  [/^loccstm/, "Ports and cargo movement"],
  [/^trnshpr/, "Transhipper"],
  [/^trnsprtdocmsr/, "Packages and weights"],
  [/^trnsprtdoc/, "Parties and description"],
  [/^itemdtls/, "Cargo item"],
  [/^trnsprteq/, "Container"],
  [/^itnry/, "Itinerary"],
  [/(suprt|sprt)docs/, "Supporting documents"],
  [/^mcadtnldec|^hcadtnldec/, "Additional declaration"],
  [/^h(ouse)?cargodec/, "House line"],
  [/^mastrcnsg/, "Master line"],
];
/** The first of `names` (most specific first) that is an object of the file. */
function objectOf(names: string[]): string {
  for (const n of names) {
    const k = n.toLowerCase().replace(/errorcode$/, "");
    const hit = OBJECTS.find(([re]) => re.test(k));
    if (hit) return hit[1];
  }
  return "Declaration";
}
const HOUSES = /^h(ouse)?cargodec$/i;
const SEQ_KEYS: Array<[string, "container" | "item" | "call"]> = [
  ["eqmtSeqNo", "container"],
  ["crgoItemSeqNmbr", "item"],
  ["prtOfCallSeqNmbr", "call"],
];

interface Ctx {
  house: boolean;
  subLine?: number;
  seq?: CsnReplyError["seq"];
}

/** Every error code in an ACK, wherever it sits, and the numbers Customs gave. */
function walkAck(node: unknown, keys: string[], ctx: Ctx, out: CsnReply): void {
  const key = keys[keys.length - 1] ?? "";
  if (Array.isArray(node)) {
    if (/errorcode$|^errcd$/i.test(key)) {
      for (const e of node) if (isObj(e)) collect(e, keys, ctx, out);
      return;
    }
    // A list of houses: the place in it is the sub-line, unless the house says otherwise.
    const houses = HOUSES.test(key);
    node.forEach((el, i) => walkAck(el, keys, houses ? { house: true, subLine: i + 1 } : ctx, out));
    return;
  }
  if (!isObj(node)) return;
  let c = ctx;
  const sub = isObj(node.HCRef) ? posInt(node.HCRef.subLineNo) : undefined;
  if (sub) c = { ...c, house: true, subLine: sub };
  for (const [k, kind] of SEQ_KEYS) {
    const n = posInt(node[k]);
    if (n) c = { ...c, seq: { kind, n } };
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "digSign") continue;
    if (/^(hc|mc)response$/i.test(k)) {
      if (!isObj(v) || !str(v.mcinPcin)) continue;
      const cin = { type: str(v.cinTyp).toUpperCase(), no: str(v.mcinPcin).toUpperCase() };
      if (/^hc/i.test(k) && c.subLine) out.houseCins.push({ subLine: c.subLine, ...cin });
      else if (/^mc/i.test(k)) out.masterCin = cin;
      continue;
    }
    walkAck(v, [...keys, k], c, out);
  }
}

function collect(e: J, keys: string[], ctx: Ctx, out: CsnReply) {
  const code = str(e.errorCode ?? e.errCD ?? e.errCd ?? e.code);
  const given = str(e.errorMessage ?? e.errMsg ?? e.errorDesc ?? e.message);
  // "000", "00", or no code at all with a message of success.
  if (code ? /^0+$/.test(code) : !given || /^success/i.test(given)) return;
  const known = /^\d+$/.test(code) ? CODES[String(Number(code))] : undefined;
  const path = str(e.pathName) || `/${keys.join("/")}`;
  const segs = path.split("/").filter(Boolean);
  const house = ctx.house || segs.some((s) => HOUSES.test(s));
  const object = objectOf([keys[keys.length - 1], ...[...segs].reverse(), ...[...keys].reverse()]);
  const seq = ctx.seq && ["Container", "Cargo item", "Itinerary"].includes(object) ? ctx.seq : undefined;
  const err: CsnReplyError = { code, message: cut(given || known || "no description given"), object, house, path: cut(path, 200) };
  if (house && ctx.subLine) err.subLine = ctx.subLine;
  if (seq) err.seq = seq;
  const same = out.errors.some((x) => x.code === err.code && x.path === err.path && x.subLine === err.subLine && x.seq?.n === err.seq?.n && x.message === err.message);
  if (!same && out.errors.length < 200) out.errors.push(err);
}

/** The schema keyword of a structure failure, in words. */
const KEYWORD: Record<string, string> = {
  required: "is missing",
  minLength: "is empty or too short",
  maxLength: "is too long",
  pattern: "is not in the format ICEGATE expects",
  type: "is the wrong kind of value",
  minimum: "is below the least allowed",
  maximum: "is above the most allowed",
  enum: "is not one of the allowed values",
  additionalProperties: "has a field ICEGATE does not know",
  minItems: "has too few entries",
};

function readSfl(doc: J, out: CsnReply) {
  const d = doc.errorDetails as J;
  out.status = str(d.status);
  const list = Array.isArray(d.errorMessage) ? d.errorMessage : [d.errorMessage];
  for (const m of list) {
    if (!isObj(m)) continue;
    const pointer = str(isObj(m.instance) ? m.instance.pointer : "") || "/";
    const segs = pointer.split("/").filter(Boolean);
    const named = segs.filter((s) => !/^\d+$/.test(s));
    const at = (re: RegExp) => {
      const i = segs.findIndex((s) => re.test(s));
      return i >= 0 && /^\d+$/.test(segs[i + 1] ?? "") ? Number(segs[i + 1]) + 1 : undefined;
    };
    const entry = at(HOUSES);
    const box = at(/^trnsprteq/i);
    const item = at(/^itemdtls$/i);
    const call = at(/^itnry$/i);
    const keyword = str(m.keyword);
    // The field is the last name in the pointer when that name is not itself an object.
    const last = named[named.length - 1] ?? "";
    const field = objectOf([last]) === "Declaration" ? last : undefined;
    const object = objectOf([...named].reverse());
    const err: CsnReplyError = {
      code: str(d.errorCode) || keyword,
      message: cut(`${field ? `${field} ` : ""}${KEYWORD[keyword] ?? "does not match the format"}${str(m.message) ? `: ${str(m.message)}` : ""}`),
      object,
      field,
      house: entry !== undefined,
      path: cut(pointer, 200),
    };
    if (entry) err.entry = entry;
    if (box) err.seq = { kind: "container", n: box };
    else if (item) err.seq = { kind: "item", n: item };
    else if (call) err.seq = { kind: "call", n: call };
    if (out.errors.length < 200) out.errors.push(err);
  }
  if (!out.errors.length) {
    out.errors.push({ code: str(d.errorCode), message: out.status || "the file did not match the format", object: "Declaration", house: false, path: "/" });
  }
}

/** Anywhere in the file, an array of error codes? A declaration has none. */
function hasErrorCodes(node: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (Array.isArray(node)) return node.some((x) => hasErrorCodes(x, depth + 1));
  if (!isObj(node)) return false;
  return Object.entries(node).some(([k, v]) => (/errorcode$|^errcd$/i.test(k) && Array.isArray(v)) || hasErrorCodes(v, depth + 1));
}

/**
 * Read ICEGATE's reply: the file's text as it came. `fileName` is used for
 * the job number only when the reply does not give it.
 */
export function readCsnReply(text: string, fileName = ""): CsnReply {
  let doc: unknown;
  try {
    doc = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new Error("That file is not JSON. ICEGATE's replies are …_ACK.json or …_SFL.json.");
  }
  if (!isObj(doc) || !isObj(doc.headerField)) throw new Error("That is not an ICEGATE reply: it has no header.");
  const h = doc.headerField;
  const master = isObj(doc.master) ? doc.master : null;
  const decRef = master && isObj(master.decRef) ? master.decRef : {};
  const fromName = /^F_SACHM\d+_[A-Z]{3}_[^_]+_(\d+)_\d+_(ACK|SFL)/i.exec(fileName.split(/[\\/]/).pop() ?? "");
  const out: CsnReply = {
    kind: "ACK",
    event: str(h.reportingEvent || decRef.rptngEvent).toUpperCase(),
    sender: str(h.senderID).toUpperCase(),
    port: str(h.receiverID || decRef.prtofRptng).toUpperCase(),
    indicator: str(h.indicator).toUpperCase(),
    jobNo: posInt(h.sequenceOrControlNumber) ?? posInt(decRef.jobNo) ?? posInt(fromName?.[1]) ?? null,
    date: isoOf(h.date),
    accepted: false,
    csnNo: "",
    csnDate: "",
    masterCin: null,
    houseCins: [],
    errors: [],
  };
  if (isObj(doc.errorDetails)) {
    out.kind = "SFL";
    readSfl(doc, out);
    return out;
  }
  if (!master) throw new Error("That is not an ICEGATE reply: it has neither a declaration nor error details.");
  // The reply's own key: an amendment declaration also names a CSN (csnNmbr), the one it amends.
  const csnNo = str(decRef.csn_no ?? decRef.csnNo);
  // Every ACK carries error codes, "000" where all is well; a declaration carries none.
  if (!hasErrorCodes(master) && !csnNo) {
    throw new Error("That is the CSN file itself (…_DEC.json), not ICEGATE's reply. Upload the …_ACK.json or …_SFL.json ICEGATE sent back.");
  }
  walkAck(master, ["master"], { house: false }, out);
  out.csnNo = /^\d+$/.test(csnNo) ? csnNo : "";
  out.csnDate = isoOf(decRef.csn_dt ?? decRef.csnDt);
  out.accepted = out.errors.length === 0;
  return out;
}

/**
 * Where an error is, in the form's terms: the house by its B/L number and job
 * (from the form kept with the file answered), the container by its number.
 * `event` is the file's: in an amendment, a house's place in the file is not
 * its place in the form, so an SFL's house entry is named as such.
 */
export function whereInForm(e: CsnReplyError, filed: CsnDraft | null, event: string): string {
  const parts: string[] = [];
  let boxes = filed?.containers;
  if (e.house) {
    const h =
      e.subLine !== undefined
        ? filed?.houses.find((x, i) => (x.subLine ?? i + 1) === e.subLine)
        : e.entry !== undefined && event !== "SCA"
          ? filed?.houses[e.entry - 1]
          : undefined;
    boxes = h?.containers;
    if (h) parts.push(`House ${h.hblNo || h.ref}${h.hblNo && h.ref ? ` (${h.ref})` : ""}`);
    else if (e.subLine !== undefined) parts.push(`House sub-line ${e.subLine}`);
    else if (e.entry !== undefined) parts.push(`House entry ${e.entry} in the file`);
    else parts.push("A house B/L");
  } else if (!["File header", "Declaration reference", "Authorised person", "Vessel", "Voyage", "Declaration"].includes(e.object)) {
    parts.push("Master line");
  }
  if (e.seq) {
    // The container, item or port of call says what it is; the object would say it twice.
    const box = e.seq.kind === "container" && event !== "SCA" ? boxes?.[e.seq.n - 1] : undefined;
    parts.push(box?.no ? `container ${box.no}` : `${{ container: "container", item: "cargo item", call: "port of call" }[e.seq.kind]} ${e.seq.n}`);
  } else if (e.object !== "House line" && e.object !== "Master line") {
    parts.push(e.object);
  }
  return parts.join(" · ");
}
