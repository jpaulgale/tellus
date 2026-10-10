// What you can ask Tell Us: a typewriter placeholder that cycles full example requests, and a
// wrapped list of topic chips. Tapping a chip fills its example.
// The typewriter holds still for prefers-reduced-motion and yields the moment you type.

import { $, h } from "./util.js";

export const TOPICS = [
  { topic: "Park hours", to: "CB2 · Parks", ex: "Washington Square Park should not close at night." },
  { topic: "Crossing guard", to: "NYPD", ex: "I'm a parent at PS 3. We need a crossing guard at Hudson St and Christopher St, cars run the light every morning at drop-off." },
  { topic: "Bar downstairs", to: "CB2 · SLA", ex: "I live above the bar at 2 Bleecker St. They leave the windows wide open until 1am and I can hear everything in my bedroom." },
  { topic: "Liquor license", to: "CB2 · SLA", ex: "Caudalie on 130 Greene St plays music past midnight every weekend. I want the board to add conditions to their license." },
  { topic: "Bike lane redesign", to: "CB2 · Transportation", ex: "I want to testify about the two-way bike lane proposal on Lafayette St. It's dangerous for seniors crossing." },
  { topic: "Historic storefront", to: "CB2 · Landmarks", ex: "The new illuminated sign at 770 Broadway doesn't fit the NoHo historic district" },
  { topic: "Outdoor dining shed", to: "CB2 · Outdoor Dining", ex: "The dining shed on Thompson St blocks the crosswalk and the board should not approve it again" },
  { topic: "New development", to: "CB2 · Land Use", ex: "The tower proposed at 60 Spring St is too tall for the block and has no affordable housing" },
  { topic: "Cannabis shop", to: "CB2 · Cannabis", ex: "A cannabis dispensary is applying to open across from the school on Bleecker St and I oppose it" },
  { topic: "Street fair", to: "CB2 · Street Activities", ex: "The street fair on Bleecker St closes our block every month and the board should limit the permits" },
  { topic: "School space", to: "CB2 · Schools", ex: "Our middle school needs to expand into the empty floor of its building and I want the board's support" },
  { topic: "Arts & culture", to: "CB2 · Arts", ex: "We want the board's support for a public mural and performance series in Hudson Square" },
  { topic: "Street light out", to: "311 · DOT", ex: "The street light in front of 60 Spring St has been out for a week" },
  { topic: "Rats", to: "311 · Health", ex: "Rats are running all over the sidewalk outside 200 Spring St every night" },
];

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Typewriter placeholder: type, hold, erase, next. Pauses while the box has text or focus+text. */
export function startTypewriter(textarea) {
  const ghost = $("ghost");
  if (reduced) {
    textarea.placeholder = TOPICS[0].ex;
    ghost.hidden = true;
    return;
  }
  let i = 0, n = 0, dir = 1, wait = 0;
  const tick = () => {
    const visible = !textarea.value;
    ghost.hidden = !visible;
    if (visible) {
      const full = TOPICS[i].ex;
      if (wait > 0) wait--;
      else if (dir === 1 && n < full.length) n++;
      else if (dir === 1) { dir = -1; wait = 55; }      // hold the full sentence ~2s
      else if (n > 0) n = Math.max(0, n - 3);            // erase faster than typing
      else { dir = 1; i = (i + 1) % TOPICS.length; wait = 8; }
      ghost.firstChild.textContent = full.slice(0, n);
    }
    setTimeout(tick, 45); // 0.8x of the original 36 ms pace
  };
  tick();
}

/** A static, wrapped list of topic chips. */
export function renderTopics(container, onPick) {
  container.replaceChildren(
    h("div.topics-lead", {}, "Things you can Tell Us about"),
    h("div.topic-list", {}, ...TOPICS.map((t) =>
      h("button.topic", { type: "button", title: t.to, onclick: () => onPick(t.ex) }, t.topic))),
  );
}
