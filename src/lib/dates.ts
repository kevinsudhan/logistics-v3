/**
 * Dates in words, with the month spelled from a fixed list.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT toLocaleDateString
 *
 * Current ICU writes September as "Sept" in both en-GB and en-IN, so the desk
 * saw "ETA 15 Sept" on the worklist and an agent read "25 Sept" in a
 * pre-alert's subject. Every other month is three letters. Which spelling a
 * browser produces also depends on its ICU version, so the same screen read
 * differently on two machines.
 *
 * formatDate takes the same options as toLocaleDateString, so a call site
 * changes in name only, and writes them the en-GB way: "Wed 15 Sep 2026,
 * 14:05". The clock is 24-hour unless `hour12` asks for "2:05 pm", which is
 * how the en-IN screens showed it.
 *
 * A calendar day ("2026-09-15") is read as that day where the browser is. It is
 * not taken as midnight UTC, which in IST is still the right day but in any
 * timezone west of Greenwich is the day before.
 * ---------------------------------------------------------------------------
 */

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface DateFormat {
  weekday?: "short" | "long";
  day?: "numeric" | "2-digit";
  month?: "short" | "long";
  year?: "numeric" | "2-digit";
  /** Adds the time. "numeric" and "2-digit" read the same: 09:05, or 9:05 am. */
  hour?: "numeric" | "2-digit";
  minute?: "2-digit";
  /** "2:05 pm" rather than "14:05". */
  hour12?: boolean;
  /** Read the instant on this zone's clock rather than the browser's: an e-way bill's day is India's day. */
  timeZone?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

interface Parts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
}

/** The instant's calendar parts, on the browser's clock or a named zone's. Numbers only: no names from the locale. */
function partsOf(d: Date, timeZone?: string): Parts {
  if (!timeZone) {
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), weekday: d.getDay(), hour: d.getHours(), minute: d.getMinutes() };
  }
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return {
    year: +p.year,
    month: +p.month - 1,
    day: +p.day,
    weekday: WEEKDAYS_SHORT.indexOf(p.weekday),
    hour: +p.hour % 24,
    minute: +p.minute,
  };
}

/** A Date from what the database hands back, or null when it is not one. */
export function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "15 Sep", "15 Sep 2026", "Wed 15 Sep, 14:05" — empty when the value is not a date. */
export function formatDate(value: string | number | Date | null | undefined, f: DateFormat): string {
  const d = toDate(value);
  if (!d) return "";
  const p = partsOf(d, f.timeZone);

  const words: string[] = [];
  if (f.weekday) words.push((f.weekday === "long" ? WEEKDAYS_LONG : WEEKDAYS_SHORT)[p.weekday]);
  if (f.day) words.push(f.day === "2-digit" ? pad(p.day) : String(p.day));
  if (f.month) words.push((f.month === "long" ? MONTHS_LONG : MONTHS_SHORT)[p.month]);
  if (f.year) words.push(f.year === "2-digit" ? pad(p.year % 100) : String(p.year));
  const date = words.join(" ");

  if (!f.hour) return date;
  const h = p.hour;
  const m = pad(p.minute);
  const time = f.hour12 ? `${h % 12 || 12}:${m} ${h < 12 ? "am" : "pm"}` : `${pad(h)}:${m}`;
  return date ? `${date}, ${time}` : time;
}
