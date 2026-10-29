// What you can ask Tell Us: a typewriter placeholder that cycles full example requests, and a
// wrapped list of topic chips. Tapping a chip fills its example. The examples are the board's
// own (worker/boards.json, via /api/config).
// The typewriter holds still for prefers-reduced-motion and yields the moment you type. Its
// caret hides while the box has focus, where the real one blinks.

import { $, h } from "./util.js";


const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Typewriter placeholder: type, hold, fade, next. Pauses while the box has text. */
export function startTypewriter(textarea, TOPICS) {
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
      else if (!ghost.classList.contains("fading")) { ghost.classList.add("fading"); wait = 9; } // fade out (~0.4s)
      else { ghost.classList.remove("fading"); n = 0; dir = 1; i = (i + 1) % TOPICS.length; wait = 4; }
      ghost.firstChild.textContent = full.slice(0, n);
    }
    setTimeout(tick, 45); // 0.8x of the original 36 ms pace
  };
  tick();
}

/** A static, wrapped list of topic chips. */
export function renderTopics(container, TOPICS, onPick) {
  container.replaceChildren(
    h("div.topics-lead", {}, "Try an example"),
    h("div.topic-list", {}, ...TOPICS.map((t) =>
      h("button.topic", { type: "button", title: t.to, onclick: () => onPick(t.ex) }, t.topic))),
  );
}
