// Voice through Gemini Live (as in formspeak): ephemeral token from /api/token, 16 kHz PCM16 from
// worklets/capture.js. The live transcription streams to onText, and the model edits the form
// through tool calls: set_field(field, value) and add_details(text). It never speaks; any audio
// it sends is ignored.

import { api } from "./util.js";

const MODEL = "models/gemini-3.1-flash-live-preview";
const WS = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=";
const prompt = (fields) => `You are the voice control for a New York City community board and 311 form. Never speak and never answer in words; act only through tools.
- When the person states or corrects the value of a form field, call set_field with that field's name and the value. For a field with listed choices, use the closest choice exactly as written.
- When they describe the problem or add new information about it, call add_details with their words, lightly cleaned up.
Fields: ${fields.join("; ")}.
Never invent a value. One set_field call per field.`;
const TOOLS = [{ functionDeclarations: [
  { name: "set_field", description: "Set or correct one form field.",
    parameters: { type: "OBJECT", properties: { field: { type: "STRING" }, value: { type: "STRING" } }, required: ["field", "value"] } },
  { name: "add_details", description: "Add what the person said about the problem to the description.",
    parameters: { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] } },
] }];

let ws = null, stream = null, ctx = null, on = false;

/** onText(chunk) receives transcription text; onState(state, msg?) gets "connecting"|"listening"|"off"|"error". */
export async function toggleMic({ onText, onTool, onState, onLevel, fields = [] }) {
  if (on || ws) return stop(onState);
  onState("connecting");
  try {
    const { token } = await api("/api/token", {});
    await open(token, { onText, onTool, onState, fields });
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.audioWorklet.addModule("worklets/capture.js");
    const node = new AudioWorkletNode(ctx, "cap", { processorOptions: { inRate: ctx.sampleRate } });
    node.port.onmessage = (e) => {
      if (!on || ws?.readyState !== WebSocket.OPEN) return;
      const f32 = e.data;
      let sum = 0;
      const pcm = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); pcm[i] = s * 0x7fff; sum += s * s; }
      onLevel?.(Math.sqrt(sum / f32.length));
      ws.send(JSON.stringify({ realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: b64(pcm.buffer) } } }));
    };
    ctx.createMediaStreamSource(stream).connect(node);
    on = true;
    onState("listening");
  } catch (e) {
    stop(() => {});
    onState("error", e.message || String(e));
  }
}

function open(token, { onText, onTool, onState, fields }) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS + token);
    ws.onopen = () => ws.send(JSON.stringify({ setup: {
      model: MODEL,
      generationConfig: { responseModalities: ["AUDIO"] },
      systemInstruction: { parts: [{ text: prompt(fields) }] },
      tools: TOOLS,
      inputAudioTranscription: {},
      realtimeInputConfig: {
        automaticActivityDetection: { silenceDurationMs: 700, prefixPaddingMs: 300, startOfSpeechSensitivity: "START_SENSITIVITY_LOW" },
        turnCoverage: "TURN_INCLUDES_ONLY_ACTIVITY",
      },
    } }));
    ws.onmessage = async (e) => {
      const text = e.data instanceof Blob ? await e.data.text() : e.data;
      let msg; try { msg = JSON.parse(text); } catch { return; }
      if (msg.setupComplete) return resolve();
      const t = msg.serverContent?.inputTranscription?.text;
      if (t) onText(t);
      if (msg.serverContent?.turnComplete) onText(null); // end of an utterance
      if (msg.toolCall) {
        const calls = msg.toolCall.functionCalls ?? [];
        const functionResponses = [];
        for (const c of calls) {
          let result = "ok";
          try { result = (await onTool?.(c.name, c.args ?? {})) || "ok"; } catch (err) { result = String(err.message || err); }
          functionResponses.push({ id: c.id, name: c.name, response: { result } });
        }
        ws?.send(JSON.stringify({ toolResponse: { functionResponses } }));
      }
    };
    ws.onerror = () => reject(new Error("Couldn't connect to the voice service."));
    ws.onclose = (ev) => {
      const was = on;
      ws = null;
      stop(() => {});
      if (was && ev.code !== 1000) onState("error", "The voice session ended. Tap the mic to start again.");
      else onState("off");
    };
  });
}

function stop(onState) {
  on = false;
  stream?.getTracks().forEach((t) => t.stop()); stream = null;
  ctx?.close().catch(() => {}); ctx = null;
  if (ws) { const w = ws; ws = null; try { w.close(1000); } catch {} }
  onState("off");
}

function b64(buf) {
  const bytes = new Uint8Array(buf); let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
