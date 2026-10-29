// Location field: Jev's pick (or a one-tap "Did you mean…?"), other matches, NYC GeoSearch
// autocomplete, a Mapbox map with a pin, borough · ZIP · BBL, and a liquor-license card.

import { h, esc, api } from "./util.js";
import { normAddress, groupRecord, cardModel } from "./record.js";

const MAPBOX_JS = "https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.js";
const MAPBOX_CSS = "https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.css";
const SUGGEST_AT = 0.1; // below 50% Jev doesn't fill it, but above this we ask "Did you mean…?"

let token = "";
export const setMapboxToken = (t) => (token = t);

// One map, reused across re-renders (moving its container keeps it alive).
const mapBox = h("div.mapbox", { role: "application", "aria-label": "Map: tap to place the dot, or drag it" });
let map = null, marker = null, mapLoading = null;

function loadMapbox() {
  if (mapLoading) return mapLoading;
  document.head.append(h("link", { rel: "stylesheet", href: MAPBOX_CSS }));
  mapLoading = new Promise((res, rej) => {
    const s = h("script", { src: MAPBOX_JS, onload: res, onerror: () => rej(new Error("Mapbox failed to load")) });
    document.head.append(s);
  });
  return mapLoading;
}

const CB2_CENTER = [-74.0005, 40.7265];
let onDot = null;   // set by the latest render: (lat, lng) => resolve the dot to an address

/** Shows the map; with no geo it opens on the district so the person can place the dot. */
async function showMap(geo) {
  if (!token) return;
  await loadMapbox();
  const at = geo ? [geo.lng, geo.lat] : CB2_CENTER;
  if (!map) {
    window.mapboxgl.accessToken = token;
    map = new window.mapboxgl.Map({ container: mapBox, style: "mapbox://styles/mapbox/streets-v12", center: at, zoom: geo ? 16 : 13.5, attributionControl: false, cooperativeGestures: true });
    map.addControl(new window.mapboxgl.AttributionControl({ compact: true }));
    marker = new window.mapboxgl.Marker({ color: "#103FEF", draggable: true });
    marker.on("dragend", () => { const p = marker.getLngLat(); onDot?.(p.lat, p.lng); });
    map.on("click", (e) => { marker.setLngLat(e.lngLat).addTo(map); onDot?.(e.lngLat.lat, e.lngLat.lng); });
  } else {
    map.resize();
    if (geo) map.flyTo({ center: at, zoom: Math.max(map.getZoom(), 16), duration: 600 });
  }
  if (geo) marker.setLngLat(at).addTo(map);
  else marker.remove();
}

const sameAs = (v, o) => v && (v.text === o.value || v.label === o.label);
const optValue = (o) => ({ text: o.value, label: o.label, geo: o.geo ?? null, license: o.license ?? null, resolutions: o.resolutions ?? [], related: o.related ?? [] });

/**
 * What a resident needs from the board's record: that the board has dealt with this place, and the
 * one condition their complaint is about. The full record (outcomes, agencies, neighbors, related
 * decisions) is for the board, on its dashboard; all of it still goes with the submission.
 */
function boardNote(cards) {
  // The decision the complaint matches, else the newest the board actually made (not one laid over or withdrawn).
  const m = cards.find((c) => c.flags.length) ?? cards.find((c) => c.outcome && c.outcome.key !== "laidover");
  if (!m) return null;
  const flag = m.flags[0];
  return h("div.rescard.resnote",
    h("p.rescard-eyebrow", "The board has seen this place before"),
    flag ? [h("p.rescard-title", `On ${m.date}, the board set conditions for this address. Your complaint matches one of them:`),
            h("blockquote.resquote", h("mark", flag.text))]
      : h("p.rescard-title", `The board reviewed this address on ${m.date}.`),
    // The rest of what the board set, a tap away: another rule may be broken too.
    m.stipulations.length ? h("details.resall", h("summary", `See all ${m.stipulations.length} conditions`),
      h("ol", m.stipulations.map((t) => h("li", t.flagged ? h("mark", t.text) : t.text))))
      : m.decisions.length ? h("details.resall", h("summary", "See the board's full decision"),
        m.decisions.map((d) => [d.label ? h("p.decision-label", d.label) : null, d.paras.map((t) => h("p", t.flagged ? h("mark", t.text) : t.text))])) : null,
    h("p.rescard-foot",
      h("span.attach", "Will be attached to your submission"),
      h("a", { href: m.source, target: "_blank", rel: "noopener" }, "Read the minutes ↗")));
}

/**
 * A place the person picked themselves (autocomplete or a dot on the map): set it now, then add the
 * board's record for it once /api/record answers, unless they've moved on to another place by then.
 */
export async function pickPlace(key, value, ctx) {
  ctx.set(key, value, true);
  if (!value.geo) return;
  try {
    const rec = await api("/api/record", { message: ctx.message(), geo: value.geo });
    if (ctx.get(key)?.geo === value.geo) ctx.set(key, { ...value, ...rec }, true);
  } catch { /* the record is a nicety */ }
}

export function renderLocation(field, key, ctx, id) {
  const v = ctx.get(key);
  const touched = ctx.isTouched(key);
  const opts = field.options;

  // Prominent one-tap confirm when Jev found a likely place but wasn't sure enough to fill it.
  const top = opts[0];
  const confirm = !v?.text && !touched && top && top.p >= SUGGEST_AT
    ? h("div.didyoumean",
        h("span", "Did you mean ", h("b", top.label), "?"),
        h("button.chip.on", { type: "button", onclick: () => ctx.set(key, optValue(top), true) }, "Yes, that's it"))
    : null;

  const alts = opts.filter((o) => !sameAs(v, o) && o !== (confirm ? top : null) && o.p >= 0.05).slice(0, 4);
  const altsEl = alts.length
    ? h("div.chips.alts", h("span.alts-lead", v?.text ? "Or did you mean:" : "Other matches:"),
        alts.map((o) => h("button.chip", { type: "button", onclick: () => ctx.set(key, optValue(o), true) }, o.label)))
    : null;

  const input = h("input.ff-input", {
    id, type: "text", value: v?.label && v.label !== v.text ? v.label : v?.text ?? "",
    placeholder: "Address, or the nearest one to the corner", role: "combobox", "aria-autocomplete": "list",
    "aria-expanded": "false", "aria-controls": `${id}-list`,
  });
  const list = h("ul.suggest", { id: `${id}-list`, role: "listbox", hidden: true });
  const hint = h("p.fieldhint", { hidden: true, "aria-live": "polite" },
    "No matching address found.");
  wireSearch(input, list, hint, (c) => pickPlace(key, { text: c.value, label: c.key, geo: c.geo ?? null, license: null }, ctx),
    (text) => ctx.set(key, text.trim() ? { text, geo: null, license: null } : null, false));

  // The dot keeps its exact spot (a corner, mid-block); the address is the nearest one in the district.
  const mapHint = h("p.fieldhint", { "aria-live": "polite" },
    v?.geo ? "Drag the dot or tap the map to move it." : "No address? Tap the map to drop a dot on the corner or block.");
  onDot = async (lat, lng) => {
    try {
      const c = await api(`/api/reverse?lat=${lat}&lng=${lng}`);
      pickPlace(key, { text: c.value, label: `Near ${c.key}`, geo: c.geo, license: null }, ctx);
    } catch (e) {
      mapHint.textContent = e.message || "No address near that spot.";
      if (v?.geo) marker.setLngLat([v.geo.lng, v.geo.lat]); else marker.remove();
    }
  };
  // An address in another district still fills in, with a note that another board handles it.
  const board = v?.geo?.board;
  const outside = board?.outside
    ? h("div.nyc-inlinemessage.nyc-inlinemessage--info.outside", { role: "status" },
        h("span.nyc-inlinemessage__icon", "i"),
        h("span.nyc-inlinemessage__text", h("b", titleCase(v.geo.name || v.text)), ` is in ${board.name}, outside CB2. This will go to ${board.short} instead.`))
    : null;
  let meta = null, card = null;
  if (v?.geo) {
    const g = v.geo;
    meta = h("p.geometa", [g.board?.name ?? g.borough, g.zip && `ZIP ${g.zip}`, g.bbl && `BBL ${g.bbl}`].filter(Boolean).join(" · "));
  }
  queueMicrotask(() => showMap(v?.geo).catch((e) => console.warn(e)));
  if (v?.license) {
    const l = v.license;
    card = h("div.bizcard", { html: `<b>${esc(titleCase(l.dba))}</b><span>NYS liquor license: ${esc(l.type)}, expires ${esc(l.expires)}</span>` });
  }
  const here = normAddress(v?.geo?.name ?? v?.text);
  const { groups } = groupRecord(v?.resolutions ?? [], v?.related ?? [], here);
  const note = boardNote(groups.map((g) => cardModel(g, here)).filter((m) => m.atHere));
  return h("div.loc", confirm,
    h("div.combo", h("div.ff-inputwrap", input), list), hint, outside,
    altsEl, card, mapBox, mapHint, meta, note, v?.geo ? historyCard(v.geo) : null);
}

// What 311 already knows about the place, from NYC Open Data (/api/history). One request per place.
const histories = new Map();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function historyCard(geo) {
  const key = geo.bbl ? `bbl=${geo.bbl}` : `lat=${geo.lat.toFixed(5)}&lng=${geo.lng.toFixed(5)}`;
  if (!histories.has(key)) histories.set(key, api(`/api/history?${key}&lat=${geo.lat}&lng=${geo.lng}`).catch(() => null));
  const box = h("div.histcard", { "aria-live": "polite" });
  histories.get(key).then((hist) => {
    if (!hist) return box.remove();
    const where = geo.bbl ? "this address" : "this corner";
    if (!hist.total) return box.replaceChildren(h("p.histcard-title", `311 has no requests at ${where} in the last year.`));
    const outcome = (t) => Object.entries(t.outcomes).filter(([k]) => k !== "other").sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${hist.labels[k]}`).join(" · ");
    const row = (t) => h("li", h("b", `${t.type}`), h("span", ` ${plural(t.count, "request")}${t.open ? `, ${t.open} still open` : ""}`),
      outcome(t) ? h("small", outcome(t)) : null);
    box.replaceChildren(
      h("p.rescard-eyebrow", "Already reported to 311"),
      h("p.histcard-title", `${plural(hist.total, "request")} at ${where} since ${new Date(hist.since + "T12:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}`),
      h("ul.histlist", hist.types.slice(0, 3).map(row)),
      hist.types.length > 3 ? h("details.resall", h("summary", `${hist.types.length - 3} more kinds of request`), h("ul.histlist", hist.types.slice(3).map(row))) : null,
      h("p.rescard-foot", h("span.histsrc", "How each was closed is the agency's own note, grouped."), h("a", { href: hist.url, target: "_blank", rel: "noopener" }, "Check on NYC Open Data ↗")));
  });
  return box;
}

const titleCase = (s) => String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** GeoSearch autocomplete with arrow keys / Enter / Escape. */
function wireSearch(input, list, hint, onPick, onType) {
  let items = [], active = -1, timer = 0, seq = 0;
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
  const paint = () => {
    list.replaceChildren(...items.map((c, i) => h("li", {
      role: "option", id: `${list.id}-${i}`, "aria-selected": i === active ? "true" : "false",
      onmousedown: (e) => { e.preventDefault(); pick(i); },
    }, h("b", c.key), c.note ? h("span", c.note) : null)));
    list.hidden = !items.length;
    input.setAttribute("aria-expanded", items.length ? "true" : "false");
    if (active >= 0) input.setAttribute("aria-activedescendant", `${list.id}-${active}`);
    else input.removeAttribute("aria-activedescendant");
  };
  const pick = (i) => { const c = items[i]; close(); if (c) onPick(c); };
  input.addEventListener("input", () => {
    onType(input.value);
    clearTimeout(timer);
    const q = input.value.trim();
    hint.hidden = true;
    if (q.length < 3) { items = []; return paint(); }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const r = await api(`/api/geosearch?text=${encodeURIComponent(q)}`);
        if (mine !== seq) return;
        items = r; active = -1; paint();
        hint.hidden = !(r.length === 0 && q.length >= 6);
      } catch { /* search is best-effort */ }
    }, 220);
  });
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { active = (active + 1) % items.length; paint(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = (active - 1 + items.length) % items.length; paint(); e.preventDefault(); }
    else if (e.key === "Enter" && active >= 0) { pick(active); e.preventDefault(); }
    else if (e.key === "Escape") close();
  });
  input.addEventListener("blur", () => setTimeout(close, 100));
}
