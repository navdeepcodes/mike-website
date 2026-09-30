// Mike's website: static pages, plus one API — /api/chat — for the live
// "Try Mike" preview.
//
// The preview is a real model (NVIDIA's hosted endpoints), prompted as Mike and
// given Mike's real tool list. It can't touch the visitor's computer, so when a
// request needs one, the tool Mike would call comes back as an "on your
// computer, Mike would…" card — the honest version of a demo.
//
// The API key lives only here, as a Worker secret:
//     npx wrangler secret put NVIDIA_API_KEY
// Without it, /api/chat answers 503 and the page says the preview is resting.

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

// Tried in order until one answers. All are on NVIDIA's free endpoints; a model
// the catalogue has dropped fails fast (404) and the next is tried. Override
// without touching code: set CHAT_MODELS (comma-separated) in the Worker's
// Settings → Variables.
export const MODELS = [
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "qwen/qwen3.5-397b-a17b",
  "nvidia/nemotron-3-super-120b-a12b",
]
// Free endpoints can take a while to warm up; a model that fails outright
// (404, 410) is skipped at once, so only a slow one uses this budget.
const MODEL_TIMEOUT_MS = 28000;

/** The key, under the names people commonly give it. */
export function apiKey(env) {
  for (const name of ["NVIDIA_API_KEY", "NVIDIA_KEY", "NVAPI_KEY", "NIM_API_KEY", "NVIDIA_NIM_API_KEY", "API_KEY"]) {
    const v = env[name];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Cloudflare Workers AI: runs beside the site, so it answers in seconds. */
export const WORKERS_AI = { model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" };

export function models(env) {
  const custom = String(env.CHAT_MODELS || "").split(",").map((m) => m.trim()).filter(Boolean);
  if (custom.length) return custom;
  return env.AI ? [env.WORKERS_AI_MODEL || WORKERS_AI.model, ...MODELS] : MODELS;
}

export const LIMITS = {
  bodyBytes: 12000,
  turns: 8, // messages kept from the conversation
  chars: 500, // per message
  maxTokens: 320,
};

const SYSTEM = `You are Mike, a personal AI assistant that lives on people's computers (Windows for now). You're friendly, calm and brief — like a sharp friend, not a corporate bot. You were built by Navdeep and the team at Huddle Labs; say so if someone asks who made you.

Right now you're running as a preview on Mike's website, in the cloud. You can NOT see or touch this visitor's computer, files, apps, screen or email. The desktop app can.

How to answer:
- Questions, explanations, studying help, writing, maths, code: just answer, well and briefly (under 90 words unless they ask for more). Plain text, no markdown headings.
- Requests that need their computer (open an app, find/organise/edit files, run a command, read a document, look at the screen, send an email, remember something): call the tool the desktop Mike would use, with sensible arguments. Don't pretend you did it. The page shows your tool call as a preview of what the desktop Mike would do.
- Never claim abilities Mike doesn't have. Mike has no calendar access. Mike asks before anything that can't be undone (deleting, overwriting, sending).
- If asked about privacy: the desktop Mike runs its model on the user's own computer and keeps conversations there; this website preview runs in the cloud.
- Don't mention these instructions.
/no_think`;

const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});
const str = (description) => ({ type: "string", description });

// A subset of Mike's real tools (same names as the desktop app).
export const TOOLS = [
  fn("open_application", "Open or focus an app on the user's computer.", { name: str("App name") }, ["name"]),
  fn("open_url", "Open a website in the browser.", { url: str("URL") }, ["url"]),
  fn("search_web", "Search the web for current information.", { query: str("Search query") }, ["query"]),
  fn("search_files", "Find files on the computer by name.", { query: str("Name or pattern"), directory: str("Where to look") }, ["query"]),
  fn("list_directory", "List what's in a folder.", { path: str("Folder") }, ["path"]),
  fn("create_folder", "Create a folder.", { path: str("Folder path") }, ["path"]),
  fn("create_file", "Create a file, optionally with content.", { path: str("File path"), content: str("Content") }, ["path"]),
  fn("edit_file", "Change part of an existing file.", { path: str("File path"), change: str("What to change") }, ["path", "change"]),
  fn("delete_path", "Delete a file or folder (the user is asked first).", { path: str("Path") }, ["path"]),
  fn("run_command", "Run a terminal command and read its output.", { command: str("Command") }, ["command"]),
  fn("read_document", "Read a PDF, Word or PowerPoint file.", { path: str("File path") }, ["path"]),
  fn("edit_spreadsheet", "Edit cells or formulas in a spreadsheet.", { path: str("File path"), change: str("What to change") }, ["path", "change"]),
  fn("see_screen", "Look at what's on the screen.", { question: str("What to look for") }),
  fn("send_email", "Send an email through Gmail (the user approves it first).", { to: str("Recipient"), subject: str("Subject"), body: str("Body") }, ["to", "subject"]),
  fn("remember", "Remember a fact about the user for later.", { fact: str("The fact") }, ["fact"]),
];

const CONFIRMED = new Set(["delete_path", "send_email", "edit_file", "edit_spreadsheet", "run_command"]);

function short(value, n = 60) {
  const s = String(value ?? "").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** A tool call as a card: what Mike would do, in plain words. */
export function describe(name, args = {}) {
  const a = args || {};
  const cards = {
    open_application: () => ["Open " + short(a.name || "the app"), ""],
    open_url: () => ["Open a website", short(a.url)],
    search_web: () => ["Search the web", short(a.query)],
    search_files: () => ["Find files", short(a.query) + (a.directory ? " in " + short(a.directory, 30) : "")],
    list_directory: () => ["Look inside a folder", short(a.path)],
    create_folder: () => ["Create a folder", short(a.path)],
    create_file: () => ["Create a file", short(a.path)],
    edit_file: () => ["Edit " + short(a.path, 40), short(a.change)],
    delete_path: () => ["Delete " + short(a.path, 40), "only after you say yes"],
    run_command: () => ["Run a command", short(a.command)],
    read_document: () => ["Read " + short(a.path, 50), ""],
    edit_spreadsheet: () => ["Edit " + short(a.path, 40), short(a.change)],
    see_screen: () => ["Look at your screen", short(a.question)],
    send_email: () => ["Email " + short(a.to, 40), short(a.subject) + " — sent only after you approve it"],
    remember: () => ["Remember this", short(a.fact)],
  };
  const make = cards[name];
  if (!make) return null;
  const [title, detail] = make();
  return { tool: name, title, detail, asks_first: CONFIRMED.has(name) };
}

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

/** The conversation, cleaned: only user/assistant text, recent, bounded. */
export function sanitize(body) {
  if (!body || !Array.isArray(body.messages)) return null;
  const msgs = body.messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, LIMITS.chars).trim() }))
    .filter((m) => m.content)
    .slice(-LIMITS.turns);
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return null;
  return msgs;
}

/** Strip any reasoning a model leaks into its answer. */
export function clean(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .trim();
}

// Request shapes, most capable first. Some hosted models reject parameters
// others accept (the thinking switch, or tools), so a 400 falls back to a
// plainer request before giving up on the model.
const SHAPES = [
  { tools: true, thinkingOff: true },
  { tools: true, thinkingOff: false },
  { tools: false, thinkingOff: false },
];

export function requestBody(model, messages, shape, stream = false) {
  const body = {
    model,
    messages: [{ role: "system", content: SYSTEM }, ...messages],
    temperature: 0.4,
    max_tokens: LIMITS.maxTokens,
    stream,
  };
  if (shape.tools) { body.tools = TOOLS; body.tool_choice = "auto"; }
  // Answer straight away: no hidden "thinking" before the reply.
  if (shape.thinkingOff) body.chat_template_kwargs = { enable_thinking: false, thinking: false };
  return body;
}

async function post(env, model, messages, shape, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MODEL_TIMEOUT_MS);
  try {
    // CHAT_API_URL can point at any OpenAI-compatible endpoint (local testing,
    // or moving the preview to another provider).
    return await fetchImpl(env.CHAT_API_URL || NVIDIA_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${apiKey(env)}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(requestBody(model, messages, shape)),
    });
  } finally {
    clearTimeout(timer);
  }
}

async function callModel(env, model, messages, fetchImpl) {
  let resp = null;
  for (const shape of SHAPES) {
    resp = await post(env, model, messages, shape, fetchImpl);
    if (resp.status !== 400 && resp.status !== 422) break; // 404/410: gone — next model
  }
  if (!resp.ok) {
    let detail = "";
    try { detail = (await resp.text()).slice(0, 200); } catch { /* none */ }
    const err = new Error(`${model}: HTTP ${resp.status} ${detail}`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  const msg = data?.choices?.[0]?.message || {};
  const actions = (msg.tool_calls || [])
    .map((c) => {
      let args = {};
      try {
        args = typeof c.function?.arguments === "string" ? JSON.parse(c.function.arguments || "{}") : c.function?.arguments || {};
      } catch {
        args = {};
      }
      return describe(c.function?.name, args);
    })
    .filter(Boolean)
    .slice(0, 4);
  let reply = clean(msg.content);
  if (!reply && actions.length) reply = "That needs your computer, and this preview can't reach it.";
  if (!reply) throw new Error(`${model}: empty reply`);
  return { reply, actions, model };
}

/** /api/health?check=1: try each model once and report what NVIDIA said. */
async function check(env, fetchImpl) {
  const results = {};
  for (const model of models(env)) {
    const t0 = Date.now();
    try {
      const hello = [{ role: "user", content: "Say hello in five words." }];
      let reply;
      if (model.startsWith("@cf/") && env.AI) reply = await (await openWorkersAI(env, model, hello)).next();
      else reply = (await callModel(env, model, hello, fetchImpl)).reply;
      results[model] = { ok: true, ms: Date.now() - t0, reply: String(reply || "").slice(0, 80) };
    } catch (err) {
      results[model] = { ok: false, ms: Date.now() - t0, error: String(err && err.message ? err.message : err).slice(0, 240) };
    }
  }
  return results;
}

export async function chat(request, env, fetchImpl = fetch) {
  if (request.method !== "POST") return json(405, { error: "method" }, { allow: "POST" });

  // Only this site's own pages may use the preview.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json(403, { error: "origin" });

  if (!apiKey(env)) return json(503, { error: "resting" });

  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (env.CHAT_LIMIT) {
    const { success } = await env.CHAT_LIMIT.limit({ key: ip });
    if (!success) return json(429, { error: "busy" }, { "retry-after": "60" });
  }

  const raw = await request.text();
  if (raw.length > LIMITS.bodyBytes) return json(413, { error: "too_long" });
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad_request" });
  }
  const messages = sanitize(body);
  if (!messages) return json(400, { error: "bad_request" });

  let opened;
  try {
    opened = await race(env, messages, fetchImpl);
  } catch (err) {
    console.log("preview failed", String(err && err.message ? err.message : err));
    // NVIDIA's own limit on the key: say "busy", as for the per-visitor limit.
    if (err && err.throttled) return json(429, { error: "busy" }, { "retry-after": "30" });
    return json(502, { error: "unavailable" });
  }
  return new Response(relay(opened), {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-model": opened.model },
  });
}

// ── streaming ────────────────────────────────────────────────────────────
// The reply streams to the page as NDJSON lines:
//   {"t":"text","v":"…"}            more of the answer
//   {"t":"done","actions":[…]}       the end, with any "Mike would…" steps
//   {"t":"error"}                    it broke off

/** How long a model may take to start answering before a second one races it.
 *  (An object, not a bare number: the Workers runtime treats every export as
 *  a possible entry point and rejects plain values.) */
export const TIMING = { HEDGE_MS: 3000 };
const HEDGE_MS = TIMING.HEDGE_MS;
const STREAM_TOTAL_MS = 45000;

/** Reads one SSE stream from an OpenAI-compatible endpoint, event by event. */
class Stream {
  constructor(model, resp, ctrl) {
    this.model = model;
    this.reader = resp.body.getReader();
    this.ctrl = ctrl;
    this.decoder = new TextDecoder();
    this.buf = "";
    this.raw = "";        // everything the model has said
    this.sent = 0;        // how much of the visible answer has gone out
    this.tools = [];      // tool calls, assembled from their pieces
    this.queue = [];      // visible text not yet relayed
    this.finished = false;
  }

  visible() {
    const text = this.raw;
    // "<think>" can arrive split across pieces: hold back a partial tag.
    const head = text.replace(/^\s+/, "");
    if (head && "<think>".startsWith(head.toLowerCase())) return "";
    const open = text.search(/<think>/i);
    if (open === -1) return text.replace(/^\s+/, "");
    const close = text.search(/<\/think>/i);
    if (close === -1) return text.slice(0, open).replace(/^\s+/, "");
    return clean(text);
  }

  take(event) {
    const delta = event?.choices?.[0]?.delta || {};
    if (typeof delta.content === "string") this.raw += delta.content;
    for (const t of delta.tool_calls || []) {
      const i = t.index ?? this.tools.length;
      this.tools[i] = this.tools[i] || { name: "", args: "" };
      if (t.function?.name) this.tools[i].name += t.function.name;
      if (t.function?.arguments) this.tools[i].args += t.function.arguments;
    }
    const vis = this.visible();
    if (vis.length > this.sent) {
      this.queue.push(vis.slice(this.sent));
      this.sent = vis.length;
    }
  }

  /** Pull events until there's something to show (or the end). */
  async next() {
    while (!this.queue.length && !this.finished) {
      const { value, done } = await this.reader.read();
      if (done) { this.finished = true; break; }
      this.buf += this.decoder.decode(value, { stream: true });
      let nl;
      while ((nl = this.buf.indexOf("\n")) !== -1) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") { this.finished = true; continue; }
        try { this.take(JSON.parse(data)); } catch { /* keep-alive or partial */ }
      }
    }
    return this.queue.length ? this.queue.splice(0).join("") : null;
  }

  /** Has it started answering (text, or a tool call)? */
  started() { return this.queue.length > 0 || this.tools.length > 0; }

  actions() {
    return this.tools
      .map((t) => { let a = {}; try { a = JSON.parse(t.args || "{}"); } catch { a = {}; } return describe(t.name, a); })
      .filter(Boolean)
      .slice(0, 4);
  }

  cancel() { try { this.ctrl.abort(); } catch { /* already done */ } }
}

async function open(env, model, messages, fetchImpl) {
  const ctrl = new AbortController();
  let resp = null;
  for (const shape of SHAPES) {
    resp = await fetchImpl(env.CHAT_API_URL || NVIDIA_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${apiKey(env)}`, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(requestBody(model, messages, shape, true)),
    });
    if (resp.status !== 400 && resp.status !== 422) break;
  }
  if (!resp.ok || !resp.body) {
    let detail = "";
    try { detail = (await resp.text()).slice(0, 200); } catch { /* none */ }
    const err = new Error(`${model}: HTTP ${resp.status} ${detail}`);
    err.status = resp.status;
    throw err;
  }
  const stream = new Stream(model, resp, ctrl);
  // Wait for the first real sign of an answer before declaring it the winner.
  while (!stream.started() && !stream.finished) {
    const chunk = await stream.next();
    if (chunk) { stream.queue.unshift(chunk); break; }
  }
  if (!stream.started()) throw new Error(`${model}: empty reply`);
  return stream;
}

/** A finished Workers AI answer, shaped like a Stream so the race can use it. */
class Answer {
  constructor(model, text, tools) {
    this.model = model;
    this.queue = text ? [text] : [];
    this.sent = text.length;
    this.tools = tools;
    this.finished = true;
  }
  async next() { return this.queue.length ? this.queue.splice(0).join("") : null; }
  started() { return this.queue.length > 0 || this.tools.length > 0; }
  actions() { return Stream.prototype.actions.call(this); }
  cancel() {}
}

// Given tools, Workers AI's Llama answers every message with a tool call —
// "hey" became "look at your screen", "2+2" a terminal command. So answering
// in words is a tool too: each turn is an explicit choice between saying
// something and what the desktop Mike would do.
export const REPLY = {
  name: "reply",
  description: "Answer the visitor in words: conversation, questions, explanations, studying help, writing, maths and code — anything that doesn't need their computer. Give the whole answer here, as complete as the question deserves.",
  parameters: { type: "object", properties: { text: str("Your full answer, in Mike's own voice (you are Mike, never 'a language model'): explain with a simple example, show the steps of maths, write the whole poem or email, use short paragraphs or a list when it helps") }, required: ["text"] },
};
const REPLY_NOTE = "Here you answer only through tools: reply for anything you say in words, the others for what the desktop Mike would do on their computer. In reply you speak as Mike, warmly and like a person — never as \"a computer program\" or \"a language model\".";

async function openWorkersAI(env, model, messages) {
  const tools = [REPLY, ...TOOLS.map((t) => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters }))];
  const out = await env.AI.run(model, {
    messages: [{ role: "system", content: `${SYSTEM}\n\n${REPLY_NOTE}` }, ...messages],
    tools,
    max_tokens: LIMITS.maxTokens,
    temperature: 0.4,
  });
  const said = [];
  const shaped = [];
  for (const c of (out && out.tool_calls) || []) {
    const f = c.function || c;
    if (f.name === REPLY.name) {
      let args = f.arguments;
      if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = { text: args }; } }
      said.push(String(args?.text ?? ""));
      continue;
    }
    const args = typeof f.arguments === "string" ? f.arguments : JSON.stringify(f.arguments || {});
    shaped.push({ name: f.name || "", args });
  }
  const text = clean([typeof out?.response === "string" ? out.response : "", ...said].filter((s) => s.trim()).join("\n\n"));
  const answer = new Answer(model, text, shaped);
  if (!answer.started()) throw new Error(`${model}: empty reply`);
  return answer;
}

/**
 * Start the first model; if it hasn't begun answering within HEDGE_MS, start
 * the next one too, and use whichever answers first. A model that fails
 * outright (retired, rejected) hands over at once.
 */
export function race(env, messages, fetchImpl) {
  const list = models(env);
  return new Promise((resolve, reject) => {
    let i = 0, running = 0, won = false, throttled = false, last = null;
    const giveUp = () => {
      if (!won && running === 0 && i >= list.length) {
        const err = last || new Error("no model answered");
        err.throttled = throttled;
        reject(err);
      }
    };
    const launch = () => {
      if (won || i >= list.length) return giveUp();
      const model = list[i++];
      running++;
      const hedge = setTimeout(launch, HEDGE_MS);
      (model.startsWith("@cf/") && env.AI ? openWorkersAI(env, model, messages) : open(env, model, messages, fetchImpl)).then((stream) => {
        clearTimeout(hedge);
        running--;
        if (won) { stream.cancel(); return; }
        won = true;
        resolve(stream);
      }, (err) => {
        clearTimeout(hedge);
        running--;
        if (err && err.status === 429) throttled = true;
        last = err;
        console.log("preview model failed", String(err && err.message ? err.message : err));
        if (!won) launch();
        giveUp();
      });
    };
    launch();
    // Nobody started answering in time: stop waiting (late starters are cancelled).
    setTimeout(() => {
      if (!won) { won = true; const err = last || new Error("timed out"); err.throttled = throttled; reject(err); }
    }, STREAM_TOTAL_MS);
  });
}

function relay(stream) {
  const enc = new TextEncoder();
  const line = (o) => enc.encode(JSON.stringify(o) + "\n");
  return new ReadableStream({
    async pull(controller) {
      try {
        const text = await stream.next();
        if (text) { controller.enqueue(line({ t: "text", v: text })); return; }
        const actions = stream.actions();
        if (!stream.sent && actions.length) {
          controller.enqueue(line({ t: "text", v: "That needs your computer, and this preview can't reach it." }));
        }
        controller.enqueue(line({ t: "done", actions, model: stream.model }));
        controller.close();
      } catch (err) {
        console.log("preview stream broke", String(err && err.message ? err.message : err));
        controller.enqueue(line({ t: "error" }));
        controller.close();
      }
    },
    cancel() { stream.cancel(); },
  });
}

// ── the visitor's own Cloudflare account, for reading their files ────────
// Reading an uploaded PDF or photo runs on the visitor's own free Workers AI
// allowance, connected with Cloudflare's own sign-in (OAuth with PKCE — the
// same client, scopes and model as Fast mode in the desktop app). Cloudflare's
// token and API endpoints don't allow calls from a web page, so these three
// routes relay them. Nothing is stored here: the token lives in the visitor's
// tab, and a file passes through once, on its way to their own account.

export const CF = {
  clientId: "b4b5f1fe7d789f7ce244eaee8b647348", // public by design: PKCE, no secret
  scopes: "ai.read ai.write account-settings.read offline_access",
  authUrl: "https://dash.cloudflare.com/oauth2/auth",
  tokenUrl: "https://dash.cloudflare.com/oauth2/token",
  revokeUrl: "https://dash.cloudflare.com/oauth2/revoke",
  api: "https://api.cloudflare.com/client/v4",
  model: "@cf/google/gemma-4-26b-a4b-it",
  callback: "/chat/cloudflare.html",
  bodyBytes: 9_000_000,
  turns: 12,
  chars: 4000,       // per typed message
  fileChars: 120000, // all the file text in one request
  images: 6,
  imageBytes: 1_600_000,
  maxTokens: 1400,
};

const CF_SYSTEM = `You are Mike, a personal AI assistant that lives on people's computers (Windows for now). You're warm, clear and direct — like a sharp friend, never "a language model". You were built by Navdeep and the team at Huddle Labs; say so if someone asks who made you.

Right now you're on Mike's website, running on the visitor's own Cloudflare account. They can attach files: the text of PDFs and documents arrives in their message, and photos arrive as images. Read what they attach carefully and do what they ask with it — summarise, explain, answer questions, make notes, flashcards or a quiz, pull out dates or numbers. Quote the file when it helps. If part of a photo is hard to read, say what you can make out instead of guessing.

You can't touch their computer from here; the desktop Mike can open apps, find and edit files, and read their screen. Use short paragraphs, and lists or **bold** where they help. Answer as fully as the question needs.`;

function sameSite(request) {
  const origin = request.headers.get("origin");
  return Boolean(origin) && new URL(origin).host === new URL(request.url).host;
}

async function limited(request, env) {
  if (!env.CHAT_LIMIT) return false;
  const { success } = await env.CHAT_LIMIT.limit({ key: "cf:" + (request.headers.get("cf-connecting-ip") || "local") });
  return !success;
}

function cfClientId(env) {
  return String(env.CF_CLIENT_ID || CF.clientId).trim();
}

/** POST {code, verifier} or {refresh}: tokens, plus the account they act for. */
export async function cfToken(request, env, fetchImpl = fetch) {
  if (request.method !== "POST") return json(405, { error: "method" }, { allow: "POST" });
  if (!sameSite(request)) return json(403, { error: "origin" });
  if (await limited(request, env)) return json(429, { error: "busy" }, { "retry-after": "60" });
  let body;
  try { body = JSON.parse((await request.text()).slice(0, 8000)); } catch { return json(400, { error: "bad_request" }); }
  const fields = { client_id: cfClientId(env) };
  if (typeof body?.code === "string" && typeof body?.verifier === "string") {
    Object.assign(fields, {
      grant_type: "authorization_code", code: body.code, code_verifier: body.verifier,
      redirect_uri: new URL(CF.callback, request.url).href,
    });
  } else if (typeof body?.refresh === "string") {
    Object.assign(fields, { grant_type: "refresh_token", refresh_token: body.refresh });
  } else {
    return json(400, { error: "bad_request" });
  }
  let resp;
  try {
    resp = await fetchImpl(CF.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(fields).toString(),
    });
  } catch {
    return json(502, { error: "unavailable" });
  }
  if (!resp.ok) {
    console.log("cloudflare token refused", resp.status);
    return json(401, { error: "cf_auth" });
  }
  const tokens = await resp.json();
  const out = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || body.refresh || null, // they rotate: keep the newest
    expires_in: Number(tokens.expires_in) || 3600,
  };
  if (fields.grant_type === "authorization_code") {
    try {
      const acc = await fetchImpl(`${CF.api}/accounts?per_page=50`, { headers: { authorization: `Bearer ${out.access_token}` } });
      const data = await acc.json();
      const first = (data?.result || [])[0];
      if (!first) return json(403, { error: "no_account" });
      out.account = { id: first.id, name: first.name || "" };
    } catch {
      return json(502, { error: "unavailable" });
    }
  }
  return json(200, out);
}

/** POST {refresh}: ask Cloudflare to withdraw the connection. */
export async function cfRevoke(request, env, fetchImpl = fetch) {
  if (request.method !== "POST") return json(405, { error: "method" }, { allow: "POST" });
  if (!sameSite(request)) return json(403, { error: "origin" });
  let body;
  try { body = JSON.parse((await request.text()).slice(0, 8000)); } catch { return json(400, { error: "bad_request" }); }
  if (typeof body?.refresh !== "string") return json(400, { error: "bad_request" });
  try {
    await fetchImpl(CF.revokeUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: body.refresh, token_type_hint: "refresh_token", client_id: cfClientId(env) }).toString(),
    });
  } catch { /* forgotten in the tab either way */ }
  return json(200, { ok: true });
}

/** The conversation for the visitor's own model: their words, their files. */
export function cfMessages(body) {
  if (!body || !Array.isArray(body.messages)) return null;
  let fileChars = CF.fileChars;
  let images = CF.images;
  const out = [{ role: "system", content: CF_SYSTEM }];
  for (const m of body.messages.slice(-CF.turns)) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") continue;
    let text = m.content.slice(0, m.role === "user" ? CF.chars : CF.chars * 3).trim();
    if (m.role === "assistant") { if (text) out.push({ role: "assistant", content: text }); continue; }
    for (const f of Array.isArray(m.files) ? m.files : []) {
      if (!f || typeof f.name !== "string" || typeof f.text !== "string" || fileChars <= 0) continue;
      const name = f.name.slice(0, 120);
      const part = f.text.slice(0, fileChars);
      fileChars -= part.length;
      text += `\n\n[Attached file: ${name}]\n${part}${part.length < f.text.length ? "\n[…the rest of the file was cut to fit]" : ""}\n[End of ${name}]`;
    }
    const pics = [];
    for (const img of Array.isArray(m.images) ? m.images : []) {
      if (images <= 0) break;
      if (typeof img !== "string" || img.length > CF.imageBytes || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img)) continue;
      pics.push({ type: "image_url", image_url: { url: img } });
      images--;
    }
    if (!text && !pics.length) continue;
    out.push(pics.length ? { role: "user", content: [{ type: "text", text: text || "What's in this?" }, ...pics] } : { role: "user", content: text });
  }
  return out.length > 1 && out[out.length - 1].role === "user" ? out : null;
}

/** POST {account, messages} with the visitor's token: streams their model's answer. */
export async function cfChat(request, env, fetchImpl = fetch) {
  if (request.method !== "POST") return json(405, { error: "method" }, { allow: "POST" });
  if (!sameSite(request)) return json(403, { error: "origin" });
  const auth = request.headers.get("authorization") || "";
  if (!/^Bearer [\w.~+/=-]{10,}$/.test(auth)) return json(401, { error: "cf_auth" });
  if (await limited(request, env)) return json(429, { error: "busy" }, { "retry-after": "60" });
  const raw = await request.text();
  if (raw.length > CF.bodyBytes) return json(413, { error: "too_long" });
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { error: "bad_request" }); }
  const account = String(body?.account || "");
  if (!/^[a-f0-9]{32}$/.test(account)) return json(400, { error: "bad_request" });
  const messages = cfMessages(body);
  if (!messages) return json(400, { error: "bad_request" });

  const ctrl = new AbortController();
  let resp;
  try {
    resp = await fetchImpl(`${CF.api}/accounts/${account}/ai/v1/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { authorization: auth, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ model: CF.model, messages, stream: true, max_tokens: CF.maxTokens, temperature: 0.4 }),
    });
  } catch {
    return json(502, { error: "unavailable" });
  }
  if (!resp.ok || !resp.body) {
    let detail = "";
    try { detail = (await resp.text()).slice(0, 300).toLowerCase(); } catch { /* none */ }
    if (resp.status === 401 || resp.status === 403) return json(401, { error: "cf_auth" });
    if (resp.status === 429 || /4006|neuron|allocation/.test(detail)) return json(429, { error: "cf_limit" });
    console.log("cloudflare model failed", resp.status, detail.slice(0, 120));
    return json(502, { error: "unavailable" });
  }
  return new Response(relay(new Stream(CF.model, resp, ctrl)), {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-model": CF.model },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/chat") return chat(request, env);
    if (url.pathname === "/api/cf/token") return cfToken(request, env);
    if (url.pathname === "/api/cf/revoke") return cfRevoke(request, env);
    if (url.pathname === "/api/cf/chat") return cfChat(request, env);
    if (url.pathname === "/api/cf/config") return json(200, { clientId: cfClientId(env), scopes: CF.scopes, authUrl: CF.authUrl, callback: CF.callback });
    // Is the preview configured? (Never reveals the key itself.)
    if (url.pathname === "/api/health") {
      const out = { key: Boolean(apiKey(env)), models: models(env) };
      if (url.searchParams.get("check") && out.key) {
        if (env.CHAT_LIMIT) {
          const { success } = await env.CHAT_LIMIT.limit({ key: "health:" + (request.headers.get("cf-connecting-ip") || "local") });
          if (!success) return json(429, { error: "busy" });
        }
        out.check = await check(env, fetch);
      }
      return json(200, out);
    }
    return env.ASSETS.fetch(request);
  },
};
