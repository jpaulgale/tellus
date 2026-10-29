// Trends: what CB2 residents report to 311 and tell the Full Board, from trends.json
// (scripts/build_trends.py, one per board). Every number here is computed from public records.

import { dataUrl, showBoard } from "/dashboard/board.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => n.toLocaleString("en-US");
const day = (iso, opts = { month: "short", day: "numeric" }) => new Date(iso + "T12:00").toLocaleDateString("en-US", opts);
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const hour = (h) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;
const change = (now, before) => (before ? `${now >= before ? "↑" : "↓"} ${Math.abs(pct(now - before, before))}%` : "new");

/** "61% fixed when the agency arrived · 30% no violation found" for a type's closed requests. */
const closedLine = (t) => t.outcomes.slice(0, 2).map((o) => `${pct(o.count, t.closed)}% ${o.label}`).join(" · ");

function bars(el, weeks, label) {
  const max = Math.max(...weeks.map((w) => w.count), 1);
  el.setAttribute("aria-label", `${label}: ${weeks.map((w) => `${w.count} in the week of ${day(w.week)}`).join(", ")}`);
  el.innerHTML = weeks.map((w, i) => `<div class="week${i === weeks.length - 1 ? " current" : ""}"><b>${w.count}</b><i style="height:${Math.max(2, (78 * w.count) / max)}%"></i><span>${i % 3 === 2 || i === weeks.length - 1 ? day(w.week) : ""}</span></div>`).join("");
}

function render(t) {
  $("intro").textContent = `${fmt(t.total30)} requests to 311 in ${t.district} in the last 30 days (${change(t.total30, t.prev30)} on the 30 days before), out of ${fmt(t.total365)} in the past year.`;
  $("through").textContent = day(t.through, { month: "long", day: "numeric", year: "numeric" });
  $("source-link").href = t.source;

  const [h] = t.hotspots;
  if (h) {
    const [r] = h.resolutions;
    $("brief-heading").textContent = `${fmt(h.top.count)} “${h.top.type}” reports at ${h.address} in 90 days.`;
    $("brief-body").textContent = `Most come in around ${h.top.hours.map(([x]) => hour(x)).join(", ")}. On ${r.meeting_date}, ${r.committee} reviewed a business on this lot` +
      (r.stipulations ? ` and it agreed to ${r.stipulations} stipulations.` : ".") + " Worth checking whether it's the same business.";
  }

  const [rise] = t.rising;
  $("trend-heading").textContent = rise.type;
  $("trend-pill").textContent = change(rise.count, rise.prev);
  bars($("trend-visual"), rise.weeks, `${rise.type} requests per week`);
  const others = t.rising.slice(1).map((x) => `${x.type} (${fmt(x.prev)} → ${fmt(x.count)})`).join(" and ");
  const one = rise.top && rise.top.count >= rise.count / 2
    ? ` ${fmt(rise.top.count)} of them are at one address, ${esc(rise.top.address)}, so this is one place, not the district.` : "";
  $("trend-caption").innerHTML = `<strong>${fmt(rise.prev)} → ${fmt(rise.count)}</strong> requests, 30 days on 30 days.${one}` +
    (/HEAT/.test(rise.type) ? " Heating season started October 1, so some of this rise happens every year." : "") + (others ? ` Also rising: ${esc(others)}.` : "");

  $("types").innerHTML = t.types.map((x) => `<li><div><strong>${esc(x.type)}</strong> <span class="agency">${esc(x.agency)}</span><small>${esc(closedLine(x))}</small></div><b>${fmt(x.count)}</b></li>`).join("");

  $("hot-list").innerHTML = t.hotspots.map((x) => `<article class="hot${x.related ? "" : " unrelated"}">
    <div class="hot-head"><strong>${esc(x.address)}</strong><span>${fmt(x.count)} requests in 90 days · BBL ${esc(x.bbl)}</span></div>
    <p>${fmt(x.top.count)} × ${esc(x.top.type)}${x.top.closed ? ` — ${esc(closedLine(x.top))}` : ""}</p>
    ${x.resolutions.map((r) => `<p class="hot-res"><span class="outcome">${esc(r.committee)}</span> ${esc(r.meeting_date)}: ${esc(r.title.replace(/^\*\s*/, "").slice(0, 140))}${r.stipulations ? ` · ${r.stipulations} stipulations` : ""} <a href="${esc(r.source)}" target="_blank" rel="noopener">Minutes ↗</a></p>`).join("")}
    ${x.related ? "" : `<p class="hot-note">The complaints here are not the kind of thing these decisions govern.</p>`}
  </article>`).join("");

  const v = t.voices;
  $("voices-sub").textContent = t.labeled
    ? `${v.count} concerns raised in Public Session at ${v.meetings} Full Board meetings, in the secretary's summary of each speaker. By the committee that would take it up, ${v.year}:`
    : `${v.count} remarks in Public Session at ${v.meetings} Full Board meetings, in the secretary's summary of each speaker. Not yet labeled by committee.`;
  $("voice-tally").innerHTML = v.by_committee.slice(0, 6).map(([c, n]) => `<li><span>${esc(c)}</span><b>${n}</b></li>`).join("");
  $("voices").innerHTML = v.latest.slice(0, 6).map((x) => `<article><span class="quote-mark" aria-hidden="true">“</span><div><p>${esc(x.text.length > 320 ? x.text.slice(0, 317) + "…" : x.text)}</p>
    <footer>${esc(x.speaker_line.replace(/:$/, ""))}${x.topic ? ` · ${esc(x.topic)}` : ""} · ${esc(x.meeting_date)}${x.committee ? ` · ${esc(x.committee)}` : ""} · <a href="${esc(x.source)}" target="_blank" rel="noopener">Minutes ↗</a></footer></div></article>`).join("");
}

showBoard().catch(() => null);
fetch(dataUrl("trends.json")).then((r) => r.json()).then(render).catch(() => { $("intro").textContent = "Couldn't load the data."; });

const menuButton = document.querySelector(".menu-button"), sidebar = document.querySelector(".sidebar");
menuButton.addEventListener("click", () => { const open = sidebar.classList.toggle("open"); menuButton.setAttribute("aria-expanded", String(open)); });
