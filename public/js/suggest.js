// What you can ask Tell Us, shown two ways from the board's examples (worker/boards.json): the message
// box's own placeholder, a full sentence in everyday words that changes every few seconds, and a short
// row of topic chips that fill in their sentence when tapped. The worker puts both in the page, so
// nothing here changes the layout.

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const HOLD_MS = 4500, FADE_MS = 300;

/**
 * Cycles the placeholder through the examples with a short fade (app.css fades the placeholder colour).
 * A placeholder is the browser's own: it goes the moment you type, the caret is the real one, and screen
 * readers read it. Holds still for reduced motion and while the box has text.
 */
export function rotatePlaceholder(textarea, examples) {
  if (reduced || examples.length < 2) return;
  let i = Math.max(0, examples.findIndex((t) => t.ex === textarea.placeholder));
  setInterval(() => {
    if (textarea.value || document.hidden) return;
    textarea.classList.add("ph-out");
    setTimeout(() => {
      i = (i + 1) % examples.length;
      textarea.placeholder = examples[i].ex;
      textarea.classList.remove("ph-out");
    }, FADE_MS);
  }, HOLD_MS);
}

/** Wires the topic chips the worker rendered: a tap fills in that topic's full sentence. */
export function wireTopics(container, examples, onPick) {
  container.querySelectorAll(".topic").forEach((b, i) => {
    if (examples[i]) b.onclick = () => onPick(examples[i].ex);
  });
}
