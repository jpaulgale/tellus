// Counts a page view (/api/hit) and gives the tab a random session id, sent with every API call
// so the events table can follow one visit from view to route to send. No cookies, nothing typed.

export const session = (() => {
  try {
    let id = sessionStorage.getItem("tellus.session");
    if (!id) sessionStorage.setItem("tellus.session", (id = crypto.randomUUID()));
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();

fetch("/api/hit", {
  method: "POST", keepalive: true,
  headers: { "content-type": "application/json", "x-session": session },
  body: JSON.stringify({ path: location.pathname, ref: document.referrer, width: innerWidth }),
}).catch(() => {});
