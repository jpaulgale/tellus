// Clairic (Workers AI, @cf/cloudflare/clairic) reads the resident's message once and returns the
// pieces the regex finders miss: a house number and street written without a suffix ("126 W 13th",
// "el 101 de Crosby", "Mott街228号"), a cross street, a named place, the business, and when it happens.
// Its text answers are spans of the message, so like every other finder it only adds candidates;
// GeoSearch checks the place and Jev still picks each field. If Clairic is slow or down, nothing changes.

const FIELDS = {
  house_number: { type: "number", instructions: "The building number of the address where the problem is, if the message gives one." },
  street: {
    type: "text",
    instructions: "The street of that address or place, as written, without the building number and including West/East or W/E before it, without words like street, calle or 街 when they are separate (e.g. 'W 13th', 'Crosby', 'Mott', 'Sexta Avenida').",
  },
  cross_street: { type: "text", instructions: "A second street, when the message names a corner or intersection or says 'between' two streets." },
  place: { type: "text", instructions: "A named place where the problem is, like a park, school, church or building, if the message names one." },
  business: { type: "text", instructions: "The name of the business the complaint is about, if the message names it." },
  when: { type: "text", instructions: "When the problem happens or happened, as written (e.g. 'every weekend', 'until 2am', 'since Tuesday')." },
} as const;

type Field = keyof typeof FIELDS;
export type Extracted = Partial<Record<Field, string>>;

const SURE = 0.5;

export async function extract(ai: Ai | undefined, message: string, today: string): Promise<{ found: Extracted; ms: number; error?: string }> {
  const t0 = Date.now();
  if (!ai) return { found: {}, ms: 0, error: "no AI binding" };
  try {
    const run = ai.run("@cf/cloudflare/clairic" as any, { model: "clairic", state: message, reference_date: today, fields: FIELDS } as any) as Promise<any>;
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Clairic timed out")), 2000));
    const res = await Promise.race([run, timeout]);
    const found: Extracted = {};
    for (const k of Object.keys(FIELDS) as Field[]) {
      const a = res?.answers?.[k];
      if (a?.value == null || a.value === "" || (a.confidence ?? 0) < SURE) continue;
      found[k] = k === "house_number" ? String(Math.round(a.value)) : String(a.value).trim();
    }
    // "117 Avenue A" all read as the street: the number in front is the building number.
    const n = /^(\d{1,5}[A-Z]?)\s+(.+)$/i.exec(found.street ?? "");
    if (n && !found.house_number) [found.house_number, found.street] = [n[1], n[2]];
    if (found.place && found.house_number && found.place === `${found.house_number} ${found.street}`) delete found.place;
    // "325 W 11th" read as street "11th" is 11th Avenue to GeoSearch: keep a direction the message puts right before it.
    for (const k of ["street", "cross_street"] as const) {
      const v = found[k];
      if (!v || /^(?:[NSEW]\.?|north|south|east|west)\s/i.test(v)) continue;
      const m = new RegExp(`\\b((?:[NSEW]\\.?|North|South|East|West)\\s+)${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").exec(message);
      if (m) found[k] = m[1] + v;
    }
    return { found, ms: Date.now() - t0 };
  } catch (e) {
    return { found: {}, ms: Date.now() - t0, error: (e as Error).message };
  }
}

/** GeoSearch queries from what Clairic found: "126 W 13th", and the place by name. */
export function placeQueries(x: Extracted): string[] {
  const qs: string[] = [];
  if (x.house_number && x.street) qs.push(`${x.house_number} ${x.street}`);
  if (x.place) qs.push(x.place);
  return qs;
}

/** A corner Clairic found, as two street names for the centerline lookup. */
export const cornerOf = (x: Extracted): [string, string] | null => (x.street && x.cross_street ? [x.street, x.cross_street] : null);
