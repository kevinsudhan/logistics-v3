/**
 * The IGM's particulars, read out of a mail: the line's or its agent's IGM
 * advice, an arrival notice, a co-loader's CSN confirmation.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS PATTERNS AND NOT A MODEL
 *
 * These are numbers Customs checks digit by digit: an IGM number, its line
 * and sub-line, the voyage call number, the vessel's IMO number. Each comes in
 * a mail after its label — "IGM No: 1214225", "IGM NO/DT 1214225 DT
 * 28.09.2026", "Line No. 644", "Sub Line No: 25", "VCN : INMAA1262035",
 * "IMO NO 9389411" — and a pattern either finds it whole or does not find it,
 * where a reading can return a plausible number that is not in the mail.
 * What is found only fills an empty field, and the IGM page says which mail
 * it came from.
 * ---------------------------------------------------------------------------
 */

export interface IgmFound {
  igmNo?: string;
  /** yyyy-mm-dd */
  igmDate?: string;
  lineNo?: string;
  subLineNo?: string;
  vcn?: string;
  imo?: string;
  callSign?: string;
  csnNo?: string;
  pcin?: string;
  cfsCode?: string;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** A date as mails write it — 28-SEP-26, 28/09/2026, 28.09.2026, 2026-09-28 — as yyyy-mm-dd; nothing when it is not one. */
export function mailDate(text: string): string {
  const t = text.trim().toUpperCase();
  const year = (y: string) => (y.length === 2 ? `20${y}` : y);
  const ok = (y: string, m: number, d: number) =>
    m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${year(y)}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "";
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return ok(m[1], Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})\b/.exec(t);
  if (m) return ok(m[3], Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[\s./-]*([A-Z]{3})[A-Z]*[\s./,-]*(\d{2}|\d{4})\b/.exec(t);
  if (m && MONTHS.includes(m[2])) return ok(m[3], MONTHS.indexOf(m[2]) + 1, Number(m[1]));
  return "";
}

/** The mail as plain text: tags out, entities decoded, runs of space one space; a line break kept. */
export function mailText(content: string, html: boolean): string {
  let t = content;
  if (html) {
    t = t
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " \t ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  }
  return t
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** A label, the separators a mail puts after it (colon, dash, full stop, "#"), then the value. */
const after = (label: string, value: string) => new RegExp(`${label}\\s*[:#.\\-=]*\\s*${value}`, "i");
const SEP = "[\\s:#.\\-=]*";

/**
 * Everything the text gives of the IGM. The first mention of each wins: a
 * mail quoting an older one below it puts the newer numbers first.
 */
export function igmFromText(text: string): IgmFound {
  const t = text.replace(/ /g, " ");
  const out: IgmFound = {};
  const grab = (re: RegExp) => re.exec(t)?.[1];

  // "IGM No/Dt: 1214225 / 28-SEP-26", "IGM NO 1214225 DT 28.09.2026", "IGM No. 1214225 dated 28/09/2026"
  const igm = new RegExp(`\\bIGM${SEP}(?:NO|NUMBER|NMBR)?\\.?(?:\\s*(?:/|&|AND)\\s*(?:DT|DATE)\\.?)?${SEP}(\\d{6,7})\\b(?:\\s*(?:/|,|DT\\.?|DATED|DATE|OF|ON)\\s*[:.]?\\s*([0-9A-Z./\\- ]{6,11}))?`, "i").exec(t);
  if (igm) {
    out.igmNo = igm[1];
    const d = igm[2] ? mailDate(igm[2]) : "";
    if (d) out.igmDate = d;
  }
  if (!out.igmDate) {
    const d = grab(new RegExp(`\\bIGM${SEP}(?:DT|DATE)\\.?${SEP}([0-9A-Z./\\- ]{6,11})`, "i"));
    if (d && mailDate(d)) out.igmDate = mailDate(d);
  }

  // The sub-line before the line: "Sub Line No" also says "Line No".
  out.subLineNo = grab(after("\\bSUB[\\s.\\-]*(?:LINE|ITEM)(?:\\s*/\\s*(?:LINE|ITEM))?\\s*(?:NO|NUMBER)?\\.?", "(\\d{1,4})\\b"));
  const line = new RegExp(`(?<!SUB[\\s.\\-]{0,3})\\b(?:IGM\\s*)?(?:LINE|ITEM)(?:\\s*/\\s*(?:LINE|ITEM))?\\s*(?:NO|NUMBER)?\\.?${SEP}(\\d{1,5})\\b`, "i").exec(t);
  if (line) out.lineNo = line[1];

  out.vcn = grab(after("\\b(?:VCN|VOYAGE\\s*CALL\\s*(?:NO|NUMBER)|CALL\\s*NO)\\.?", "([A-Z]{2}[A-Z0-9]{3}\\d?[A-Z0-9]{4,16})\\b"))?.toUpperCase();
  out.imo = grab(after("\\bIMO\\s*(?:NO|NUMBER|CODE)?\\.?", "(\\d{7})\\b"));
  out.callSign = grab(after("\\b(?:CALL\\s*SIGN|VESSEL\\s*CODE)", "([A-Z0-9]{4,7})\\b"))?.toUpperCase();
  out.csnNo = grab(after("\\bCSN\\s*(?:NO|NUMBER|NMBR)?\\.?", "(\\d{5,7})\\b"));
  out.pcin = grab(after("\\bPCIN\\s*(?:NO|NUMBER)?\\.?", "(\\d{2}[A-Z]{4}\\d{12,16})\\b"))?.toUpperCase();
  out.cfsCode = grab(after("\\b(?:CFS|CUSTODIAN)\\s*CODE", "(IN[A-Z]{3}\\d[A-Z0-9]{2,6})\\b"))?.toUpperCase();

  for (const k of Object.keys(out) as Array<keyof IgmFound>) if (!out[k]) delete out[k];
  return out;
}

/**
 * The IGM's particulars from several mails, newest first: each from the first
 * mail that gives it, with that mail named.
 */
export function igmFromMails(mails: Array<{ text: string; subject: string; from: string; at: string }>): Partial<Record<keyof IgmFound, { value: string; subject: string; from: string; at: string }>> {
  const out: Partial<Record<keyof IgmFound, { value: string; subject: string; from: string; at: string }>> = {};
  for (const m of [...mails].sort((a, b) => (a.at < b.at ? 1 : -1))) {
    const found = igmFromText(`${m.subject}\n${m.text}`);
    for (const [k, v] of Object.entries(found) as Array<[keyof IgmFound, string]>) {
      if (!out[k]) out[k] = { value: v, subject: m.subject, from: m.from, at: m.at };
    }
  }
  return out;
}
