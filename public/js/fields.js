// Field controls. Every field shows Jev's pick (with its %), lets you pick another option,
// and lets you type or choose your own value. ctx = { get(key), set(key, value, rerender), isTouched(key) }.

import { h, pct, rankRow } from "./util.js";
import { renderLocation } from "./location.js";

/** What Jev would put in this field, in our value shape. */
export function jevValue(field) {
  if (field.selected == null) return null;
  const o = field.options[field.selected];
  if (field.kind === "location") return { text: o.value, label: o.label, geo: o.geo ?? null, license: o.license ?? null, resolutions: o.resolutions ?? [] };
  return o.value;
}

/** Jev's probability for whatever value the field holds now (null if Jev didn't offer it). */
function pOf(field, v) {
  if (v == null) return field.kind === "noul" ? null : field.pNone;
  const o = field.options.find((x) => x.value === v || (v.text && x.value === v.text));
  return o ? o.p : null;
}

/** Greyed-out sample values for the contact fields. */
const EXAMPLE = { name: "Zohran Mamdani", email: "mayor@nyc.gov", phone: "212 555-5555" };

export function isEmpty(v) {
  return v == null || v === "" || (typeof v === "object" && !v.text);
}

export function renderField(field, key, ctx) {
  const v = ctx.get(key);
  const touched = ctx.isTouched(key);
  const p = pOf(field, v);
  const badge = field.kind === "committee" ? null : touched
    ? h("span.ff-tag.you", "Your edit")
    : null;
  const id = `f-${key.replace(/\W/g, "-")}`;
  const top = h("div.ff-top",
    h("label.ff-lab", { for: id }, field.label, field.required ? h("span.req", { "aria-hidden": "true" }, " *") : null),
    badge);
  const body =
    field.kind === "location" ? renderLocation(field, key, ctx, id)
    : field.kind === "select" ? selectControl(field, key, ctx, v, id)
    : field.kind === "noul" ? noulControl(field, key, ctx, v, id)
    : field.kind === "committee" ? committeeControl(field, key, ctx, v, id)
    : spanControl(field, key, ctx, v, id);
  return h("div.ff" + (isEmpty(v) ? (field.required ? ".need" : "") : ".filled"), { "data-key": key, id: `ff-${key.replace(/\W/g, "-")}` }, top, body);
}

function chip(label, p, on, onclick, extra = {}) {
  return h("button.chip" + (on ? ".on" : ""), { type: "button", "aria-pressed": on ? "true" : "false", onclick, ...extra },
    label, p != null ? h("span.chip-p", pct(p)) : null);
}

function selectControl(field, key, ctx, v, id) {
  // Jev's options carry the %; fall back to the catalog's choices before Jev has answered.
  const opts = field.options.length ? field.options : (field.choices ?? []).map((c) => ({ label: c, value: c, p: null }));
  return h("div.chips", { role: "group", id, "aria-label": field.label },
    opts.map((o) => chip(o.label, o.p, v === o.value, () => ctx.set(key, o.value, true))),
    // "Other" is a real answer (it satisfies a required field), unlike leaving it blank.
    opts.some((o) => /^(other|something else)$/i.test(o.label)) ? null
      : chip("Other", null, v === "Other", () => ctx.set(key, "Other", true), { class: "chip-none" }));
}

function noulControl(field, key, ctx, v, id) {
  const [yes, no] = field.options.length ? field.options : [{ p: null }, { p: null }];
  return h("div.chips", { role: "group", id, "aria-label": field.label },
    chip("Yes", yes.p, v === true, () => ctx.set(key, v === true ? null : true, true)),
    chip("No", no.p, v === false, () => ctx.set(key, v === false ? null : false, true)));
}

/** Why a typed value isn't acceptable, or "" when it is (empty is handled by "required"). */
export function invalidReason(field, v) {
  if (isEmpty(v) || typeof v !== "string") return "";
  if (field.id === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())) return "Enter an email address like name@example.com.";
  if (field.id === "phone") {
    const digits = v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    if (digits.length !== 10) return "Enter a 10-digit phone number, like 212 555-5555.";
  }
  return "";
}

function spanControl(field, key, ctx, v, id) {
  const type = field.id === "email" ? "email" : field.id === "phone" ? "tel" : "text";
  const error = h("p.fielderror", { id: `${id}-err`, role: "alert", hidden: true });
  // Complain once they leave the field (or on send), and clear the moment it's fixed.
  const check = (showNew) => {
    const why = invalidReason(field, input.value);
    if (!why || showNew) { error.textContent = why; error.hidden = !why; input.closest(".ff")?.classList.toggle("invalid", !!why); }
    input.setAttribute("aria-invalid", String(!!why));
  };
  const input = h("input.ff-input", {
    id, type, value: v ?? "", placeholder: EXAMPLE[field.id] ?? (field.options.length ? "Pick one below or type" : "Type it here"),
    autocomplete: field.id === "email" ? "email" : field.id === "phone" ? "tel" : field.id === "name" ? "name" : "off",
    inputmode: field.id === "phone" ? "tel" : field.id === "email" ? "email" : null,
    "aria-describedby": `${id}-err`,
    oninput: (e) => { ctx.set(key, e.target.value.trim() ? e.target.value : null, false); check(false); },
    onblur: () => check(true),
  });
  if (invalidReason(field, v)) queueMicrotask(() => check(true));
  const alts = field.options.filter((o) => o.value !== v && o.p >= 0.05);
  return h("div",
    h("div.ff-inputwrap", input), error,
    alts.length ? h("div.chips.alts", h("span.alts-lead", "Also found:"),
      alts.map((o) => chip(o.label, o.p, false, () => ctx.set(key, o.value, true)))) : null);
}

/** Committee as a plain dropdown: likeliest first, and committees that scored about 0 below a divider. */
function committeeControl(field, key, ctx, v, id) {
  const descs = ctx.committees || {};
  const opts = field.options.length ? field.options
    : Object.keys(descs).map((k) => ({ label: k, value: k, p: 0 }));
  const likely = opts.filter((o) => o.p >= 0.005), rest = opts.filter((o) => o.p < 0.005);
  const option = (o) => h("option", { value: o.value, selected: o.value === v }, o.label);
  const select = h("select.ff-input.ff-select", { id, onchange: (e) => ctx.set(key, e.target.value || null, true) },
    v ? null : h("option", { value: "" }, "Pick a committee"),
    likely.map(option),
    likely.length && rest.length ? h("option", { disabled: true }, "──────────") : null,
    rest.map(option));
  const cur = opts.find((o) => o.value === v);
  return h("div", h("div.ff-inputwrap", select),
    field.reason && !ctx.isTouched(key) ? h("p.fieldhint.reason", field.reason) : null,
    cur ? h("p.fieldhint", cur.note || descs[cur.value] || "") : null);
}
