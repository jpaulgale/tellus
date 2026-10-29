// Payload (shaped like a row of NYC Open Data's 311 Service Requests, erm6-fihm), the
// required-field check, and the send / hand-off panel.

import { h, esc, api, announce } from "./util.js";
import { isEmpty, invalidReason } from "./fields.js";

const GENERAL_SR = { when: "when_observed", name: "resident_name", email: "resident_email", phone: "resident_phone" };

/** Where a form goes unless the person changes it. `board` is set when the address is outside CB2. */
export function defaultDestinations(form, board) {
  const cb = board?.key ?? "CB2";
  if (form.key === "cb2") return [cb];
  if (form.key === "crossing_guard") return [cb, "NYPD"]; // the board advocates, the precinct assigns the guard
  // Service requests go to the board and to the agency that fixes it (via 311 where that's the intake).
  return [cb, ["NYPD", "DOHMH"].includes(form.agency) ? "311" : form.agency];
}

/** s = { res, form, values, key(scope,id), message, overridden } */
export function buildPayload(s) {
  const { form, res } = s;
  const val = (scope, id) => s.values[`${scope}.${id}`] ?? null;
  const loc = val("general", "location");
  const g = loc?.geo || {};
  const p = {
    form: form.key, agency: form.agency, complaint_type: form.complaint_type,
    descriptor: null, location_type: null,
    incident_address: loc?.text ?? null, incident_zip: g.zip ?? null,
    borough: g.borough ? g.borough.toUpperCase() : null, bbl: g.bbl ?? null,
    latitude: g.lat ?? null, longitude: g.lng ?? null,
    cross_street_1: null, cross_street_2: null,
    community_board: g.board ? `${g.board.cd.slice(1)} ${g.board.name.split(" Community")[0].toUpperCase()}` : "02 MANHATTAN",
  };
  if (form.key === "cb2" && !g.board?.outside) p.committee = val(form.key, "committee");
  Object.assign(p, { description: s.message, resident_name: null, resident_email: null, resident_phone: null, when_observed: null, extra: {} });
  for (const [id, col] of Object.entries(GENERAL_SR)) p[col] = val("general", id);
  if (loc?.license) p.extra.business_license = loc.license;
  // Past resolutions about this address ride along so the committee has them at its next meeting.
  if (form.key === "cb2" && loc?.resolutions?.length) {
    p.attached_resolutions = loc.resolutions.map((r) => ({
      id: r.id, meeting_date: r.meeting_date, committee: r.committee, title: r.title, vote: r.vote, source: r.source,
      relevant_stipulations: (r.relevant ?? []).map((x) => x.text),
    }));
  }
  if (form.key === "cb2" && loc?.related?.length) {
    p.related_minutes = loc.related.map(({ id, meeting_date, committee, title, source }) => ({ id, meeting_date, committee, title, source }));
  }
  for (const f of form.fields) {
    if (f.kind === "committee") continue;
    const v = val(form.key, f.id);
    if (f.sr) p[f.sr] = v;
    else if (v != null) p.extra[f.id] = v;
  }
  const top = res.forms[0];
  p.jev = { suggested_form: top.key, confidence: Math.round(top.probability * 100) / 100, overridden: form.key !== top.key };
  return p;
}

/**
 * The email the resident sends from their own mail app: a short letter in their voice, the details
 * as "Label: value" lines, signed with their contact info. Plain text, since a mailto: link can't
 * carry HTML; empty fields are left out. `others` names the other places it went.
 */
export function emailBody(s, p, others = []) {
  const v = (scope, id) => {
    const x = s.values[`${scope}.${id}`];
    return x === true ? "Yes" : x === false ? "No" : typeof x === "object" ? x?.text : x;
  };
  // The form's labels speak to the resident, which is also who's writing.
  const label = (f) => ({ relation: "I am a" })[f.id] ?? f.label;
  const contact = ["name", "email", "phone"];
  const details = [
    ...s.res.general.filter((f) => f.kind !== "location" && !contact.includes(f.id)).map((f) => [label(f), v("general", f.id)]),
    ...s.form.fields.filter((f) => f.kind !== "committee").map((f) => [label(f), v(s.form.key, f.id)]),
  ].filter(([, x]) => x != null && x !== "");
  const where = [p.incident_address, p.borough && `${p.borough.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}${p.incident_zip ? ` ${p.incident_zip}` : ""}`].filter(Boolean).join(", ");
  const resolutions = p.attached_resolutions ?? [];
  return [
    "Hello,", "",
    `I'm writing with a ${p.complaint_type} request${where ? ` about ${where}` : ""}.`, "",
    s.message?.trim(), "",
    "Details:",
    `Address: ${p.incident_address ?? "not given"}`,
    ...(p.cross_street_1 ? [`Cross streets: ${[p.cross_street_1, p.cross_street_2].filter(Boolean).join(" & ")}`] : []),
    ...(p.latitude != null ? [`Map: https://www.google.com/maps?q=${p.latitude},${p.longitude}`] : []),
    ...details.map(([k, x]) => `${k}: ${x}`), "",
    ...(resolutions.length ? ["The board has decided on this address before:",
      ...resolutions.map((r) => `- ${r.meeting_date}, ${r.committee}: ${r.title}${r.vote ? ` (${r.vote})` : ""}${r.source ? `\n  ${r.source}` : ""}`), ""] : []),
    ...(others.length ? [`I've also sent this to ${others.length > 1 ? `${others.slice(0, -1).join(", ")} and ${others.at(-1)}` : others[0]}.`, ""] : []),
    "Thank you,",
    ...contact.map((id) => v("general", id)).filter(Boolean),
  ].filter((line) => line != null).join("\n");
}

/** Filled-in fields whose value doesn't validate (a malformed email or phone). */
export function invalidFields(s) {
  const out = [];
  for (const [scope, fields] of [["general", s.res.general], [s.form.key, s.form.fields]])
    for (const f of fields) {
      const why = invalidReason(f, s.values[`${scope}.${f.id}`]);
      if (why) out.push({ f, key: `${scope}.${f.id}`, why });
    }
  return out;
}

export function missingRequired(s) {
  const out = [];
  for (const [scope, fields] of [["general", s.res.general], [s.form.key, s.form.fields]])
    for (const f of fields) if (f.required && isEmpty(s.values[`${scope}.${f.id}`])) out.push({ f, key: `${scope}.${f.id}` });
  return out;
}

/** Renders into `root`; getState() is called on every action so it always sees the latest edits. */
export function renderSendPanel(root, getState, destinations) {
  const s = getState();
  const errBox = h("div.nyc-errorsummary", { role: "alert", tabindex: "-1", hidden: true });
  const result = h("div.sendresult");
  // Any number of destinations; NYPD is always there to add by hand.
  const picked = new Set(s.destination);
  const options = [...(s.board ? [[s.board.key, s.board.name]] : []), ...Object.entries(destinations).map(([k, d]) => [k, d.label])];
  const toggle = (k, el) => {
    picked.has(k) ? picked.delete(k) : picked.add(k);
    el.classList.toggle("on", picked.has(k)); el.setAttribute("aria-pressed", String(picked.has(k)));
    getState().setDestination([...picked]);
    btn.textContent = sendLabel();
  };
  const destBox = h("div.chips.dests", { id: "destSel", role: "group", "aria-label": "Send to" },
    options.map(([k, label]) => h("button.chip" + (picked.has(k) ? ".on" : ""), { type: "button", "aria-pressed": String(picked.has(k)), "data-dest": k,
      onclick: (e) => toggle(k, e.currentTarget) }, label)));
  const SHORT = { "311": "311", CB2: "CB2", DOT: "DOT", NYPD: "NYPD", DSNY: "DSNY", DOHMH: "the Health Department" };
  const sendLabel = () => {
    const names = options.filter(([k]) => picked.has(k)).map(([k]) => (k === s.board?.key ? s.board.short : SHORT[k] ?? k));
    if (!names.length) return "Submit";
    return `Submit to ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]}`;
  };
  async function send() {
    const st = getState();
    const missing = [...missingRequired(st), ...invalidFields(st)];
    document.querySelectorAll(".ff.invalid").forEach((el) => el.classList.remove("invalid"));
    if (missing.length) {
      errBox.hidden = false;
      errBox.replaceChildren(
        h("p.nyc-errorsummary__title", "Fill in before sending:"),
        h("ul.nyc-errorsummary__list", missing.map(({ f, key, why }) => {
          const ffId = `ff-${key.replace(/\W/g, "-")}`;
          document.getElementById(ffId)?.classList.add("invalid");
          return h("li", h("a", { href: `#${ffId}`, onclick: (e) => { e.preventDefault(); const el = document.getElementById(ffId); el?.scrollIntoView({ block: "center" }); el?.querySelector("input,button")?.focus({ preventScroll: true }); } }, why ? `${f.label}: ${why}` : f.label));
        })));
      errBox.focus();
      return;
    }
    if (!picked.size) {
      errBox.hidden = false;
      errBox.replaceChildren(h("p.nyc-errorsummary__title", "Pick at least one place to send this."));
      errBox.focus();
      return;
    }
    errBox.hidden = true;
    const payload = buildPayload(st);
    payload.sent_to = [...picked];
    btn.disabled = true; btn.textContent = "Submitting…";
    try {
      const sent = [];
      for (const d of picked) sent.push(await api("/api/send", { destination: d, payload, message: st.message, route: { id: st.res?.routeId, edited: [...st.touched], voice: !!st.voice } }));
      const r = sent[0];
      const text = JSON.stringify(payload, null, 2);
      const keys = [...picked];
      const name = (k) => (k === s.board?.key ? s.board.short : SHORT[k] ?? k);
      const mailto = (x, i) => `mailto:${x.email}?subject=${encodeURIComponent(`${payload.complaint_type} – ${payload.incident_address ?? "CB2"}`)}&body=${encodeURIComponent(emailBody(st, payload, keys.filter((_, j) => j !== i).map(name)))}`;
      result.replaceChildren(
        h("div.nyc-inlinemessage.nyc-inlinemessage--success", { role: "status" },
          h("span.nyc-inlinemessage__icon", "✓"),
          h("span.nyc-inlinemessage__text", { html:
            `Saved ${sent.map((x) => `#${esc(x.id)} for ${esc(x.label)}`).join(" and ")}. ` +
            (payload.attached_resolutions?.length ? `The ${esc(payload.attached_resolutions[0].meeting_date)} resolution is attached for the ${esc(payload.committee)} committee's next meeting. ` : "") +
            `This demo can't file it for you, so copy the details and submit them at each place.` })),
        h("div.handoff",
          h("button.chip", { type: "button", onclick: async (e) => { await navigator.clipboard.writeText(text); e.target.textContent = "Copied"; } }, "Copy payload"),
          sent.map((x) => h("a.chip", { href: x.url, target: "_blank", rel: "noopener" }, `Open ${x.label} ↗`)),
          sent.map((x, i) => x.email && h("a.chip", { href: mailto(x, i) }, `Email ${x.email}`))));
      announce(`Saved for ${sent.length} ${sent.length > 1 ? "places" : "place"}`);
      btn.textContent = sendLabel();
    } catch (e) {
      result.replaceChildren(h("div.nyc-inlinemessage.nyc-inlinemessage--error", h("span.nyc-inlinemessage__icon", "!"), h("span.nyc-inlinemessage__text", e.message)));
      btn.textContent = sendLabel();
    } finally {
      btn.disabled = false;
    }
  }

  const btn = h("button.ff-submit.nyc-button", { type: "button", onclick: send }, sendLabel());
  root.replaceChildren(
    errBox,
    h("div.ff", h("div.ff-top", h("span.ff-lab", "Send to"), h("span.ff-lab-opt", "pick any")), destBox),
    h("p.fieldhint.demo-send", "Demo: nothing is sent to 311 or the board. Tell Us saves a copy and gives you the filled-in details to submit yourself."),
    btn,
    result,
  );
}
