// Fill-as-you-type routing (the jev-form-router model) in formspeak's NYC look.
// One /api/route call returns emergency?, every form's probability, and every field of every
// form, so switching forms is instant. Fields the person edited are never overwritten.

import { $, h, api, announce, rankRow } from "./util.js";
import { renderField, jevValue, isEmpty } from "./fields.js";
import { setMapboxToken, pickPlace } from "./location.js";
import { renderSendPanel, defaultDestinations, missingRequired } from "./send.js";
import { toggleMic } from "./voice.js";
import { renderTopics, startTypewriter } from "./suggest.js";

const DEBOUNCE_MS = 650;

const state = {
  config: { committees: {}, destinations: {}, voice: false },
  res: null,          // last applied /api/route response
  message: "",        // the message that response is for
  formKey: null,      // the person's form pick (null = follow Jev)
  values: {},         // "scope.fieldId" -> value  (scope = "general" or a form key)
  touched: new Set(), // keys the person edited; Jev never overwrites these
  open: {},           // which pickers are expanded
  destination: null,  // the person's "Send to" pick
  loading: false, error: "",
};
let sentSeq = 0, appliedSeq = 0, lastSent = "", timer = 0, sendPanel = null;
const fieldsByKey = new Map();
let needKeys = []; // keys of the fields shown in the "Needed" box

/** The community board of the chosen location, when it isn't CB2. */
const otherBoard = () => { const b = state.values["general.location"]?.geo?.board; return b?.outside ? b : null; };
const activeForm = () => state.res && (state.res.forms.find((f) => f.key === state.formKey) ?? state.res.forms[0]);

// ---------- routing ----------

async function route(text) {
  const m = text.trim();
  if (m.length < 8 || m === lastSent) return;
  lastSent = m;
  const seq = ++sentSeq;
  state.loading = true; state.error = ""; renderStatus();
  try {
    const res = await api("/api/route", { message: m });
    if (seq <= appliedSeq) return; // a newer response already landed
    appliedSeq = seq;
    apply(res, m);
  } catch (e) {
    if (seq === sentSeq) { state.error = e.message; lastSent = ""; }
  } finally {
    if (seq === sentSeq) { state.loading = false; renderStatus(); }
  }
}

function apply(res, message) {
  const changed = new Set();
  const take = (scope, f) => {
    const key = `${scope}.${f.id}`;
    if (state.touched.has(key)) return;
    const v = jevValue(f);
    if (JSON.stringify(v) !== JSON.stringify(state.values[key] ?? null)) changed.add(key);
    state.values[key] = v;
  };
  res.general.forEach((f) => take("general", f));
  res.forms.forEach((form) => form.fields.forEach((f) => take(form.key, f)));
  state.res = res; state.message = message;
  render(changed);
}

function schedule() {
  clearTimeout(timer);
  const text = $("message").value;
  $("clearBtn").hidden = !text;
  $("examples").hidden = !!text.trim();
  if (!text.trim()) return reset();
  timer = setTimeout(() => route(text), DEBOUNCE_MS);
}

function reset() {
  Object.assign(state, { res: null, formKey: null, values: {}, touched: new Set(), open: {}, destination: null, error: "" });
  lastSent = ""; appliedSeq = ++sentSeq; state.loading = false;
  render(new Set()); renderStatus();
}

// ---------- rendering ----------

function renderStatus() {
  const el = $("status");
  if (state.loading) el.replaceChildren(h("span.spin"), state.res ? "Updating…" : "Reading…");
  else if (state.error) el.replaceChildren(h("span.err", state.error));
  else if (state.res) el.textContent = "Keep typing to refine, or edit in the form.";
  else el.textContent = "";
}

function message(kind, icon, html) {
  return h(`div.nyc-inlinemessage.nyc-inlinemessage--${kind}`, { role: kind === "error" ? "alert" : "status" },
    h("span.nyc-inlinemessage__icon", { "aria-hidden": "true" }, icon), h("span.nyc-inlinemessage__text", { html }));
}

const CALL_911 = 'This seems like an emergency, not a community board issue. <a href="tel:911">Call 911</a>.';

function render(changed) {
  renderBody(changed);
  $("composer").classList.toggle("compact", !$("routed").hidden);
}

function renderBody(changed) {
  const res = state.res, verdict = $("verdict"), routed = $("routed");
  verdict.replaceChildren();
  if (!res) { routed.hidden = true; return; }
  const top = res.forms[0];
  if (res.emergency >= 0.5 && top.probability < 0.5) {
    siren();
    verdict.append(h("div.route911",
      h("div.siren", { "aria-hidden": "true" }, h("i.siren-l"), h("i.siren-r")),
      h("a.call911", { href: "tel:911" }, "Call 911 now")));
    verdict.append(message("error", "!", CALL_911));
    routed.hidden = true; announce("This seems like an emergency. Call 911.");
    return;
  }
  if (res.none >= 0.5 && top.probability < 0.5) {
    verdict.append(message("info", "i", "This doesn't look like something for a city agency or Community Board 2. Add more detail if it is, like what's broken and where."));
    routed.hidden = true;
    return;
  }
  if (res.emergency >= 0.5) verdict.append(message("error", "!", 'If anyone is in danger right now, <a href="tel:911">call 911</a>. You can still send this report below.'));
  verdict.append(routeLine());
  routed.hidden = false;
  renderForm(changed);
}

function routeLine() {
  const form = activeForm(), top = state.res.forms[0], open = !!state.open.form;
  const mine = form.key !== top.key;
  const board = otherBoard();
  const toggle = h("button.linkbtn", { type: "button", "aria-expanded": String(open),
    onclick: () => { state.open.form = !open; render(new Set()); } }, open ? "Close" : "Not correct? Change where this goes.");
  const list = open ? h("div.ranklist", { role: "listbox", "aria-label": "Forms" }, state.res.forms.map((f) =>
    rankRow({ title: f.name, sub: `${f.agency}${f.key === "cb2" ? "" : ` · 311 “${f.complaint_type}”`}`, on: f.key === form.key,
      tag: f.key === top.key ? "Suggested" : null,
      onPick: () => { state.formKey = f.key === top.key ? null : f.key; state.open.form = false; state.destination = null; render(new Set()); announce(`Switched to ${f.name}`); } }))) : null;
  return h("div.routebox",
    h("p.routeline", "Will be routed to ", h("b", form.key === "cb2" && board ? board.name : form.name),
      form.key === "cb2" ? " · " : ` · ${form.key === "crossing_guard" ? `${board?.short ?? "CB2"} + ` : board ? `${board.short} + ` : ""}${form.agency} · `,
      mine ? h("span.tag", "your choice") : null, " ", toggle),
    mine ? h("p.fieldhint", `We suggested ${top.name}.`) : null,
    board ? h("p.fieldhint.reason", `That address is outside CB2, so this goes to ${board.name}.`) : null,
    list);
}

const ctx = {
  get: (k) => state.values[k] ?? null,
  isTouched: (k) => state.touched.has(k),
  set(k, v, rerender) {
    state.values[k] = v; state.touched.add(k);
    if (k === "cb2.committee") this.rerender("general.location"); // the resolution card names the committee
    if (k === "general.location") { state.destination = null; return render(new Set()); } // the board may have changed
    renderNeeded();
    if (rerender) this.rerender(k);
    else { // keep focus in the input; just update the badge/filled state
      const el = document.querySelector(`.ff[data-key="${CSS.escape(k)}"]`);
      el?.classList.toggle("filled", v != null && v !== "");
      el?.classList.toggle("need", !!fieldsByKey.get(k)?.required && (v == null || v === ""));
      el?.querySelector(".ff-tag")?.replaceWith(h("span.ff-tag.you", "Your edit"));
    }
    sendPanel?.refresh();
  },
  rerender(k) {
    const el = document.querySelector(`.ff[data-key="${CSS.escape(k)}"]`);
    if (el) el.replaceWith(renderField(fieldsByKey.get(k), k, ctx));
  },
  get open() { return state.open; },
  get committees() { return state.config.committees; },
  committeeFor: () => (activeForm()?.key === "cb2" ? state.values["cb2.committee"] : null),
  message: () => $("message").value.trim(),
  relatedFound: () => state.res?.related ?? [], // minutes the search found, for when no place is picked
};

function renderForm(changed) {
  const form = activeForm(), res = state.res, root = $("form");
  const focused = document.activeElement?.closest?.("#form, #needed") ? document.activeElement.id : null;
  const g = Object.fromEntries(res.general.map((f) => [f.id, f]));
  const field = (scope, f) => { const k = `${scope}.${f.id}`; fieldsByKey.set(k, f); return renderField(f, k, ctx); };
  // Which shared fields are required depends on the form (the board needs to reach you; 311 doesn't).
  for (const f of res.general) f.required = (form.requiredGeneral ?? ["location"]).includes(f.id);
  const contactRequired = g.name.required || g.email.required;
  // CB2's committees don't apply to another board's district.
  const board = otherBoard();
  for (const f of form.fields) if (f.kind === "committee") f.required = !board;
  const committee = form.fields.find((f) => f.kind === "committee");
  // Required fields nothing could fill go in the yellow "Needed" box up top, as real fields
  // (the jev-form-router pattern); they stay there while you fill them so nothing jumps.
  needKeys = [];
  const need = [];
  const place = (scope, f) => {
    if (!f) return null;
    const el = field(scope, f);
    if (f.required && isEmpty(jevValue(f))) { needKeys.push(`${scope}.${f.id}`); need.push(el); return null; }
    return el;
  };
  const main = [
    committee && !board ? place(form.key, committee) : null,
    place("general", g.location),
    form.fields.filter((f) => f !== committee).map((f) => place(form.key, f)),
    place("general", g.when),
  ].flat().filter(Boolean);
  const contact = ["name", "email", "phone"].map((id) => place("general", g[id])).filter(Boolean);
  root.replaceChildren(...main,
    ...(contact.length ? [h("h2.subhead", "Your contact info ", h("span.ff-lab-opt", contactRequired ? "so the board can reach you" : "optional")), ...contact] : []));
  $("needed").replaceChildren(h("p.needed-lead"), h("div.needed-grid", need));
  if (focused) $(focused)?.focus();
  for (const k of changed) {
    const el = document.querySelector(`.ff[data-key="${CSS.escape(k)}"]`);
    if (!el) continue;
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 450);
  }
  renderNeeded();
  sendPanel = renderSendPanel($("sendPanel"), () => ({
    ...state, form: activeForm(), board: otherBoard(),
    destination: state.destination ?? defaultDestinations(activeForm(), otherBoard()),
    setDestination: (d) => (state.destination = d),
  }), state.config.destinations);
}

/** The yellow box's heading: what's still missing, or that it's all there. */
function renderNeeded() {
  const box = $("needed"), form = activeForm();
  if (!box || !form || $("routed").hidden || !needKeys.length) { if (box) box.hidden = true; return; }
  box.hidden = false;
  const left = needKeys.filter((k) => isEmpty(state.values[k]));
  box.classList.toggle("done", !left.length);
  const lead = box.querySelector(".needed-lead");
  if (lead) lead.replaceChildren(...(left.length ? [h("span.req", "*"), " Required fields"] : ["All required fields are filled in."]));
}

// ---------- voice ----------

let heard = "";
const formShowing = () => !!state.res && !$("routed").hidden;
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Tool calls from the voice agent: set one field of the form on screen, or add to the description. */
async function voiceTool(name, args) {
  if (name === "add_details") {
    if (!formShowing()) return "ok"; // already captured from the live transcription
    const ta = $("message");
    ta.value = `${ta.value.trim()} ${String(args.text ?? "").trim()}`.trim();
    schedule();
    return "added";
  }
  if (name !== "set_field") return "unknown tool";
  if (!formShowing()) return "no form is showing yet";
  const want = norm(args.field), value = String(args.value ?? "").trim();
  const key = [...fieldsByKey.keys()].find((k) => document.querySelector(`.ff[data-key="${CSS.escape(k)}"]`) && norm(fieldsByKey.get(k).label) === want)
    ?? [...fieldsByKey.keys()].find((k) => document.querySelector(`.ff[data-key="${CSS.escape(k)}"]`) && norm(fieldsByKey.get(k).label).includes(want));
  if (!key) return `this form has no field called ${args.field}`;
  const f = fieldsByKey.get(key);
  const closest = (list) => list.find((c) => norm(c) === norm(value)) ?? list.find((c) => norm(c).includes(norm(value)) || norm(value).includes(norm(c)));
  let v = value;
  if (f.kind === "noul") v = /^(y|true|1)/i.test(value);
  else if (f.kind === "select") { v = closest(f.choices ?? []); if (!v) return `not one of the choices: ${(f.choices ?? []).join(", ")}`; }
  else if (f.kind === "committee") { v = closest(Object.keys(state.config.committees)); if (!v) return "no such committee"; }
  else if (f.kind === "location") {
    const [hit] = await api(`/api/geosearch?text=${encodeURIComponent(value)}`);
    if (!hit) return "no address inside Community Board 2 matched that";
    v = { text: hit.value, label: hit.key, geo: hit.geo ?? null, license: null };
  }
  if (f.kind === "location") pickPlace(key, v, ctx); else ctx.set(key, v, true);
  const el = document.querySelector(`.ff[data-key="${CSS.escape(key)}"]`);
  el?.classList.add("flash"); setTimeout(() => el?.classList.remove("flash"), 900);
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
  announce(`${f.label} set`);
  return "ok";
}

function wireMic() {
  if (!state.config.voice) { $("dock").hidden = true; return; }
  const btn = $("micBtn"), label = $("micLabel"), ring = $("ring");
  btn.addEventListener("click", () => toggleMic({
    fields: state.config.voiceFields ?? [],
    // Before a form is showing, speech is the description. Once it is, speech edits the form
    // through tool calls and the words only show as a caption.
    onText(t) {
      if (t == null) { heard = ""; return; }
      if (formShowing()) { heard += t; $("status").textContent = `Heard: ${heard.trim()}`; return; }
      const ta = $("message");
      ta.value = (ta.value + t).replace(/^\s+/, "").replace(/\s{2,}/g, " ");
      schedule();
    },
    onTool: voiceTool,
    onState(s, msg) {
      const live = s === "listening";
      btn.classList.toggle("listening", live);
      btn.classList.toggle("busy", s === "connecting");
      btn.classList.toggle("idle-pulse", s === "off" && !$("message").value);
      btn.setAttribute("aria-pressed", String(live));
      btn.setAttribute("aria-label", live ? "Stop microphone" : "Start microphone");
      label.textContent = s === "connecting" ? "Connecting…" : live ? "Listening. Tap to stop." : s === "error" ? msg : "Tap to talk";
      if (!live) ring.style.transform = "scale(.6)";
      if (s === "error" || live) announce(label.textContent);
    },
    onLevel(rms) { ring.style.transform = `scale(${0.6 + Math.min(0.6, rms * 6)})`; },
  }));
}

// A three-second siren the first time a message routes to 911: the classic rising and falling
// wail, at a moderate volume. One shared AudioContext, unlocked by the first key press or click,
// so the sound isn't blocked by the browser's autoplay rule.
let audio = null, sirenFor = "";
const unlockAudio = () => {
  audio ??= new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === "suspended") audio.resume();
};
for (const ev of ["keydown", "pointerdown"]) addEventListener(ev, unlockAudio, { passive: true });

function siren() {
  if (sirenFor === state.message) return;
  sirenFor = state.message;
  try {
    unlockAudio();
    const t = audio.currentTime + 0.05, LENGTH = 3, CYCLE = 1; // one up-and-down wail per second
    const osc = audio.createOscillator(), tone = audio.createBiquadFilter(), gain = audio.createGain();
    osc.type = "square";               // a square wave through a low-pass reads as a siren horn
    tone.type = "lowpass"; tone.frequency.value = 1800;
    osc.frequency.setValueAtTime(650, t);
    for (let i = 0; i < LENGTH / CYCLE; i++) {
      osc.frequency.linearRampToValueAtTime(1300, t + i * CYCLE + CYCLE * 0.5);
      osc.frequency.linearRampToValueAtTime(650, t + (i + 1) * CYCLE);
    }
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.09, t + 0.08);   // moderate: clear, not startling
    gain.gain.setValueAtTime(0.09, t + LENGTH - 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + LENGTH);
    osc.connect(tone).connect(gain).connect(audio.destination);
    osc.start(t); osc.stop(t + LENGTH + 0.05);
  } catch { /* sound is a nicety */ }
}

// ---------- boot ----------

async function boot() {
  const ta = $("message");
  // Demo shortcut: "..." (or the … macOS turns it into) in the empty box fills a sample complaint.
  ta.addEventListener("input", () => {
    if (ta.value.trim() === "..." || ta.value.trim() === "…") ta.value = "I noticed a rat on the sidewalk near 171 Broadway";
  });
  ta.addEventListener("input", schedule);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); clearTimeout(timer); lastSent = ""; route(ta.value); }
  });
  $("clearBtn").addEventListener("click", () => { ta.value = ""; schedule(); ta.focus(); });
  renderTopics($("examples"), (ex) => { ta.value = ex; schedule(); ta.focus(); });
  startTypewriter(ta);
  try { state.config = await api("/api/config"); } catch (e) { console.warn(e); }
  setMapboxToken(state.config.mapboxToken || "");
  wireMic();
  // shadow under the composer once it's pinned to the top of the page
  const pin = () => $("composer").classList.toggle("stuck", $("composer").getBoundingClientRect().top <= 0.5);
  addEventListener("scroll", pin, { passive: true });
}
boot();
