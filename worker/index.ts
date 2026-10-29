// CB2 / 311 intake Worker. Say or type what's wrong; one speculative Jev fan-out call decides
// emergency?, which form?, and every field of every form (the jev-form-router pattern).
// Code finds every candidate value (regex spans, NYC GeoSearch, NYS liquor licenses); Jev only picks.

import catalog from "./catalog.json";
import { type Board, type Candidate, type Geo, type License, FINDERS, addressQueries, properNames, streets } from "./candidates";
import { intersectionNode } from "./intersection";
import { history } from "./history";
import { type Extracted, extract, placeQueries, cornerOf } from "./clairic";

interface Env {
  ASSETS: Fetcher;
  AI?: Ai;
  DB: D1Database;
  TYPESAFE_API_KEY?: string;
  TYPESAFE_MODEL?: string;
  GEMINI_API_KEY?: string;
  MAPBOX_TOKEN?: string;
  SEND_WEBHOOK_URL?: string;
}

type FieldSpec = {
  id: string; label: string; kind: string; required?: boolean; hint?: string; find?: string;
  choices?: string[]; question?: string; sr?: string;
};
type FormSpec = { name: string; agency: string; complaint_type: string; route: string; fields: FieldSpec[]; contact_required?: boolean };

/** A past CB2 resolution, from the Full Board minutes (the D1 `resolutions` table; scripts/build_resolution_index.py). */
interface Resolution {
  id: string; meeting_date: string; meeting_iso: string; committee: string; title: string; address: string | null; legal_name: string; dba: string;
  license_type: string; outcome: string; vote: string; bbl: string | null; lat: number | null; lng: number | null; stipulations: string[]; source: string;
  text?: string | null; // the full item from the minutes, added by withText
}
const toResolution = (row: any): Resolution => ({ ...row, stipulations: JSON.parse(row.stipulations) });
const newestFirst = (a: Resolution, b: Resolution) => b.meeting_iso.localeCompare(a.meeting_iso);
const unique = (rs: Resolution[]) => [...new Map(rs.map((r) => [r.id, r])).values()];

/** Metres between two points (equirectangular; fine at block scale). */
const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((a.lat - b.lat) * 111_320, (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180));
const AT_M = 20, NEAR_M = 250;
const placed = (r: Resolution): r is Resolution & { lat: number; lng: number } => r.lat != null && r.lng != null;

/** What the board decided at a place: `at` the address itself (newest first), and `near` it on the surrounding blocks (nearest first). */
interface Place { at: Resolution[]; near: Resolution[] }
const NO_PLACE: Place = { at: [], near: [] };

/** A row in `events` (migrations/0004_events.sql), written after the response; also logged for Workers Logs. */
type Event = { kind: string; route_id?: string; form?: string; ms?: number; data?: Record<string, unknown> };
type Track = (e: Event) => void;

function tracker(env: Env, ctx: ExecutionContext, session: string | null): Track {
  return (e) => {
    console.log({ event: e.kind, route_id: e.route_id, form: e.form, ms: e.ms, ...e.data });
    ctx.waitUntil(
      env.DB.prepare("INSERT INTO events (kind, session, route_id, form, ms, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
        .bind(e.kind, session, e.route_id ?? null, e.form ?? null, e.ms ?? null, e.data ? JSON.stringify(e.data) : null)
        .run()
        .catch((err) => console.warn({ event: "track", error: (err as Error).message })),
    );
  };
}

/** The board's record around each place, in one D1 round trip: rows on the same tax lot or within a box about NEAR_M across. */
async function placesFor(db: D1Database, geos: (Geo | undefined)[]): Promise<Place[]> {
  const dLat = NEAR_M / 111_320, dLng = NEAR_M / 84_000; // a degree of longitude is about 84 km at this latitude
  const asked = geos.map((g, i) => [g, i] as const).filter((x): x is readonly [Geo, number] => !!x[0]);
  if (!asked.length) return geos.map(() => NO_PLACE);
  const stmt = db.prepare("SELECT * FROM resolutions WHERE bbl = ?1 OR (lat BETWEEN ?2 AND ?3 AND lng BETWEEN ?4 AND ?5)");
  const results = await db.batch(asked.map(([g]) => stmt.bind(g.bbl ?? "", g.lat - dLat, g.lat + dLat, g.lng - dLng, g.lng + dLng)));
  const out = geos.map(() => NO_PLACE);
  asked.forEach(([g, i], k) => {
    const rows = (results[k].results as any[]).map(toResolution);
    // A corner is not a licensed premises, so nothing is "at" it.
    // Up to four: one meeting can hold two items for a place (a Landmarks review and its recommendation to DOT).
    const at = g.corner ? [] : rows.filter((r) => (g.bbl && r.bbl === g.bbl) || (placed(r) && metres(r, g) <= AT_M)).sort(newestFirst).slice(0, 4);
    const near = rows.filter((r) => placed(r) && !at.some((x) => x.id === r.id) && metres(r, g) <= NEAR_M)
      .sort((a, b) => metres(a as any, g) - metres(b as any, g)).slice(0, 8);
    out[i] = { at, near };
  });
  return out;
}

const STOPWORDS = new Set("a an and are at be but by for from has have i in is it its my of on or our so that the their there they this to was we were with you your very really every all just near outside about been get got too many much street streets avenue ave place there".split(" "));

/** BM25 search of the minutes for the resident's own words: the topic, the business, the street. */
async function searchMinutes(db: D1Database, message: string, limit = 6): Promise<Resolution[]> {
  // Words only: a bare house number matches every address that shares it.
  const terms = [...new Set(message.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [])].filter((t) => !STOPWORDS.has(t)).slice(0, 24);
  if (!terms.length) return [];
  const rows = await db.prepare(
    `SELECT r.* FROM resolutions_fts f JOIN resolutions r ON r.id = f.id
     WHERE resolutions_fts MATCH ?1 ORDER BY bm25(resolutions_fts, 0, 3, 4, 3, 1, 1) LIMIT ?2`,
  ).bind(terms.map((t) => `"${t}"`).join(" OR "), limit).all();
  return (rows.results as any[]).map(toResolution);
}
type Answer =
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "noul"; noul: number };

const GENERAL = catalog.general as FieldSpec[];
const FORMS = catalog.forms as Record<string, FormSpec>;
const COMMITTEES = catalog.committees as Record<string, string>;
const NONE = "none of these";
const NOT_STATED = "not stated";
const INCLUDE_AT = 0.5;
const GEOSEARCH = "https://geosearch.planninglabs.nyc/v2";
const CB2_FOCUS = "focus.point.lat=40.7265&focus.point.lon=-74.0";
const PLUTO = "https://data.cityofnewyork.us/resource/64uk-42ks.json"; // tax lots, with community district
const SLA_LICENSES = "https://data.ny.gov/resource/9s3h-dpkz.json"; // NYS Liquor Authority active licenses

// Open-data lookups only add candidates, so a slow one is dropped rather than stalling the form.
const LOOKUP = { get signal() { return AbortSignal.timeout(2500); } };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

// ---------- lookups that become location candidates ----------

function featureToCandidate(f: any): Candidate {
  const p = f.properties;
  const pad = p.addendum?.pad ?? {};
  const [lng, lat] = f.geometry.coordinates;
  const geo: Geo = {
    label: p.label, name: p.name, borough: p.borough, zip: p.postalcode, bbl: pad.bbl, bin: pad.bin, lat, lng,
    street: p.street, housenumber: p.housenumber,
  };
  return { key: `${p.name}, ${p.borough ?? p.locality ?? ""}`.replace(/, $/, ""), value: p.label, note: `${p.borough ?? ""} ${p.postalcode ?? ""}`.trim(), geo };
}

async function geosearch(q: string, size = 3): Promise<Candidate[]> {
  try {
    const r = await fetch(`${GEOSEARCH}/search?text=${encodeURIComponent(q)}&size=${size}&${CB2_FOCUS}`, LOOKUP);
    return ((await r.json()) as any).features.map(featureToCandidate);
  } catch {
    return [];
  }
}

/** "13 Step" → THE 13TH STEP, 149 2ND AVENUE. Matches each word loosely ("13" also matches "13TH"). */
async function liquorLicenses(name: string): Promise<License[]> {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && w !== "THE");
  if (!words.length || words.length > 5) return [];
  const like = `%${words.join("%")}%`.replace(/'/g, "''");
  const where = `premisescounty='New York' AND (upper(dba) like '${like}' OR upper(legalname) like '${like}')`;
  try {
    const r = await fetch(`${SLA_LICENSES}?$limit=4&$where=${encodeURIComponent(where)}`, LOOKUP);
    const rows = (await r.json()) as any[];
    return Array.isArray(rows)
      ? rows.map((x) => ({
          dba: x.dba || x.legalname, legalName: x.legalname, type: x.description, address: x.actualaddressofpremises,
          zip: x.zipcode, expires: (x.expirationdate || "").slice(0, 10), id: x.licensepermitid,
        }))
      : [];
  } catch {
    return [];
  }
}

/**
 * "Hudson St and Christopher St" → a dot on that corner. The corner comes from the street
 * centerline; the nearest address supplies the block, ZIP, and district check.
 */
async function intersections(message: string): Promise<Candidate[]> {
  const st = streets(message).map((s) => s.value).slice(0, 3);
  const pairs: [string, string][] = [];
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) pairs.push([st[i], st[j]]);
  const found = await Promise.all(pairs.map(([a, b]) => corner(a, b)));
  return found.filter((c): c is Candidate => !!c);
}

async function corner(a: string, b: string): Promise<Candidate | null> {
  const node = intersectionNode(a, b);
  if (!node) return null;
  const [lng, lat] = node;
  let near: Candidate | undefined;
  try {
    const r = await fetch(`${GEOSEARCH}/reverse?point.lat=${lat}&point.lon=${lng}&size=1`, LOOKUP);
    near = ((await r.json()) as any).features.map(featureToCandidate)[0];
  } catch { /* the corner still stands without a nearest address */ }
  if (!near?.geo) return null;
  const label = `${titleCase(a)} & ${titleCase(b)}`;
  return {
    key: `Corner of ${label}`,
    value: `${label}, Manhattan (near ${titleCase(near.geo.name)})`,
    note: `the intersection of ${a} and ${b}`,
    geo: { ...near.geo, lat, lng, label: `${label}, Manhattan`, corner: true },
  };
}

/** "10th Street and Fourth Avenue in Manhattan" → ["10th Street", "Fourth Avenue"], or null. */
function cornerQuery(text: string): [string, string] | null {
  const t = text
    .replace(/^\s*(?:the\s+)?(?:corner|intersection)\s+of\s+/i, "")
    .replace(/(?:,|\s+in)?\s+(?:manhattan|new york(?:,?\s*ny)?|nyc)\b.*$/i, "")
    .trim();
  const parts = t.split(/\s+(?:and|&|at|\/)\s+|\s*[&\/]\s*/i).map((s) => s.trim()).filter(Boolean);
  return parts.length === 2 ? [parts[0], parts[1]] : null;
}

async function findLocations(message: string, x: Extracted = {}): Promise<Candidate[]> {
  const queries = [...new Set([...placeQueries(x), ...addressQueries(message)])].slice(0, 6);
  const addressLookups = queries.flatMap((q) => [geosearch(q), geosearch(`${q}, Manhattan`, 2)]);
  const pair = cornerOf(x);
  const names = [...new Set([...(x.business ? [x.business] : []), ...properNames(message).map((n) => n.value)])];
  const businessLookups = names.slice(0, 4).map(async (n): Promise<Candidate[]> => {
    const lic = await liquorLicenses(n);
    return Promise.all(
      lic.map(async (l) => {
        const [g] = await geosearch(`${l.address}, ${l.zip}`, 1);
        return {
          key: `${titleCase(l.dba)}, ${titleCase(l.address)}`,
          value: g?.value ?? `${l.address}, New York, NY ${l.zip}`,
          note: `business with a NYS liquor license (${l.type}) named "${l.dba}"`,
          geo: g?.geo,
          license: l,
        };
      }),
    );
  });
  const cornerLookup = pair ? corner(...pair).then((c) => (c ? [c] : [])) : Promise.resolve([]);
  const all = (await Promise.all([cornerLookup, intersections(message), ...businessLookups, ...addressLookups])).flat();
  const seen = new Set<string>();
  const unique = all.filter((c) => !seen.has(c.key) && seen.add(c.key));
  const inside = (await withDistrict(unique)).slice(0, 12);
  // A corner is not a tax lot: the nearest building's lot was only borrowed for the district check.
  for (const c of inside) if (c.geo?.corner) { delete c.geo.bbl; delete c.geo.bin; delete c.geo.housenumber; delete c.geo.street; }
  return inside;
}

// ---------- community district boundary ----------

const BOARD_CD = "102"; // Manhattan Community District 2
const BORO_CODE: Record<string, string> = { "1": "MN", "2": "BX", "3": "BK", "4": "QN", "5": "SI" };

const BORO_NAME: Record<string, string> = { "1": "Manhattan", "2": "Bronx", "3": "Brooklyn", "4": "Queens", "5": "Staten Island" };
const BORO_MAIL: Record<string, string> = { "1": "mn", "2": "bx", "3": "bk", "4": "qn", "5": "si" };

/** The community board for a district code like "103" (Manhattan 3). */
function boardFor(cd: string): Board {
  const boro = cd[0], n = Number(cd.slice(1));
  return {
    cd, key: `CB:${cd}`, short: `CB${n}`, name: `CB${n} ${BORO_NAME[boro]}`,
    outside: cd !== BOARD_CD,
    // City-issued board mailboxes follow this pattern (mn03@cb.nyc.gov).
    email: `${BORO_MAIL[boro]}${String(n).padStart(2, "0")}@cb.nyc.gov`,
    url: "https://www.nyc.gov/site/cau/community-boards/community-boards.page",
  };
}

/**
 * Tags each location with its community board, CB2 locations first. Nothing is dropped: an
 * address outside the district still shows, marked as belonging to another board. PLUTO has no
 * rows for condo unit lots, so the district is looked up per tax block (a block never spans two).
 */
async function withDistrict<T extends { geo?: Geo }>(cands: T[]): Promise<T[]> {
  const blockOf = (c: T) => (c.geo?.bbl ? `${BORO_CODE[c.geo.bbl[0]]}:${Number(c.geo.bbl.slice(1, 6))}` : null);
  const blocks = [...new Set(cands.map(blockOf).filter((b): b is string => !!b))];
  if (!blocks.length) return cands;
  const where = blocks.map((b) => { const [boro, block] = b.split(":"); return `(borough='${boro}' AND block='${block}')`; }).join(" OR ");
  try {
    const r = await fetch(`${PLUTO}?$select=borough,block,cd&$group=borough,block,cd&$where=${encodeURIComponent(where)}`, LOOKUP);
    const cd = new Map<string, string>();
    for (const row of (await r.json()) as any[]) if (row.cd) cd.set(`${row.borough}:${row.block}`, row.cd);
    for (const c of cands) {
      const code = cd.get(blockOf(c) ?? "");
      if (code && c.geo) c.geo.board = boardFor(code);
    }
  } catch { /* PLUTO down: locations stay untagged rather than disappear */ }
  const rank = (c: T) => (c.geo?.board ? (c.geo.board.outside ? 1 : 0) : 2);
  return [...cands].sort((x, y) => rank(x) - rank(y));
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

// ---------- the plan: every question for every form, in one request ----------

function pickQuestion(premise: string, label: string, hint: string, cands: Candidate[]) {
  const criteria: Record<string, unknown> = {};
  for (const c of cands) criteria[c.key] = c.note ?? null;
  criteria[NONE] = "None of these is the value; the message does not give it.";
  return {
    type: "choice",
    instructions: { assumption: premise, field: `${label}: ${hint}`, question: "Which option is the value of `field`?" },
    criteria,
  };
}

/**
 * Jev questions about the board's record for a place: which agreed stipulation the complaint is
 * about (for resolutions at the address), and whether each decision nearby is relevant.
 */
// Where a decision's title ends and its clauses start: "Whereas", a lettered or numbered clause, "Therefore…".
const CLAUSE = /^\s*(Whereas|WHEREAS|[A-Z]\.\s|[ivx]+\.\s|\d{1,2}\.\s|Therefore|THEREFORE|Be it|BE IT|Now,? therefore)/;

/** A decision's findings and conditions, one per clause, with the PDF's line wraps joined (as public/js/record.js shows them). */
function clausesOf(text: string | null | undefined): string[] {
  const lines = (text ?? "").replace(/\n\s*Vote:[\s\S]*$/, "").split("\n");
  const start = lines.findIndex((l, i) => i > 0 && CLAUSE.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(start).map((x) => x.trim()).filter(Boolean)) {
    if (CLAUSE.test(l) || !out.length) out.push(l);
    else out[out.length - 1] += ` ${l}`;
  }
  return out.filter((c) => !/^whereas:?$/i.test(c));
}

/** What a complaint can be about in a decision: a license's stipulations, else the decision's own clauses. */
const termsOf = (r: Resolution) => (r.stipulations.length ? r.stipulations : clausesOf(r.text));

function recordQuestions(past: Resolution[], nearby: Resolution[]) {
  const questions: Record<string, unknown> = {};
  // Which stipulation, or which condition of the board's approval, is this complaint about? (the highlighted quote)
  for (const r of past) {
    const terms = termsOf(r);
    if (!terms.length) continue;
    questions[`resolution.${r.id}`] = {
      type: "choice",
      instructions: r.stipulations.length
        ? { context: `In ${r.meeting_date} the business at ${r.address} agreed to these stipulations with Community Board 2.`,
            question: "Which one stipulation does the resident's complaint in `message` most directly say is being broken?" }
        : { context: `On ${r.meeting_date} Community Board 2 decided on: ${r.title}. These are the findings and conditions of its decision.`,
            question: "Which one of these findings or conditions does the resident's complaint in `message` most directly say is not being met or is no longer true?" },
      criteria: { ...Object.fromEntries(terms.map((s) => [s, null])), [NONE]: "The complaint is not about any of these." },
    };
  }

  // Which of the board's decisions on the surrounding blocks bear on this complaint?
  for (const r of nearby) {
    questions[`related.${r.id}`] = {
      type: "noul",
      instructions: {
        decision: `On ${r.meeting_date} Community Board 2's ${r.committee} committee voted on: ${r.title}`,
        question: "Would a resident who wrote `message` find this past board decision relevant: about the same business or building, or about the same kind of issue as the complaint (say, another bar's liquor license for a nightlife noise complaint) on the same street or block? A decision about a different kind of thing that is only nearby, like a street event near a bar, is not relevant.",
      },
    };
  }
  return questions;
}

function buildPlan(message: string, locations: Candidate[], past: Resolution[], nearby: Resolution[], x: Extracted = {}) {
  const questions: Record<string, unknown> = {
    emergency: {
      type: "noul",
      instructions: "Does `message` describe an emergency happening right now that needs police, fire, or an ambulance?",
      criteria: {
        true: "Someone is injured or in immediate danger, a crime or fire is in progress, there is a gas smell, or a medical emergency right now.",
        false: "A broken city thing, a hazard nobody has been hurt by yet, a nuisance, a past event, or an opinion.",
      },
    },
    route: {
      type: "choice",
      instructions: past.length
        ? { question: "Which form should this New York City resident's `message` be filed as? `board_record` lists what Community Board 2 has already decided about the address in the message.",
            rule: "A complaint that a business is breaking conditions the board set for it belongs with the board (cb2), which can hold the business to them, even when it is also a noise problem." }
        : "Which form should this New York City resident's message be filed as?",
      criteria: { ...Object.fromEntries(Object.entries(FORMS).map(([k, f]) => [k, f.route])), call_911: "An emergency happening right now: someone is injured or in immediate danger, a crime or fire in progress, a gas smell, a medical emergency.",
        none: "Not an emergency, a city service request, or a community board issue." },
    },
  };
  const cands: Record<string, Candidate[]> = {};
  const found = Object.fromEntries(Object.entries(FINDERS).map(([k, fn]) => [k, fn(message)]));
  // What Clairic read in the message ("every weekend", "Ronnie Scott's") joins the regex finds.
  const add = (k: string, v: string | undefined, note: string) => {
    if (v && found[k] && !found[k].some((c) => c.key.toLowerCase() === v.toLowerCase())) found[k].unshift({ key: v, value: v, note });
  };
  add("times", x.when, "when it happens, as the message says it");
  add("proper_names", x.business, "the business the message names");

  // A resident says "the bar downstairs"; the board's own record knows which business that is.
  for (const r of past) {
    // Only licenses name a business; the parser's "legal name" for other items can be a title fragment.
    const name = /^SLA|Cannabis/.test(r.committee) ? r.dba || r.legal_name : "";
    if (name && !found.proper_names.some((c) => c.key === name)) {
      found.proper_names.push({ key: name, value: name, note: `the ${r.license_type || "business"} at ${r.address}, reviewed by Community Board 2 on ${r.meeting_date}` });
    }
  }
  Object.assign(questions, recordQuestions(past, nearby));

  // General fields don't depend on the form, so they're asked once.
  for (const f of GENERAL) {
    const qid = `general.${f.id}`;
    const c = f.kind === "location" ? locations : found[f.find!];
    if (c.length) {
      questions[qid] = pickQuestion("The message is a report to the city.", f.label, f.hint!, c);
      cands[qid] = c;
    }
  }

  for (const [key, form] of Object.entries(FORMS)) {
    const premise = `Assume this message is a ${form.name} report (${form.route})`;
    for (const f of form.fields) {
      const qid = `${key}.${f.id}`;
      if (f.kind === "select") {
        questions[qid] = {
          type: "choice",
          instructions: { assumption: premise, field: `${f.label}: ${f.hint}`, question: "Which option fits `field`?" },
          criteria: { ...Object.fromEntries(f.choices!.map((c) => [c, null])), [NOT_STATED]: "The message does not indicate this." },
        };
        cands[qid] = f.choices!.map((c) => ({ key: c, value: c }));
      } else if (f.kind === "committee") {
        questions[qid] = {
          type: "choice",
          instructions: { assumption: premise, question: "Which Community Board 2 committee should review this?" },
          criteria: COMMITTEES,
        };
        cands[qid] = Object.entries(COMMITTEES).map(([k, v]) => ({ key: k, value: k, note: v }));
      } else if (f.kind === "noul") {
        questions[qid] = { type: "noul", instructions: { assumption: premise, question: f.question } };
      } else if (f.kind === "span" && found[f.find!].length) {
        questions[qid] = pickQuestion(premise, f.label, f.hint!, found[f.find!]);
        cands[qid] = found[f.find!];
      }
    }
  }
  const boardRecord = past.map((r) =>
    `${r.meeting_date}: ${r.committee} reviewed the ${r.license_type || "application"} of ${r.dba || r.legal_name} at ${r.address}` +
    (r.stipulations.length ? `; the business agreed to ${r.stipulations.length} stipulations, including: ${r.stipulations.slice(0, 10).join(" | ")}` : ""));
  return { questions, cands, boardRecord };
}

function decodeField(f: FieldSpec, qid: string, answers: Record<string, Answer>, cands: Record<string, Candidate[]>) {
  const out: any = { id: f.id, label: f.label, kind: f.kind, required: !!f.required, sr: f.sr, choices: f.choices, options: [], selected: null, pNone: 1, qid };
  const a = answers[qid];
  if (f.kind === "noul") {
    const p = a?.type === "noul" ? a.noul : 0;
    out.options = [{ label: "Yes", value: true, p }, { label: "No", value: false, p: 1 - p }];
    out.selected = p >= INCLUDE_AT ? 0 : 1;
    out.pNone = 0;
    return out;
  }
  if (a?.type !== "choice") return out;
  const by = new Map((cands[qid] ?? []).map((c) => [c.key, c]));
  out.options = Object.entries(a.probabilities)
    .filter(([k]) => by.has(k))
    .map(([k, p]) => ({ label: k, value: by.get(k)!.value, p, note: by.get(k)!.note, geo: by.get(k)!.geo, license: by.get(k)!.license }))
    .sort((x, y) => y.p - x.p);
  out.pNone = (a.probabilities[NONE] ?? 0) + (a.probabilities[NOT_STATED] ?? 0);
  out.confidence = a.confidence;
  if (out.options.length && (f.kind === "committee" || out.options[0].p >= INCLUDE_AT)) out.selected = 0;
  return out;
}

/** The resolution as the page shows it, with the stipulation Jev tied to the complaint. */
function presentResolution(r: Resolution, answers: Record<string, Answer>) {
  const a = answers[`resolution.${r.id}`];
  // A complaint can touch more than one stipulation (open windows AND music), so keep each that scored.
  const relevant = a?.type === "choice"
    ? Object.entries(a.probabilities)
        .filter(([k, p]) => k !== NONE && p >= 0.15)
        .sort((x, y) => y[1] - x[1])
        .slice(0, 2)
        .map(([text, p]) => ({ index: termsOf(r).indexOf(text), text, p }))
    : [];
  const { bbl, lat, lng, ...rest } = r;
  return { ...rest, relevant };
}

/** Adds each decision's full text from the minutes (the "Whereas" clauses and the resolution), for the "Read the decision" disclosure. */
async function withText(db: D1Database, items: { id: string; text?: string | null }[]) {
  const ids = [...new Set(items.map((x) => x.id))];
  if (!ids.length) return;
  const { results } = await db.prepare(`SELECT id, body FROM resolutions_fts WHERE id IN (${ids.map((_, i) => `?${i + 1}`).join(", ")})`)
    .bind(...ids).all<{ id: string; body: string }>();
  const body = new Map(results.map((r) => [r.id, r.body]));
  for (const x of items) x.text = body.get(x.id) ?? null;
}

/** Past decisions (nearby, or found by search) that Jev judged relevant to the complaint, most relevant first. */
const FOUND_M = 600; // with a place picked, a search hit farther away than this is someone else's neighborhood

function relatedFrom(candidates: Resolution[], geo: Geo | undefined, answers: Record<string, Answer>) {
  return unique(candidates)
    .filter((r) => !geo || !placed(r) || metres(r, geo) <= FOUND_M)
    .map((r) => ({ r, a: answers[`related.${r.id}`] }))
    .filter((x): x is { r: Resolution; a: Answer & { type: "noul" } } => x.a?.type === "noul" && x.a.noul >= INCLUDE_AT)
    .sort((x, y) => y.a.noul - x.a.noul || newestFirst(x.r, y.r))
    // One business can have two items at a meeting (sidewalk and roadway dining), or the same item at two meetings.
    .filter((x, i, all) => all.findIndex((y) => y.r.title === x.r.title || (!!x.r.address && y.r.address === x.r.address && y.r.meeting_iso === x.r.meeting_iso)) === i)
    .slice(0, 3)
    .map(({ r }) => ({ id: r.id, meeting_date: r.meeting_date, committee: r.committee, title: r.title, address: r.address, source: r.source,
      metres: geo && placed(r) ? Math.round(metres(r, geo)) : null }));
}

function decode(answers: Record<string, Answer>, cands: Record<string, Candidate[]>, places: Map<string, Place>, found: Resolution[]) {
  const route = answers.route.type === "choice" ? answers.route.probabilities : {};
  const general = GENERAL.map((f) => decodeField(f, `general.${f.id}`, answers, cands));
  const forms = Object.entries(FORMS)
    .map(([key, form]) => {
      const fields = form.fields.map((f) => decodeField(f, `${key}.${f.id}`, answers, cands));
      const requiredGeneral = ["location", ...(form.contact_required ? ["name", "email"] : [])];
      return { key, name: form.name, agency: form.agency, complaint_type: form.complaint_type, probability: route[key] ?? 0, fields, requiredGeneral };
    })
    .sort((x, y) => y.probability - x.probability);
  // 911 is a route like any other; the separate yes/no check backs it up.
  // Each location option carries the board's past resolutions about that address.
  const loc = general.find((f) => f.id === "location");
  for (const o of loc?.options ?? []) {
    const place = places.get(o.label) ?? NO_PLACE;
    o.resolutions = place.at.map((r) => presentResolution(r, answers));
    o.related = relatedFrom([...place.near, ...found], o.geo, answers);
  }
  // The committee that reviewed this business before is the one that should hear about it again.
  const chosen = loc?.selected != null ? loc.options[loc.selected] : null;
  const prior = chosen?.resolutions?.find((r: any) => r.relevant.length) ?? chosen?.resolutions?.[0]; // the decision the complaint is about, else the newest
  const committee = forms.find((f) => f.key === "cb2")?.fields.find((f) => f.id === "committee");
  // "The bar downstairs" is the business the board has on record at that address.
  if (prior) {
    const name = prior.dba || prior.legal_name;
    for (const form of forms) {
      const biz = form.fields.find((f) => f.id === "business");
      const i = biz?.options.findIndex((o: any) => o.value === name) ?? -1;
      if (biz && i >= 0 && (biz.selected == null || biz.options[biz.selected].p < 0.9)) { biz.selected = i; biz.reason = `On the board's record for ${prior.address}.`; }
    }
  }
  if (prior && committee) {
    const i = committee.options.findIndex((o: any) => o.value === prior.committee);
    if (i >= 0) { committee.selected = i; committee.reason = `${prior.committee} reviewed this address on ${prior.meeting_date}.`; }
  }
  const emergency = Math.max(answers.emergency.type === "noul" ? answers.emergency.noul : 0, route.call_911 ?? 0);
  // With no place picked, the minutes the search found still show.
  return { forms, general, none: route.none ?? 0, emergency, related: relatedFrom(found, undefined, answers) };
}

async function callJev(env: Env, body: unknown): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { authorization: `Bearer ${env.TYPESAFE_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status === 529) && attempt < 3) {
      const ra = Number(r.headers.get("retry-after"));
      await new Promise((res) => setTimeout(res, ra > 0 ? ra * 1000 : 400 * 2 ** attempt));
      continue;
    }
    throw new Error(`Jev ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
}

// ---------- routes ----------

async function route(request: Request, env: Env, track: Track): Promise<Response> {
  if (!env.TYPESAFE_API_KEY) return json({ error: "TYPESAFE_API_KEY is not set" }, 500);
  const { message: raw } = (await request.json()) as { message?: string };
  const message = (raw ?? "").trim().slice(0, 4000);
  if (message.length < 8) return json({ error: "Tell us a bit more first" }, 400);
  const t0 = Date.now();
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", dateStyle: "full" });
  const clairic = await extract(env.AI, message, new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
  const locations = await findLocations(message, clairic.found);
  const lookupMs = Date.now() - t0;
  const [placeList, searched] = await Promise.all([placesFor(env.DB, locations.map((l) => l.geo)), searchMinutes(env.DB, message)]);
  const places = new Map(locations.map((l, i) => [l.key, placeList[i]]));
  const past = unique(placeList.flatMap((p) => p.at)).slice(0, 3);
  const nearby = unique(locations.filter((l) => !l.geo?.board?.outside).flatMap((l) => places.get(l.key)!.near)).slice(0, 10);
  const found = searched.filter((r) => !past.some((x) => x.id === r.id));
  await withText(env.DB, placeList.flatMap((p) => p.at)); // the clauses a complaint can be about
  const { questions, cands, boardRecord } = buildPlan(message, locations, past, unique([...nearby, ...found]), clairic.found);
  let jev;
  const t1 = Date.now();
  try {
    jev = await callJev(env, { model: env.TYPESAFE_MODEL || "jev-latest", state: { message, today, ...(boardRecord.length ? { board_record: boardRecord } : {}) }, questions });
  } catch (e) {
    track({ kind: "error", ms: Date.now() - t0, data: { path: "/api/route", error: (e as Error).message } });
    return json({ error: (e as Error).message }, 502);
  }
  const jevMs = Date.now() - t1;
  const out = decode(jev.answers, cands, places, found);
  const locOptions = out.general.find((f) => f.id === "location")?.options ?? [];
  await withText(env.DB, [...out.related, ...locOptions.flatMap((o: any) => [...(o.resolutions ?? []), ...(o.related ?? [])])]);
  const latencyMs = Date.now() - t0;
  const [top, next] = out.forms;
  const routeId = crypto.randomUUID();
  track({
    kind: "route", route_id: routeId, form: top.key, ms: latencyMs,
    data: {
      p: top.probability, second: next?.key, margin: top.probability - (next?.probability ?? 0), emergency: out.emergency,
      lookupMs, jevMs, chars: message.length, locations: locations.length, candidates: Object.values(cands).flat().length,
      questions: Object.keys(questions).length, clairicMs: clairic.ms, clairic: Object.keys(clairic.found), clairicError: clairic.error, pastAtAddress: past.length, related: out.related.length, model: jev.model, usage: jev.usage,
    },
  });
  return json({ ...out, routeId, jev: { model: jev.model, usage: jev.usage, questions: Object.keys(questions).length, latencyMs, lookupMs },
    clairic: { found: clairic.found, ms: clairic.ms, error: clairic.error } });
}

/**
 * The board's record for a place the person picked themselves (autocomplete or a dot on the map):
 * resolutions at the address with the stipulation the complaint is about, and related decisions nearby.
 */
async function record(request: Request, env: Env, track: Track): Promise<Response> {
  if (!env.TYPESAFE_API_KEY) return json({ error: "TYPESAFE_API_KEY is not set" }, 500);
  const { message: raw, geo } = (await request.json()) as { message?: string; geo?: Geo };
  const message = (raw ?? "").trim().slice(0, 4000);
  if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) return json({ error: "geo is required" }, 400);
  const t0 = Date.now();
  const [[place], searched] = await Promise.all([placesFor(env.DB, [geo]), message.length >= 8 ? searchMinutes(env.DB, message) : []]);
  const past = place.at, found = searched.filter((r) => !past.some((x) => x.id === r.id));
  const candidates = unique([...(geo.board?.outside ? [] : place.near), ...found]);
  await withText(env.DB, past); // the clauses a complaint can be about
  const questions = recordQuestions(past, candidates);
  let answers: Record<string, Answer> = {};
  if (message.length >= 8 && Object.keys(questions).length) {
    try {
      answers = (await callJev(env, { model: env.TYPESAFE_MODEL || "jev-latest", state: { message }, questions })).answers;
    } catch (e) {
      track({ kind: "error", data: { path: "/api/record", error: (e as Error).message } });
    }
  }
  const out = { resolutions: past.map((r) => presentResolution(r, answers)), related: relatedFrom(candidates, geo, answers) };
  await withText(env.DB, [...out.resolutions, ...out.related]);
  track({ kind: "record", ms: Date.now() - t0, data: { resolutions: out.resolutions.length, related: out.related.length, jev: Object.keys(answers).length > 0 } });
  return json(out);
}

async function autocomplete(url: URL): Promise<Response> {
  // GeoSearch sends no CORS headers, so the browser goes through us.
  const text = url.searchParams.get("text") ?? "";
  // GeoSearch can't geocode a corner, so "X and Y" goes to the street centerline first.
  const pair = cornerQuery(text);
  const [hit, r] = await Promise.all([
    pair ? corner(...pair) : null,
    fetch(`${GEOSEARCH}/autocomplete?text=${encodeURIComponent(text)}&${CB2_FOCUS}`),
  ]);
  const seen = new Set<string>();
  const found = ((await r.json()) as any).features.map(featureToCandidate) as Candidate[];
  const out = [...(hit ? [hit] : []), ...found].filter((c: Candidate) => {
    const k = `${c.geo!.lat},${c.geo!.lng}`;
    return !seen.has(k) && seen.add(k);
  });
  const inside = (await withDistrict(out)).slice(0, 6);
  for (const c of inside) if (c.geo?.corner) { delete c.geo.bbl; delete c.geo.bin; delete c.geo.housenumber; delete c.geo.street; }
  return json(inside);
}

/**
 * A dot on the map → the nearest address inside the district. The dot keeps its exact spot
 * (a corner, mid-block); the address is the closest one GeoSearch knows.
 */
async function reverse(url: URL): Promise<Response> {
  const lat = Number(url.searchParams.get("lat")), lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: "lat and lng are required" }, 400);
  const r = await fetch(`${GEOSEARCH}/reverse?point.lat=${lat}&point.lon=${lng}&size=8`);
  const [near] = await withDistrict(((await r.json()) as any).features.map(featureToCandidate).slice(0, 1) as Candidate[]);
  if (!near) return json({ error: "No address near that spot." }, 404);
  return json({ ...near, geo: { ...near.geo, lat, lng } });
}

/** Single-use ephemeral Gemini Live token, so the real key never reaches the browser (as in formspeak). */
async function voiceToken(env: Env, track: Track): Promise<Response> {
  if (!env.GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY is not set" }, 500);
  const now = Date.now();
  const r = await fetch("https://generativelanguage.googleapis.com/v1alpha/auth_tokens", {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ uses: 1, expireTime: new Date(now + 30 * 60e3).toISOString(), newSessionExpireTime: new Date(now + 2 * 60e3).toISOString() }),
  });
  const data = (await r.json()) as { name?: string; error?: { message: string } };
  if (!data.name) {
    track({ kind: "error", data: { path: "/api/token", error: data.error?.message ?? "token mint failed" } });
    return json({ error: data.error?.message ?? "token mint failed" }, 502);
  }
  track({ kind: "voice" });
  return json({ token: data.name });
}

/**
 * Stores the payload in D1 and, if SEND_WEBHOOK_URL is set, forwards it. NYC 311 has no public
 * API for creating requests, so for 311 and agencies the page also hands the person the payload
 * and opens the right portal.
 */
async function send(request: Request, env: Env, track: Track): Promise<Response> {
  const body = (await request.json()) as { destination?: string; payload?: any; message?: string; route?: { id?: string; edited?: string[]; voice?: boolean } };
  const other = /^CB:(\d{3})$/.exec(body.destination ?? "");
  const dest = other ? { label: boardFor(other[1]).name, url: boardFor(other[1]).url, email: boardFor(other[1]).email }
    : (catalog.destinations as Record<string, any>)[body.destination ?? ""];
  if (!dest || !body.payload) return json({ error: "destination and payload are required" }, 400);
  const p = body.payload;
  const row = await env.DB.prepare(
    `INSERT INTO submissions (destination, form, complaint_type, committee, address, bbl, lat, lng, message, payload, resolution_ids)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) RETURNING id`,
  )
    .bind(body.destination, p.form ?? null, p.complaint_type ?? null, p.committee ?? null, p.incident_address ?? null,
      p.bbl ?? null, p.latitude ?? null, p.longitude ?? null, (body.message ?? p.description ?? "").slice(0, 4000), JSON.stringify(p),
      (p.attached_resolutions ?? []).map((r: any) => r.id).join(",") || null)
    .first<{ id: number }>();
  let forwarded: number | null = null;
  if (env.SEND_WEBHOOK_URL) {
    const r = await fetch(env.SEND_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ destination: body.destination, payload: p }) });
    forwarded = r.status;
  }
  track({
    kind: "send", route_id: body.route?.id?.slice(0, 40), form: p.form,
    data: { destination: body.destination, id: row?.id, edited: (body.route?.edited ?? []).slice(0, 50), voice: !!body.route?.voice, forwarded },
  });
  return json({ id: row?.id, forwarded, ...dest });
}

/** A page view from public/js/hit.js: the path and where the visitor came from, never the page's text. */
async function hit(request: Request, track: Track): Promise<Response> {
  const b = (await request.json().catch(() => ({}))) as { path?: string; ref?: string; width?: number };
  let ref: string | null = null;
  try { ref = b.ref ? new URL(b.ref).hostname : null; } catch {}
  const cf = request.cf as { country?: string } | undefined;
  track({ kind: "view", data: { path: String(b.path ?? "").slice(0, 100), ref, width: Number(b.width) || null, country: cf?.country ?? null } });
  return new Response(null, { status: 204 });
}

/** Every field the voice agent may set, as "Label (choice / choice)" lines for its prompt. */
function voiceFields(): string[] {
  const seen = new Map<string, string>();
  for (const f of [...GENERAL, ...Object.values(FORMS).flatMap((x) => x.fields)]) {
    const extra = f.kind === "noul" ? " (yes/no)" : f.kind === "committee" ? ` (${Object.keys(COMMITTEES).join(" / ")})` : f.choices ? ` (${f.choices.join(" / ")})` : "";
    if (!seen.has(f.label)) seen.set(f.label, f.label + extra);
  }
  return [...seen.values()];
}

/**
 * The link-preview video with byte ranges. Static assets answer a Range request with the whole file,
 * and Apple's players (iMessage previews, Safari) won't play a video served that way.
 */
async function video(request: Request, env: Env): Promise<Response> {
  const asset = await env.ASSETS.fetch(new Request(request.url, { method: "GET" }));
  if (!asset.ok) return asset;
  const body = new Uint8Array(await asset.arrayBuffer()), size = body.length;
  const headers = new Headers({ "content-type": "video/mp4", "accept-ranges": "bytes", "cache-control": "public, max-age=3600" });
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (!m || (!m[1] && !m[2])) {
    headers.set("content-length", String(size));
    return new Response(request.method === "HEAD" ? null : body, { headers });
  }
  // "bytes=a-b", "bytes=a-", or the last n bytes ("bytes=-n")
  const start = m[1] ? +m[1] : Math.max(0, size - +m[2]);
  const end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  headers.set("content-range", `bytes ${start}-${end}/${size}`);
  headers.set("content-length", String(end - start + 1));
  return new Response(request.method === "HEAD" ? null : body.slice(start, end + 1), { status: 206, headers });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const track = tracker(env, ctx, request.headers.get("x-session")?.slice(0, 40) ?? null);
    try {
      if (url.pathname === "/api/hit" && request.method === "POST") return await hit(request, track);
      if (url.pathname === "/api/route" && request.method === "POST") return await route(request, env, track);
      if (url.pathname === "/api/geosearch") return await autocomplete(url);
      if (url.pathname === "/api/reverse") return await reverse(url);
      if (url.pathname === "/api/record" && request.method === "POST") return await record(request, env, track);
      if (url.pathname === "/api/history") {
        const lat = Number(url.searchParams.get("lat")), lng = Number(url.searchParams.get("lng"));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: "lat and lng are required" }, 400);
        return json(await history({ bbl: url.searchParams.get("bbl") ?? undefined, lat, lng }));
      }
      if (url.pathname === "/api/token" && request.method === "POST") return await voiceToken(env, track);
      if (url.pathname === "/api/send" && request.method === "POST") return await send(request, env, track);
      if (url.pathname === "/api/config")
        return json({ mapboxToken: env.MAPBOX_TOKEN ?? "", destinations: catalog.destinations, committees: COMMITTEES, voice: !!env.GEMINI_API_KEY, voiceFields: voiceFields() });
    } catch (e) {
      track({ kind: "error", data: { path: url.pathname, error: (e as Error).message } });
      return json({ error: (e as Error).message }, 500);
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    if (url.pathname.endsWith(".mp4")) return await video(request, env);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
