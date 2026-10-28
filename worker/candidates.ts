// Code-side candidate finders. Jev never writes a value: these over-find spans in the
// message and Jev picks which one plays each field's role (same idea as jev-form-router).

export interface Candidate {
  key: string; // option name sent to Jev and shown in the UI
  value: string; // value that goes in the payload
  note?: string; // option description sent to Jev
  geo?: Geo;
  license?: License;
}

export interface Geo {
  label: string;
  name: string;
  borough?: string;
  zip?: string;
  bbl?: string;
  bin?: string;
  lat: number;
  lng: number;
  street?: string;
  housenumber?: string;
  corner?: boolean; // an intersection, not a building
  board?: Board; // which community board the location belongs to
}

export interface Board {
  cd: string; // "103"
  key: string; // destination key, "CB:103"
  short: string; // "CB3"
  name: string; // "CB3 Manhattan"
  outside: boolean; // not this app's board (CB2)
  email: string;
  url: string;
}

export interface License {
  dba: string;
  legalName: string;
  type: string;
  address: string;
  zip: string;
  expires: string;
  id: string;
}

const SUFFIX = "(?:St(?:reet)?|Ave(?:nue)?|Pl(?:ace)?|Blvd|Boulevard|Rd|Road|Dr(?:ive)?|Way|Sq(?:uare)?|Ln|Lane|Ter(?:race)?|Slip|Alley)";
const STREET_RE = new RegExp(
  `\\b((?:(?:[NSEW]\\.?|North|South|East|West)\\s+)?(?:\\d{1,3}(?:st|nd|rd|th)|[A-Za-z][a-zA-Z']+)(?:\\s+[A-Za-z][a-zA-Z']+)?\\s+${SUFFIX}\\b(?!-)\\.?)` +
    "|\\b(Broadway|Bowery|Avenue of the Americas|(?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\\s+Ave(?:nue)?|Avenue\\s+[A-D])\\b",
  "gi",
);
const ADDRESS_RE = new RegExp(`\\b\\d{1,5}(?:-\\d{1,4})?\\s+(?:[A-Za-z0-9.']+\\s+){0,3}?(?:${SUFFIX}\\b\\.?|Broadway|Bowery)`, "gi");
const LEAD_JUNK = /^(?:(?:at|and|on|of|the|corner|near|by|outside|in front of|across from)\s+)+/i;
const STOP = new Set(
  ("I I'm The A An And But It They He She We My This That There Their Every Last Yesterday Today Tonight Also So Please Hi Hello " +
    "Thanks When If On At In Can Could Would Will Is Are Do Does Monday Tuesday Wednesday Thursday Friday Saturday Sunday").split(" "),
);

function dedupe(c: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return c.filter((x) => {
    const k = x.key.toLowerCase();
    if (!x.key || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
const same = (s: string): Candidate => ({ key: s, value: s });

export const emails = (t: string) => dedupe([...t.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)].map((m) => same(m[0])));

export const phones = (t: string) =>
  dedupe([...t.matchAll(/(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g)].map((m) => ({
    key: `(${m[1]}) ${m[2]}-${m[3]}`,
    value: `${m[1]}-${m[2]}-${m[3]}`,
  })));

export function names(t: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of t.matchAll(/(?:my name is|i'm|i am|this is|name's|[-—])\s*([A-Z][a-z]+(?:\s+[A-Z][a-z']+)?)/gi)) {
    if (!STOP.has(m[1].split(/\s+/)[0])) out.push(same(m[1].trim()));
  }
  return dedupe(out);
}

/** Capitalized or numbered runs that could name a business or place ("13 Step", "Washington Square Park"). */
export function properNames(t: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of t.matchAll(/\b((?:\d+\s+)?[A-Z][\w'&-]*(?:\.(?=\w))?[\w'&-]*(?:\s+(?:of|the|and|&|[A-Z0-9][\w'&-]*))*)/g)) {
    const words = m[1].replace(/[ .,]+$/, "").split(/\s+/);
    while (words.length && STOP.has(words[0])) words.shift();
    const span = words.join(" ");
    // "2 Bleecker St" is an address, not a business name
    if (span.length > 2 && !STOP.has(span) && !new RegExp(`^\\d+\\s.*${SUFFIX}\\.?$`, "i").test(span)) out.push(same(span));
  }
  return dedupe(out).slice(0, 12);
}

export function streets(t: string): Candidate[] {
  return dedupe(
    [...t.matchAll(STREET_RE)]
      .map((m) => (m[1] ?? m[2]).replace(LEAD_JUNK, "").trim())
      .filter((s) => /\s|Broadway|Bowery/i.test(s))
      .map(same),
  );
}

/** Spans worth sending to GeoSearch: street addresses, intersections, named places. */
export function addressQueries(t: string): string[] {
  const qs = [...t.matchAll(ADDRESS_RE)].map((m) => m[0].replace(LEAD_JUNK, ""));
  const st = streets(t).map((s) => s.value);
  if (st.length >= 2) qs.push(`${st[0]} and ${st[1]}`);
  qs.push(...st.slice(0, 2));
  const seen = new Set<string>();
  return qs.filter((q) => !seen.has(q.toLowerCase()) && seen.add(q.toLowerCase())).slice(0, 5);
}

const NUMBER_WORDS = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]);
export function times(t: string): Candidate[] {
  const re =
    /\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\d{1,2}:\d{2}|midnight|noon|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:o'clock|am|pm|p\.m\.|a\.m\.)?\s*(?:at night|in the morning)?|(?:every|last|at|all)\s+night|overnight|late at night|every (?:weekend|morning|evening|day)|(?:this|every|yesterday|last)\s+(?:morning|afternoon|evening)|right now|tonight|for (?:a|one|two|three|\d+) (?:days?|weeks?|months?))\b/gi;
  return dedupe([...t.matchAll(re)].map((m) => m[0].trim()).filter((s) => !NUMBER_WORDS.has(s.toLowerCase())).map(same));
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function nycToday(): Date {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  return new Date(`${iso}T12:00:00Z`);
}
const pretty = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const back = (d: Date, n: number) => new Date(d.getTime() - n * 86400000);

export function dates(t: string): Candidate[] {
  const today = nycToday();
  const out: Candidate[] = [];
  const add = (d: Date, span: string) => out.push({ key: pretty(d), value: d.toISOString().slice(0, 10), note: `from "${span}"` });
  for (const m of t.matchAll(/\b(today|yesterday|tonight|last night)\b/gi)) add(back(today, /yesterday|last/i.test(m[1]) ? 1 : 0), m[0]);
  for (const m of t.matchAll(/\b(last |this |on )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi)) {
    let n = (today.getUTCDay() - DAY_NAMES.indexOf(m[2].toLowerCase()) + 7) % 7;
    if (n === 0 && m[1]?.trim().toLowerCase() === "last") n = 7;
    add(back(today, n), m[0].trim());
  }
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : today.getUTCFullYear();
    const d = new Date(Date.UTC(y, +m[1] - 1, +m[2], 12));
    if (d.getUTCMonth() === +m[1] - 1) add(d, m[0]);
  }
  return dedupe(out);
}

export const poleNumbers = (t: string) => dedupe([...t.matchAll(/\b(?=[A-Z0-9-]*\d)[A-Z]{0,4}-?\d{3,7}[A-Z]?\b/g)].map((m) => same(m[0])));

export const plates = (t: string) =>
  dedupe(
    [...t.matchAll(/\b(?=[A-Z0-9 -]*\d)(?=[A-Z0-9 -]*[A-Z])[A-Z0-9]{2,4}[- ]?[A-Z0-9]{2,4}\b/g)]
      .map((m) => m[0])
      .filter((s) => !/^\d+(st|nd|rd|th)?$/i.test(s))
      .map((s) => ({ key: s, value: s.replace(/\s/g, "") })),
  );

export const units = (t: string) =>
  dedupe([
    ...[...t.matchAll(/\b(?:apt\.?|apartment|unit|#)\s*([0-9]{1,4}[A-Z]?|[A-Z]{1,2}\d{0,3})\b/gi)].map((m) => ({ key: m[0].trim(), value: m[1] })),
    ...[...t.matchAll(/\b\d{1,2}[A-H]\b/g)].map((m) => same(m[0])),
  ]);

export const FINDERS: Record<string, (t: string) => Candidate[]> = {
  emails, phones, names, proper_names: properNames, streets, times, dates, pole_numbers: poleNumbers, plates, units,
};
