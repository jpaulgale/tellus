// Board view: sample requests that went through Tell Us (scripts/build_dashboard_data.py writes
// requests.json), each with its suggested committee, a map, and what the board already decided there.

import { normAddress, groupRecord, cardModel } from "/js/record.js";

const COMMITTEES = ["SLA – 1", "SLA – 2", "Cannabis Licensing Committee", "Street Activities & Resiliency", "Outdoor Dining Working Group", "Traffic & Transportation", "Parks & Waterfront", "Landmarks & Public Aesthetics", "Land Use & Housing", "Human Services", "Schools & Education", "Arts & Culture Working Group", "Community Facilities Advisory Panel", "Executive Committee"];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const street = (r) => r.geo.corner ? r.address : titleCase(r.address.replace(/, Manhattan$/, ""));
const shortMonth = (d) => d.replace(/^(\w+) \d+, (\d+)$/, (_, m, y) => `${m.slice(0, 3)} ${y}`);

function ago(hours) {
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

let requests = [], committees = COMMITTEES, mapboxToken = "";

function staticMap({ lat, lng }) {
  if (!mapboxToken) return "";
  const src = `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/pin-l+103fef(${lng},${lat})/${lng},${lat},15.6,0/640x240@2x?access_token=${mapboxToken}`;
  return `<img class="request-map" src="${src}" alt="Map of the address" loading="lazy" />`;
}

const badge = (o) => (o ? `<span class="outcome ${o.key}">${esc(o.label)}</span>` : "");
const marked = ({ text, flagged }) => (flagged ? `<mark>${esc(text)}</mark>` : esc(text));

/** One meeting's decisions about the place (see cardModel); a neighbor's card starts collapsed to a line. */
function resolutionCard(m) {
  const body = `<div class="rescard">
    <p class="rescard-eyebrow">On the board's record</p>
    <p class="rescard-title">CB2 Manhattan reviewed ${m.place} on <b>${esc(m.date)}</b>.</p>
    <p class="rescard-path">${badge(m.outcome)} <span>${esc(m.path)}${m.vote ? ` · ${esc(m.vote)}` : ""}</span></p>
    ${m.who.length ? `<p class="rescard-who"><b>Recommended to:</b> ${m.who.map(esc).join(" · ")}</p>` : ""}
    ${m.business ? `<p class="rescard-sub">${esc(m.business)}</p>` : ""}
    ${m.what ? `<p class="rescard-what">${esc(m.what)}</p>` : ""}
    ${m.flags.length ? `<p class="resflag-lead">Relevant condition</p>${m.flags.map((f) => `<blockquote class="resquote"><mark>${esc(f.text)}</mark><footer>${esc(f.from)}</footer></blockquote>`).join("")}` : ""}
    ${m.stipulations.length ? `<details class="resall"><summary>All ${m.stipulations.length} stipulations</summary><ol>${m.stipulations.map((t) => `<li>${marked(t)}</li>`).join("")}</ol></details>` : ""}
    ${m.also.length ? `<ul class="rescard-also">${m.also.map((a) => `<li><b>Also at this meeting:</b> ${esc(a.title)} ${badge(a.outcome)}</li>`).join("")}</ul>` : ""}
    ${m.decisions.length ? `<details class="resall decision"><summary>${m.decisions.length > 1 ? "Read the decisions" : "Read the decision"}</summary>${m.decisions.map((d) =>
      (d.label ? `<p class="decision-label">${esc(d.label)}</p>` : "") + d.paras.map((t) => `<p>${marked(t)}</p>`).join("")).join("")}</details>` : ""}
    <p class="rescard-foot"><a href="${esc(m.source)}" target="_blank" rel="noopener">Read the minutes ↗</a></p>
  </div>`;
  return m.atHere ? body : `<details class="resnear"><summary>Neighboring address: ${esc(m.address)} · ${esc(m.date)} ${badge(m.outcome)}</summary>${body}</details>`;
}

const cardsFor = (r) => { const here = normAddress(r.address); return { here, ...groupRecord(r.resolutions, r.related, here) }; };

/** The request's board record as cards, and the related decisions that aren't already in one. */
function boardRecord(r) {
  const { here, groups, rest } = cardsFor(r);
  return groups.map((g) => resolutionCard(cardModel(g, here))).join("") + relatedMinutes(rest);
}

function relatedMinutes(list) {
  if (!list.length) return "";
  return `<section class="related" aria-label="Related past board decisions"><p class="related-lead">Related decisions from past board meetings</p><ul>${list.map((r) => `<li>
    <p class="related-title">${esc(r.title)}</p>
    <p class="related-meta">${[r.meeting_date, r.committee, r.metres == null ? null : r.metres < 30 ? "same address" : `${r.metres} m away`].filter(Boolean).map(esc).join(" · ")} <a href="${esc(r.source)}" target="_blank" rel="noopener">Minutes ↗</a></p>
  </li>`).join("")}</ul></section>`;
}

// Requests marked resolved in this tab; a reload brings them back.
const resolved = new Set();
const RESOLVED_BEFORE = 24;
let showingResolved = false;

function renderList() {
  const list = document.querySelector("#request-list");
  const open = requests.filter((r) => !resolved.has(r.id));
  const shown = requests.filter((r) => resolved.has(r.id) === showingResolved);
  list.innerHTML = shown.map((r) => {
    const rec = r.resolutions[0];
    return `<button class="request ${r.urgent && !showingResolved ? "urgent" : ""} ${showingResolved ? "done" : ""}" data-request="${esc(r.id)}"><span class="request-status" aria-hidden="true"></span><span>
      <strong>${esc(r.title)}</strong><p>${esc(street(r))}${r.school ? ` · ${esc(r.school)}` : ""}</p>
      ${r.committee ? `<span class="tag">${esc(r.committee.name)}</span>` : ""}${rec ? `<span class="tag record">On the board's record · ${esc(shortMonth(rec.meeting_date))}</span>` : ""}
    </span><time>${showingResolved ? "Resolved today" : ago(r.hours_ago)}</time></button>`;
  }).join("") || `<p class="empty">${showingResolved ? "Nothing resolved yet in this session. Open a request and choose “Mark as resolved” to see it here." : "Every request has been handled."}</p>`;
  document.querySelector("#requests-heading").textContent = showingResolved ? "Resolved requests" : "Requests to review";
  document.querySelector("#requests-sub").textContent = showingResolved
    ? "Resolved in this session. Earlier resolved requests aren't part of this demo."
    : "Click a request to read it, see what the board already decided there, and choose what happens next.";
  document.querySelector("#view-resolved").textContent = showingResolved ? "Back to requests to review" : "View resolved requests";
  const total = RESOLVED_BEFORE + resolved.size;
  document.querySelector("#nav-count").textContent = open.length;
  document.querySelector("#count-new").textContent = open.length;
  document.querySelector("#count-urgent").textContent = open.filter((r) => r.urgent).length;
  document.querySelector("#count-resolved").textContent = total;
  document.querySelector("#resolved-heading").textContent = `${total} requests resolved this month`;
}

function renderSteps(r) {
  const select = document.querySelector("#next-step"), hint = document.querySelector("#step-hint");
  const c = r.committee?.name;
  const others = committees.filter((x) => x !== c);
  // The board advises; when the complaint bears on a condition it set, the agency that holds the permit is who can enforce it.
  const { here, groups } = cardsFor(r);
  const cards = groups.map((g) => cardModel(g, here)).filter((m) => m.atHere);
  const flag = cards.flatMap((m) => m.flags)[0];
  const referTo = flag?.agencies[0];
  const agencies = [...new Set(cards.flatMap((m) => m.who))].filter((a) => a !== referTo);
  const first = resolved.has(r.id) ? "reopen" : referTo ? "refer" : "assign";
  select.innerHTML = [
    resolved.has(r.id) ? `<option value="reopen" selected>Reopen this request</option>` : "",
    referTo ? `<option value="refer:${esc(referTo)}"${first === "refer" ? " selected" : ""}>Refer to ${esc(referTo)} (suggested)</option>` : "",
    c ? `<option value="assign:${esc(c)}"${first === "assign" ? " selected" : ""}>Assign to ${esc(c)}${referTo ? "" : " (suggested)"}</option><option value="agenda:${esc(c)}">Add to ${esc(c)}'s next meeting agenda</option>` : "",
    agencies.length ? `<optgroup label="Refer to an agency">${agencies.map((a) => `<option value="refer:${esc(a)}">Refer to ${esc(a)}</option>`).join("")}</optgroup>` : "",
    `<optgroup label="${c ? "Or assign to a different committee" : "Assign to a committee"}">${others.map((x) => `<option value="assign:${esc(x)}">Assign to ${esc(x)}</option>`).join("")}</optgroup>`,
    `<option value="reply">Send the resident a reply</option>${resolved.has(r.id) ? "" : `<option value="resolved">Mark as resolved</option>`}`,
  ].join("");
  hint.textContent = first === "refer" ? `Why ${referTo}: the complaint is about a condition the board set (highlighted above), and ${referTo} enforces it.`
    : r.committee?.why ? `Why ${c}: ${r.committee.why}` : "";
  hint.hidden = !hint.textContent;
}

let current = null;
function openRequest(r) {
  current = r;
  const routed = r.form.key === "cb2" ? null : `Also sent to ${r.form.agency} as a ${r.form.name}`;
  document.querySelector("#dialog-title").textContent = r.title;
  document.querySelector("#dialog-body").innerHTML = `
    <blockquote class="resident-words">${esc(r.message)}<footer>What the resident wrote · ${ago(r.hours_ago)}</footer></blockquote>
    <dl class="facts">
      <dt>Address</dt><dd>${esc(street(r))}${r.geo.zip ? `, ${esc(r.geo.zip)}` : ""}</dd>
      ${r.school ? `<dt>School</dt><dd>${esc(r.school)}</dd>` : ""}
      ${routed ? `<dt>Routing</dt><dd>${esc(routed)}</dd>` : ""}
    </dl>
    ${staticMap(r.geo)}
    ${boardRecord(r)}`;
  renderSteps(r);
  dialog.hidden = false;
  document.body.classList.add("sheet-open");
  document.querySelector(".dialog").scrollTop = 0;
  document.querySelector(".close-button").focus();
}

const dialog = document.querySelector("#dialog");
function showToast(message) { const toast = document.querySelector("#toast"); toast.textContent = message; toast.classList.add("show"); window.setTimeout(() => toast.classList.remove("show"), 2400); }
function closeDialog() { dialog.hidden = true; document.body.classList.remove("sheet-open"); }

document.querySelector("#request-list").addEventListener("click", (event) => { const button = event.target.closest(".request"); if (button) openRequest(requests.find((r) => r.id === button.dataset.request)); });
document.querySelector(".close-button").addEventListener("click", closeDialog);
dialog.addEventListener("click", (event) => { if (event.target === dialog) closeDialog(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDialog(); });
document.querySelector(".save-button").addEventListener("click", () => {
  const [kind, who] = document.querySelector("#next-step").value.split(":");
  if (kind === "resolved") resolved.add(current.id);
  if (kind === "reopen") resolved.delete(current.id);
  closeDialog();
  renderList();
  showToast({ assign: `Assigned to ${who}`, agenda: `Added to ${who}'s next agenda`, reply: "Reply started", resolved: "Marked as resolved", reopen: "Reopened", refer: `Referred to ${who}` }[kind]);
});
document.querySelector("#view-resolved").addEventListener("click", () => {
  showingResolved = !showingResolved;
  renderList();
  document.querySelector("#requests").scrollIntoView({ behavior: "smooth" });
});
const menuButton = document.querySelector(".menu-button"), sidebar = document.querySelector(".sidebar");
menuButton.addEventListener("click", () => { const isOpen = sidebar.classList.toggle("open"); menuButton.setAttribute("aria-expanded", String(isOpen)); });
document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => { document.querySelector(".nav-link.active")?.classList.remove("active"); link.classList.add("active"); sidebar.classList.remove("open"); menuButton.setAttribute("aria-expanded", "false"); }));

const now = new Date();
document.querySelector("#today").textContent = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
document.querySelector("#greeting").textContent = now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";

(async () => {
  // The map token and committee list come from the app; the page still works without them.
  try {
    const config = await (await fetch("/api/config")).json();
    mapboxToken = config.mapboxToken || "";
    if (config.committees?.length) committees = config.committees;
  } catch { /* static hosting: no map */ }
  requests = await (await fetch("/dashboard/requests.json")).json();
  renderList();
  // #r-caudalie opens that request, so other pages can link straight to one.
  const linked = requests.find((r) => location.hash === `#r-${r.id}`);
  if (linked) openRequest(linked);
})();
