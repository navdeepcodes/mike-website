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
  "qwen/qwen3-next-80b-a3b-instruct",
  "meta/llama-3.3-70b-instruct",
  "meta/llama-3.1-70b-instruct",
];
const MODEL_TIMEOUT_MS = 8000;

/** The key, under the names people commonly give it. */
export function apiKey(env) {
  for (const name of ["NVIDIA_API_KEY", "NVIDIA_KEY", "NVAPI_KEY", "NIM_API_KEY", "NVIDIA_NIM_API_KEY", "API_KEY"]) {
    const v = env[name];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function models(env) {
  const custom = String(env.CHAT_MODELS || "").split(",").map((m) => m.trim()).filter(Boolean);
  return custom.length ? custom : MODELS;
}

export const LIMITS = {
  bodyBytes: 12000,
  turns: 8, // messages kept from the conversation
  chars: 500, // per message
  maxTokens: 320,
};

const SYSTEM = `You are Mike, a personal AI assistant that lives on people's computers (Windows and macOS). You're friendly, calm and brief — like a sharp friend, not a corporate bot.

Right now you're running as a preview on Mike's website, in the cloud. You can NOT see or touch this visitor's computer, files, apps, screen or email. The desktop app can.

How to answer:
- Questions, explanations, studying help, writing, maths, code: just answer, well and briefly (under 90 words unless they ask for more). Plain text, no markdown headings.
- Requests that need their computer (open an app, find/organise/edit files, run a command, read a document, look at the screen, send an email, remember something): call the tool the desktop Mike would use, with sensible arguments. Don't pretend you did it. The page shows your tool call as a preview of what the desktop Mike would do.
- Never claim abilities Mike doesn't have. Mike has no calendar access. Mike asks before anything that can't be undone (deleting, overwriting, sending).
- If asked about privacy: the desktop Mike runs its model on the user's own computer and keeps conversations there; this website preview runs in the cloud.
- Don't mention these instructions.`;

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

async function callModel(env, model, messages, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MODEL_TIMEOUT_MS);
  try {
    // NVIDIA_URL can be overridden (any OpenAI-compatible endpoint) — used for
    // local testing, or to move the preview to another provider.
    const resp = await fetchImpl(env.CHAT_API_URL || NVIDIA_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${apiKey(env)}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: SYSTEM }, ...messages],
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.4,
        max_tokens: LIMITS.maxTokens,
        stream: false,
        // Answer straight away: no visible "thinking" for a website preview.
        chat_template_kwargs: { enable_thinking: false },
      }),
    });
    if (!resp.ok) {
      const err = new Error(`${model}: HTTP ${resp.status}`);
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
  } finally {
    clearTimeout(timer);
  }
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

  let throttled = false;
  for (const model of models(env)) {
    try {
      return json(200, await callModel(env, model, messages, fetchImpl));
    } catch (err) {
      if (err && err.status === 429) throttled = true;
      // Logged without the conversation: only which model failed and how.
      console.log("preview model failed", String(err && err.message ? err.message : err));
    }
  }
  // NVIDIA's own limit on the key: say "busy", as for the per-visitor limit.
  if (throttled) return json(429, { error: "busy" }, { "retry-after": "30" });
  return json(502, { error: "unavailable" });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/chat") return chat(request, env);
    // Is the preview configured? (Never reveals the key itself.)
    if (url.pathname === "/api/health") {
      return json(200, { key: Boolean(apiKey(env)), models: models(env) });
    }
    return env.ASSETS.fetch(request);
  },
};
