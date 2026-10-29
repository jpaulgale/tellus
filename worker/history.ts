// What 311 already knows about a place: the last year of service requests there, from NYC Open Data
// (erm2-nwe9), grouped by complaint type with how the agencies closed them (worker/outcomes.json).
// Live, so the counts match what anyone can look up; a slow answer is dropped, not waited on.

import outcomes from "./outcomes.json";

const SR = "https://data.cityofnewyork.us/resource/erm2-nwe9.json";
const CLASSES = outcomes.classes.map((c) => ({ ...c, re: new RegExp(c.pattern, "i") }));
const outcomeOf = (text: string) => CLASSES.find((c) => c.re.test(text))?.key ?? "other";

export interface History {
  since: string; total: number; open: number; url: string;
  types: { type: string; agency: string; count: number; open: number; last: string; outcomes: Record<string, number> }[];
  labels: Record<string, string>;
}

/** A tax lot when there is one; a corner has none, so 40 m around it. */
export async function history(where: { bbl?: string; lat: number; lng: number }, days = 365): Promise<History | null> {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const at = where.bbl && /^\d{10}$/.test(where.bbl) ? `bbl='${where.bbl}'` : `within_circle(location, ${+where.lat}, ${+where.lng}, 40)`;
  const q = `$select=complaint_type,agency,status,resolution_description,created_date&$where=${encodeURIComponent(`${at} AND created_date >= '${since}'`)}&$order=created_date DESC&$limit=2000`;
  let rows: any[];
  try {
    const r = await fetch(`${SR}?${q}`, { signal: AbortSignal.timeout(4000) });
    rows = (await r.json()) as any[];
    if (!Array.isArray(rows)) return null;
  } catch {
    return null;
  }
  const byType = new Map<string, History["types"][number]>();
  for (const x of rows) {
    const t: History["types"][number] = byType.get(x.complaint_type) ?? { type: x.complaint_type, agency: x.agency, count: 0, open: 0, last: x.created_date.slice(0, 10), outcomes: {} };
    t.count++;
    if (x.status !== "Closed") t.open++;
    else { const k = outcomeOf(x.resolution_description ?? ""); t.outcomes[k] = (t.outcomes[k] ?? 0) + 1; }
    byType.set(x.complaint_type, t);
  }
  const types = [...byType.values()].sort((a, b) => b.count - a.count);
  return {
    since, total: rows.length, open: types.reduce((s, t) => s + t.open, 0), types,
    labels: Object.fromEntries(outcomes.classes.map((c) => [c.key, c.label])),
    // The same query on the Open Data portal, so anyone can check the numbers.
    url: `https://data.cityofnewyork.us/resource/erm2-nwe9.json?$where=${encodeURIComponent(`${at} AND created_date >= '${since}'`)}`,
  };
}
