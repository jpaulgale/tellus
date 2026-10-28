// Renders card.html frame by frame through Chrome's DevTools protocol and pipes PNGs into ffmpeg.
import { spawn } from "node:child_process";
const [, , page, out, fps = "30", secs = "7.5"] = process.argv;
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=9333", "--hide-scrollbars", "--user-data-dir=" + out + ".profile", "about:blank"], { stdio: "ignore" });
let target;
for (let i = 0; i < 50 && !target; i++) {
  await new Promise((r) => setTimeout(r, 200));
  target = await fetch("http://127.0.0.1:9333/json/list").then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const waiting = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) waiting.get(d.id)?.(d); else events.push(d); };
const cdp = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiting.set(i, (d) => d.error ? rej(new Error(d.error.message)) : res(d.result)); ws.send(JSON.stringify({ id: i, method, params })); });
await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: 1200, height: 628, deviceScaleFactor: 2, mobile: false });
await cdp("Page.navigate", { url: "file://" + page + "?t=0" });
await cdp("Runtime.evaluate", { expression: "new Promise(r => addEventListener('load', r)).then(() => document.fonts.ready).catch(()=>{})", awaitPromise: true });
await new Promise((r) => setTimeout(r, 1500));
await cdp("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", fps, "-c:v", "png", "-i", "-",
  "-vf", "scale=1200:628:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
const n = Math.round(+fps * +secs);
for (let f = 0; f < n; f++) {
  await cdp("Runtime.evaluate", { expression: `frame(${f / +fps})` });
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  if (!ff.stdin.write(Buffer.from(data, "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
ws.close(); chrome.kill();
console.log(`${n} frames -> ${out}`);
