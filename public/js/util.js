// Small shared helpers: DOM building, escaping, percentages, JSON fetch.

export const $ = (id) => document.getElementById(id);

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const pct = (p) => `${Math.round((p ?? 0) * 100)}%`;

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
  const r = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `${path} failed (${r.status})`);
  return j;
}

/** Percentage bar row used by the form and committee pickers. */
export function rankRow({ title, sub, p, on, tag, onPick }) {
  return h("button.rank" + (on ? ".on" : ""), { type: "button", role: "option", "aria-selected": on ? "true" : "false", onclick: onPick },
    h("span.rank-title", title, tag ? h("span.tag", tag) : null),
    h("span.rank-pct", pct(p)),
    h("span.rank-bar", {}, h("i", { style: `width:${Math.max(1, Math.round(p * 100))}%` })),
    sub ? h("span.rank-sub", sub) : null,
  );
}
