// The board's record for a place, shared by the resident form and the board view: everything the
// board decided about one address at one meeting goes in one card. The minutes sometimes hold several
// items for a place (a sidewalk and a roadway application, a Landmarks review and its recommendation
// to DOT), and they read better together than repeated as separate cards and related decisions.

/** "232 W. 11th St." and "232 WEST 11 STREET, Manhattan" both become "232 w 11 st". */
export const normAddress = (a) => (a ?? "").toLowerCase().replace(/, (manhattan|new york.*)$/, "").replace(/\./g, "").replace(/(\d)(st|nd|rd|th)\b/g, "$1")
  .replace(/\bwest\b/g, "w").replace(/\beast\b/g, "e").replace(/\bstreet\b/g, "st").replace(/\bavenue\b/g, "ave").replace(/\s+/g, " ").trim();

export const cleanTitle = (t) => t.replace(/^\*\s*/, "").trim();

/** "this address" when the resolution is about the place itself, else "a neighboring address". */
export const whichAddress = (r, here) => (normAddress(r.address) === here ? "this address" : "a neighboring address");

/** A companion item often repeats the main one's description; keep only what's new ("A recommendation to … for Revocable Consent"). */
export function alsoTitle(x, main) {
  const what = cleanTitle(main.title).replace(/\.$/, "");
  return cleanTitle(x.title).replace(what, "").replace(main.address ?? "", "").replace(/[\s–.-]+$/, "").trim() || cleanTitle(x.title);
}

/**
 * Resolutions grouped by meeting and address (this address first, then neighbors), and the related
 * decisions that aren't already in a group. Each group is [main, ...also].
 */
export function groupRecord(resolutions, related, here) {
  const key = (x) => `${x.meeting_date}|${normAddress(x.address)}`;
  const groups = new Map();
  for (const x of resolutions) groups.set(key(x), [...(groups.get(key(x)) ?? []), x]);
  const rest = [];
  for (const x of related) (groups.get(key(x)) ?? rest).push(x);
  const atHere = (g) => (normAddress(g[0].address) === here ? 0 : 1);
  return { groups: [...groups.values()].sort((a, b) => atHere(a) - atHere(b)), rest };
}

// Where the title ends and the decision starts: "Whereas", a lettered or numbered clause, "Therefore…".
const CLAUSE = /^\s*(Whereas|WHEREAS|[A-Z]\.\s|[ivx]+\.\s|\d{1,2}\.\s|Therefore|THEREFORE|Be it|BE IT|Now,? therefore)/;

/**
 * The decision as the minutes word it, one paragraph per clause, without the title and vote the card
 * already shows. None for a liquor license, whose card lists its stipulations instead.
 */
export function decisionText(r) {
  if (!r.text || r.stipulations?.length) return null;
  const lines = r.text.replace(/\n\s*Vote:[\s\S]*$/, "").split("\n");
  const start = lines.findIndex((l, i) => i > 0 && CLAUSE.test(l));
  if (start < 0) return null;
  const paras = [];
  for (const l of lines.slice(start).map((x) => x.trim()).filter(Boolean)) {
    if (CLAUSE.test(l) || !paras.length) paras.push(l);
    else paras[paras.length - 1] += ` ${l}`; // the PDF's line wraps
  }
  return paras;
}

/** Each decision in a group that has wording to show, labeled when there's more than one: [{ label, paras }]. */
export function groupDecisions([main, ...also]) {
  const all = [{ label: `${main.committee} resolution`, paras: decisionText(main) }, ...also.map((x) => ({ label: alsoTitle(x, main), paras: decisionText(x) }))];
  const shown = all.filter((d) => d.paras);
  return shown.length > 1 ? shown : shown.map((d) => ({ ...d, label: null }));
}

/** The "be it resolved…" part of a decision, on one line; null when the minutes give only a title and a vote. */
export function resolvedClause(r) {
  const t = (r.text ?? "").replace(/\n\s*Vote:[\s\S]*$/, "");
  const at = t.search(/be it resolved|resolved\s*[,:]?\s*(that|community board|manhattan|cb ?#?2)/i); // not "…had not yet been resolved" in a Whereas
  return at < 0 ? null : t.slice(at).replace(/\s+/g, " ");
}

// Wording that every street-activity approval carries; it isn't a condition the board set.
const BOILERPLATE = /provided that the (applicant|application) (conforms?|complies) with all applicable laws, rules, regulations,? and clearance requirements/g;
const APPROVE = /recommends?\s*:?\s*(?:[a-z0-9][.)]\s*)?(?:the )?approval|(?:^|[\s:;])[a-z0-9][.)]\s*approval\b|recommends that .{0,80}be approved|\bapproves\b|consent be (given|granted)/;
const DENY = /recommends?\s*:?\s*(?:[a-z0-9][.)]\s*)?(?:the )?denial|(?:^|[\s:;])[a-z0-9][.)]\s*denial\b|\bbe denied\b|\bopposes\b|in opposition|\(denial\)|denying this application/;
const SUPPORT = /\bsupports\b|in support of|\bwelcomes\b/;
const REQUEST = /\b(urges|requests|calls (?:up)?on|calls for|encourages|asks|insists|advocates)\b|recommends (that|to)\b|makes the following recommendations/;
const CONDITION = /\bprovided\b|\bconditions?\b|\bsubject to\b|\bso long as\b|\bstipulations?\b/;
const at = (re, c) => { const m = re.exec(c); return m ? m.index : Infinity; };

/**
 * What the board decided, read from the resolved clause (not the "Whereas" clauses, which often
 * mention earlier approvals or denials): { key, label }, or null when the minutes don't say.
 */
export function outcomeOf(r) {
  const c = resolvedClause(r)?.toLowerCase().replace(BOILERPLATE, "");
  if (!c) return null;
  if (/laid over|withdrawn|did not appear|deny any type of proposed/.test(c) || /laid over, withdrawn/i.test(r.title))
    return { key: "laidover", label: "Laid over or withdrawn" };
  const approve = APPROVE.test(c), deny = DENY.test(c);
  // The liquor-license form: "recommends denial … unless" the stipulations go into the license.
  if (/recommends?\s+denial[^;]*?\bunless\b/.test(c)) return { key: "conditions", label: "Approval only with conditions" };
  if (approve && deny) return { key: "mixed", label: "Part approved, part denied" };
  if (deny) return { key: "deny", label: "Denial recommended" };
  if (approve) return CONDITION.test(c) ? { key: "conditions", label: "Approval with conditions" } : { key: "approve", label: "Approval recommended" };
  // Policy resolutions: whichever the board says first, that it supports something or asks for something.
  const support = at(SUPPORT, c), request = at(REQUEST, c);
  if (support < request) return { key: "support", label: "Supports" };
  if (request < Infinity) return { key: "request", label: "Asks an agency to act" };
  return null;
}

// The agency each committee's recommendations go to: the board advises, the agency decides.
const COMMITTEE_AGENCY = {
  "SLA – 1": "State Liquor Authority", "SLA – 2": "State Liquor Authority", "Cannabis Licensing Committee": "Office of Cannabis Management",
  "Landmarks & Public Aesthetics": "Landmarks Preservation Commission", "Street Activities & Resiliency": "Street Activity Permit Office",
  "Traffic & Transportation": "DOT", "Parks & Waterfront": "Parks Department", "Schools & Education": "Department of Education",
};
const NAMED_AGENCY = [
  ["DOT", /\bdot\b|department of transportation|dining out nyc|revocable consent/i], ["State Liquor Authority", /\bn\.?y\.?s\.?l\.?a\b|state liquor authority/i],
  ["Landmarks Preservation Commission", /\blpc\b|landmarks preservation commission/i], ["Office of Cannabis Management", /\bocm\b|office of cannabis management/i],
  ["Board of Standards and Appeals", /\bbsa\b|board of standards/i], ["City Planning", /city planning|\bdcp\b|\bcpc\b/i], ["Parks Department", /\bdpr\b|department of parks|parks (department|and recreation)/i],
  ["HPD", /\bhpd\b|housing preservation/i], ["MTA", /\bmta\b/i], ["Department of Buildings", /\bdob\b|department of buildings/i],
  ["Sanitation (DSNY)", /\bdsny\b|department of sanitation/i], ["NYPD", /\bnypd\b/i], ["Department of Health", /\bdohmh\b|department of health/i], ["Department of Education", /\bdoe\b|department of education/i],
];

// Sidewalk and roadway seating (Dining Out NYC) and revocable consents for the sidewalk are DOT's.
const DOT_ITEM = /dining out nyc|donyc|revocable consent|\((roadway|sidewalk)\)|recommends to the department of transportation/i;

/**
 * Who acts on the board's recommendation. A licensing or permit committee's items go to its agency
 * (and DOT for sidewalk seating or fixtures); other committees' resolutions go to the agencies their
 * resolved clause names, since a clause like "calls upon the Department of Health" is addressed to it.
 */
export function agenciesOf(r) {
  const said = `${r.title} ${resolvedClause(r) ?? ""}`;
  if (/recommends to the department of transportation/i.test(said)) return ["DOT"]; // a separate item addressed to DOT alone
  const out = new Set(COMMITTEE_AGENCY[r.committee] ? [COMMITTEE_AGENCY[r.committee]] : []);
  if (DOT_ITEM.test(said)) out.add("DOT");
  if (!/^SLA|Cannabis|Landmarks|Street Activities/.test(r.committee))
    for (const [name, re] of NAMED_AGENCY) if (re.test(said)) out.add(name);
  return [...out];
}

/**
 * One card's content, the same for the resident form and the board view: the outcome first, who acts
 * on it, the condition or stipulation the complaint bears on, then the rest on demand.
 */
export function cardModel(group, here) {
  const [r, ...also] = group;
  // The clause the complaint is most about, and a second only when the match is about as strong.
  const hits = group.flatMap((x) => (x.relevant ?? []).map((s) => ({ ...s, x }))).sort((a, b) => b.p - a.p)
    .filter((s, i) => i === 0 || s.p >= 0.5).slice(0, 2);
  const flagged = new Set(hits.map((s) => s.text));
  const mark = (text) => ({ text, flagged: flagged.has(text) });
  return {
    atHere: normAddress(r.address) === here,
    address: r.address, place: whichAddress(r, here), date: r.meeting_date,
    outcome: outcomeOf(r),
    path: `${r.committee} → Full Board`, vote: r.vote?.replace(/\.$/, "") ?? null,
    business: /^SLA|Cannabis/.test(r.committee) ? [r.dba || r.legal_name, r.license_type].filter(Boolean).join(" · ") : "", // licenses only
    what: r.stipulations.length ? null : cleanTitle(r.title),
    who: [...new Set(group.flatMap(agenciesOf))],
    flags: hits.map(({ text, index, x }) => ({
      text: text.replace(/[;:,]?\s*\b(and|now)\.?$/i, ""), // "…clearance for pedestrians: now" reads oddly out of its list
      agencies: agenciesOf(x),
      from: x.stipulations.length ? `Stipulation ${index + 1} of ${x.stipulations.length} the business agreed to`
        : x === r ? "From the board's decision" : `From the ${alsoTitle(x, r).replace(/^An? /, "")}`,
    })),
    stipulations: r.stipulations.map(mark),
    also: also.map((x) => ({ title: alsoTitle(x, r), outcome: outcomeOf(x) })),
    decisions: groupDecisions(group).map((d) => ({ label: d.label, paras: d.paras.map(mark) })),
    source: r.source,
  };
}
