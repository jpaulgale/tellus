// Where two streets meet, from the NYC CSCL street centerline. Ported from ev-events' resolve.py
// (via storefront-updater-cf's streetCenterline.ts): GeoSearch can't geocode "Hudson St and
// Christopher St", but centerline segments end at corners, so a node two streets share IS the
// intersection.


import cscl from "./cscl.json";

/** Two endpoints count as the same corner within this many degrees (~12m). Looser starts
 *  joining parallel streets one lot apart. */
const NODE_EPSILON = 0.00015;

/** [lon, lat] */
export type Node = [number, number];

/** CB2 centroid: picks the nearest corner when two streets cross more than once. */
const FOCUS: Node = [-74.0005, 40.7265];

const ORDINAL = /\b(\d+)\s*(?:st|nd|rd|th)\b/gi;

/** CSCL numbers its streets ("6 AVE", "W 4 ST"), so a spelled-out ordinal has to become a numeral. */
const WORD_ORDINAL: Record<string, string> = {
  first: "1", second: "2", third: "3", fourth: "4", fifth: "5", sixth: "6", seventh: "7", eighth: "8",
  ninth: "9", tenth: "10", eleventh: "11", twelfth: "12", thirteenth: "13", fourteenth: "14",
};

const ABBREV: Record<string, string> = {
  street: "ST", streets: "ST", st: "ST", avenue: "AVE", avenues: "AVE", ave: "AVE", av: "AVE",
  place: "PL", pl: "PL", boulevard: "BLVD", blvd: "BLVD", square: "SQ", sq: "SQ",
  east: "E", west: "W", north: "N", south: "S",
};

const STREET_TYPES = new Set(["ST", "AVE", "PL", "BLVD", "SQ", "LOOP", "ROW", "PKWY"]);

/** Normalize to CSCL's `stname_label` style: "West 4th Street" → "W 4 ST". */
export function csclStreetName(street: string): string {
  return street
    .replace(/['‘’]/g, "")
    .replace(ORDINAL, "$1")
    .replace(/\./g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => WORD_ORDINAL[w.toLowerCase()] ?? ABBREV[w.toLowerCase()] ?? w.toUpperCase())
    .join(" ");
}

/**
 * Labels to try, in groups; the first group with any segments wins. People drop the type
 * ("Houston and Lafayette") and the compass prefix ("Houston St" is E HOUSTON ST and
 * W HOUSTON ST in CSCL), and this district spans both sides, so the E and W forms are one group.
 */
export function csclCandidates(street: string): string[][] {
  const base = csclStreetName(street);
  if (!base) return [];
  const words = base.split(" ");
  if (words[0] === "AVE" || words[0] === "AVENUE") return [[base]]; // "AVENUE A" is already complete
  const typed = words.some((w) => STREET_TYPES.has(w));
  const forms = typed ? [base] : [base, `${base} ST`, `${base} AVE`];
  const groups = forms.map((f) => [f]);
  if (words[0] !== "E" && words[0] !== "W") {
    const full = typed ? base : `${base} ST`;
    groups.push([`E ${full}`, `W ${full}`]);
  }
  return groups;
}

// Corner nodes per street label for the area around CB2, bundled by scripts/fetch_centerline.py.
// The live centerline API is intermittently slow, and these never change.
const NODES = cscl as unknown as Record<string, Node[]>;

/** What people call it → what CSCL files it under. */
const ALIAS: Record<string, string> = { "6 AVE": "AVE OF THE AMERICAS", "AVE OF AMERICAS": "AVE OF THE AMERICAS" };

/** Endpoints of a street's centerline segments, i.e. its corners. */
export function streetNodes(street: string): Node[] {
  for (const group of csclCandidates(street)) {
    const nodes = group.flatMap((label) => NODES[ALIAS[label] ?? label] ?? []);
    if (nodes.length) return nodes;
  }
  return [];
}

/** [lon, lat] where two streets meet, or null. */
export function intersectionNode(a: string, b: string): Node | null {
  const na = streetNodes(a), nb = streetNodes(b);
  const hits: Node[] = [];
  for (const [xa, ya] of na) {
    for (const [xb, yb] of nb) {
      if (Math.abs(xa - xb) < NODE_EPSILON && Math.abs(ya - yb) < NODE_EPSILON) hits.push([(xa + xb) / 2, (ya + yb) / 2]);
    }
  }
  if (!hits.length) return null;
  // Two streets can cross more than once (Broadway); take the corner nearest the district.
  const far = (p: Node) => Math.abs(p[0] - FOCUS[0]) + Math.abs(p[1] - FOCUS[1]);
  return hits.reduce((best, p) => (far(p) < far(best) ? p : best));
}
