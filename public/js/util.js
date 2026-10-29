// Small shared helpers: DOM building, escaping, JSON fetch.

import { session } from "./hit.js";

export const $ = (id) => document.getElementById(id);

/** Which community board this page runs as (?board=cb3); the worker reads it from x-board. CB2 when absent. */
export const BOARD = new URLSearchParams(location.search).get("board") || "cb2";
/** A same-site link that keeps the board: withBoard("/how"). */
export const withBoard = (path) => (BOARD === "cb2" ? path : `${path}${path.includes("?") ? "&" : "?"}board=${BOARD}`);

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** h("div.cls", {attrs}, ...children) — children may be strings, nodes, arrays, or null. */
export function h(tag, attrs, ...kids) {
  if (attrs == null || typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs)) {
    if (attrs != null) kids.unshift(attrs);
    attrs = {};
  }
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name || "div");
  if (classes.length) el.className = classes.join(" ");
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else if (k === "class") el.className += " " + v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

export function announce(msg) {
  const el = $("srAnnounce");
  el.textContent = "";
  setTimeout(() => (el.textContent = msg), 30);
}

export async function api(path, body) {
  const r = await fetch(path, body === undefined ? { headers: { "x-session": session, "x-board": BOARD } } : {
    method: "POST", headers: { "content-type": "application/json", "x-session": session, "x-board": BOARD }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `${path} failed (${r.status})`);
  return j;
}

/** One row of the "Change where this goes" picker, likeliest first. */
export function rankRow({ title, sub, on, tag, onPick }) {
  return h("button.rank" + (on ? ".on" : ""), { type: "button", role: "option", "aria-selected": on ? "true" : "false", onclick: onPick },
    h("span.rank-title", title, tag ? h("span.tag", tag) : null),
    sub ? h("span.rank-sub", sub) : null,
  );
}
