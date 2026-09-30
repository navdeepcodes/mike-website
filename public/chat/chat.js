// Try Mike — the in-browser chat.
//
// Talks to /api/chat (src/worker.js): a cloud model prompted as Mike, with
// Mike's real tool list. Anything that needs the visitor's computer comes back
// as steps — shown as "On your computer, Mike would…" with a way to get Mike.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const app = $("app");
  const thread = $("thread");
  const scroller = $("scroll");
  const form = $("composer");
  const input = $("input");
  const send = $("send");
  const count = $("count");
  const title = $("title");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const STORE = "mike-preview-chat";
  const MAX_TURNS = 8;
  let turns = [];
  let busy = null; // the AbortController of the request in flight

  // Files: read here in the browser, then sent with the message to the
  // visitor's own Cloudflare account (cloud.js). What was read is kept in
  // memory only, never in storage.
  const cloud = window.MikeCloud;
  const tray = $("tray");
  const fileInput = $("file");
  const attachBtn = $("attach");
  const pill = $("cfpill");
  const CF_TURNS = 12;
  let pending = [];           // attached, not yet sent
  let waiting = null;         // a message held until Cloudflare is connected
  const payloads = new Map(); // turn index -> { files, images }

  // ── storage: the conversation survives a refresh, not a closed tab ──
  function load() {
    try {
      const raw = sessionStorage.getItem(STORE);
      const data = raw ? JSON.parse(raw) : null;
      return Array.isArray(data) ? data.filter((m) => m && typeof m.content === "string") : [];
    } catch (_) {
      return [];
    }
  }
  function save() {
    try { sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-24))); } catch (_) { /* private mode */ }
  }

  // ── greeting, like the app ──
  const h = new Date().getHours();
  $("greeting").textContent =
    h >= 5 && h < 12 ? "Good morning." : h >= 12 && h < 17 ? "Good afternoon." : h >= 17 && h < 22 ? "Good evening." : "Still up?";

  // ── safe Markdown: escape everything, then allow a small set of forms ──
  function esc(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function inline(s) {
    return s
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  }
  function markdown(text) {
    const out = [];
    const parts = String(text).split(/```/);
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        const code = part.replace(/^[\w+-]*\n/, "");
        out.push("<pre><code>" + esc(code.replace(/\n$/, "")) + "</code></pre>");
        return;
      }
      const lines = esc(part).split("\n");
      let para = [];
      let list = null;
      const flushPara = () => { if (para.length) { out.push("<p>" + inline(para.join("<br>")) + "</p>"); para = []; } };
      const flushList = () => { if (list) { out.push(`<${list.tag}>` + list.items.map((li) => "<li>" + inline(li) + "</li>").join("") + `</${list.tag}>`); list = null; } };
      lines.forEach((raw) => {
        const line = raw.trimEnd();
        const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
        const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
        const heading = line.match(/^#{1,4}\s+(.*)$/);
        if (bullet || numbered) {
          flushPara();
          const tag = bullet ? "ul" : "ol";
          if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
          list.items.push((bullet || numbered)[1]);
        } else if (heading) {
          flushPara(); flushList();
          out.push("<h3>" + inline(heading[1]) + "</h3>");
        } else if (!line.trim()) {
          flushPara(); flushList();
        } else {
          flushList();
          para.push(line);
        }
      });
      flushPara(); flushList();
    });
    return out.join("");
  }

  // ── "Get Mike": Windows-only for now ──
  const GET_LABEL = "Get Mike for Windows";

  // ── building the thread ──
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function nib() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "nibmark");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(ns, "use");
    use.setAttribute("href", "#nib");
    svg.appendChild(use);
    return svg;
  }

  function addYou(text, names) {
    const li = el("li", "msg msg--you");
    if (names && names.length) {
      const row = el("div", "sent-files");
      names.forEach((n) => row.appendChild(el("span", "sent-file", n)));
      li.appendChild(row);
    }
    li.appendChild(el("div", "bubble", text));
    thread.appendChild(li);
    return li;
  }

  function addMike() {
    const li = el("li", "msg msg--mike");
    const body = el("div", "prose");
    li.appendChild(body);
    thread.appendChild(li);
    return { li, body };
  }

  // Thinking: the nib writes what Mike is doing, in handwriting — as in the app.
  const PHRASES = ["Thinking", "Working it out", "One moment", "Nearly there"];
  function thinking(body) {
    const t = el("span", "thinking");
    body.replaceChildren(t);
    if (!window.MikePen || reduceMotion) {
      t.appendChild(nib());
      t.appendChild(el("span", "", "Thinking"));
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", "Thinking");
    canvas.setAttribute("role", "img");
    t.classList.add("thinking--script");
    t.appendChild(canvas);
    const writer = new window.MikePen.Writer(canvas, { cap: 24, align: "left", speed: 1.3, maxWidth: 360, pad: 0.2, weight: 1.05 });
    (async () => {
      let i = 0;
      while (canvas.isConnected) {
        await writer.write(PHRASES[i++ % PHRASES.length] + "…");
        if (!canvas.isConnected) break;
        await new Promise((r) => setTimeout(r, 700));
        await writer.fade(320);
      }
    })();
  }

  function tools(li, text) {
    const row = el("div", "msg__tools");
    const copy = el("button", "tool", "Copy");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = "Copied"; }
      catch (_) { copy.textContent = "Couldn't copy"; }
      setTimeout(() => (copy.textContent = "Copy"), 1600);
    });
    row.appendChild(copy);
    li.appendChild(row);
  }

  function steps(li, actions) {
    const card = el("div", "steps");
    const head = el("div", "steps__head");
    head.appendChild(nib());
    head.appendChild(el("span", "", "On your computer, Mike would"));
    card.appendChild(head);
    const list = el("ol", "steps__list");
    actions.forEach((a, i) => {
      const row = el("li", "step");
      row.appendChild(el("span", "step__dot", String(i + 1)));
      const text = el("div");
      text.appendChild(el("div", "step__title", a.title));
      if (a.detail) text.appendChild(el("div", "step__detail", a.detail));
      if (a.asks_first) text.appendChild(el("span", "step__ask", "Asks you first"));
      row.appendChild(text);
      list.appendChild(row);
    });
    card.appendChild(list);
    const foot = el("div", "steps__foot");
    foot.appendChild(el("span", "", "The desktop Mike can actually do this."));
    const cta = el("a", "btn btn--accent btn--sm", GET_LABEL);
    cta.href = "/#download";
    foot.appendChild(cta);
    card.appendChild(foot);
    li.appendChild(card);
  }

  const NOTICES = {
    busy: "Lots of people are trying Mike right now. Give it a minute — or get the desktop Mike, which has no limits.",
    resting: "The preview is resting for the moment. The desktop Mike is always on.",
    offline: "You seem to be offline. Check your connection and try again.",
    failed: "I couldn't answer that just now. Try again in a moment.",
    cf_limit: "Your Cloudflare account's free AI allowance for today is used up. It resets at midnight UTC (5:30 am in India).",
    too_long: "That's more than I can read in one go here. Try fewer or smaller files.",
  };

  function notice(li, kind, retry) {
    li.classList.add("msg--notice");
    const box = el("div", "notice");
    box.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M10 6.5v4.5M10 13.5v.01"/></svg>';
    const text = el("div");
    text.appendChild(el("div", "", NOTICES[kind] || NOTICES.failed));
    const actions = el("div", "notice__actions");
    if (retry) {
      const again = el("button", "btn btn--ghost btn--sm", "Try again");
      again.type = "button";
      again.addEventListener("click", () => { li.remove(); retry(); });
      actions.appendChild(again);
    }
    if (kind === "busy" || kind === "resting") {
      const get = el("a", "btn btn--ink btn--sm", GET_LABEL);
      get.href = "/#download";
      actions.appendChild(get);
    }
    if (actions.children.length) text.appendChild(actions);
    box.appendChild(text);
    li.replaceChildren(box);
  }

  // ── scrolling: follow the answer unless the reader scrolled up ──
  let pinned = true;
  scroller.addEventListener("scroll", () => {
    pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    app.classList.toggle("is-scrolled", scroller.scrollTop > 4);
  });
  function follow(force) {
    if (force || pinned) scroller.scrollTop = scroller.scrollHeight;
  }

  // ── state ──
  function setBusy(controller) {
    busy = controller;
    app.classList.toggle("is-busy", !!controller);
    send.setAttribute("aria-label", controller ? "Stop" : "Send");
    syncSend();
  }
  function syncSend() {
    const ready = pending.some((f) => f.status === "ready");
    const reading = pending.some((f) => f.status === "reading");
    send.disabled = !busy && (reading || (!input.value.trim() && !ready));
    const n = input.value.length;
    count.hidden = n < 400;
    count.textContent = `${n}/500`;
  }
  function setTitle() {
    const first = turns.find((m) => m.role === "user");
    const text = first ? first.content : "New chat";
    title.textContent = text.length > 60 ? text.slice(0, 59) + "…" : text;
    app.classList.toggle("has-thread", turns.length > 0);
  }

  // ── asking: the answer streams in as Mike writes it ──
  async function ask() {
    const { li, body } = addMike();
    thinking(body);
    follow(true);
    const controller = new AbortController();
    setBusy(controller);
    const fail = (kind) => {
      notice(li, kind, kind === "busy" || kind === "resting" ? null : ask);
      setBusy(null);
      follow();
    };
    let res;
    try {
      res = await request(controller.signal);
    } catch (err) {
      if (err && err.name === "AbortError") { li.remove(); setBusy(null); return; }
      return fail(navigator.onLine === false ? "offline" : "failed");
    }
    if (!res.ok || !res.body) {
      const why = await res.json().catch(() => ({}));
      if (why.error === "cf_auth") {
        // Cloudflare no longer takes the token: connect again, then carry on.
        cloud.forget();
        syncPill();
        li.remove();
        setBusy(null);
        return askToConnect(null, [], true);
      }
      if (why.error === "cf_limit" || why.error === "too_long") return fail(why.error);
      return fail(res.status === 429 ? "busy" : res.status === 503 ? "resting" : "failed");
    }

    let text = "";
    let actions = [];
    let broke = false;
    let painted = 0;
    let frame = 0;
    const paint = () => {
      frame = 0;
      if (text.length === painted) return;
      painted = text.length;
      body.innerHTML = markdown(text);
      follow();
    };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev;
          try { ev = JSON.parse(line); } catch (_) { continue; }
          if (ev.t === "text") {
            text += ev.v;
            if (!frame) frame = requestAnimationFrame(paint);
          } else if (ev.t === "done") {
            actions = Array.isArray(ev.actions) ? ev.actions : [];
          } else if (ev.t === "error") {
            broke = true;
          }
        }
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        // Stopped mid-answer: keep what was written.
        if (!text) { li.remove(); setBusy(null); return; }
      } else {
        broke = true;
      }
    }
    if (frame) cancelAnimationFrame(frame);
    paint();
    if (!text) return fail("failed");
    turns.push({ role: "assistant", content: text, actions });
    save();
    if (actions.length) steps(li, actions);
    if (broke) li.appendChild(el("p", "msg__cut", "The answer was cut short."));
    tools(li, text);
    setBusy(null);
    follow();
  }

  function submit(text) {
    const value = (text || "").trim().slice(0, 500);
    const files = pending.filter((f) => f.status === "ready");
    if (busy || pending.some((f) => f.status === "reading")) return;
    if (!value && !files.length) return;
    if (files.length && !(cloud && cloud.connected())) return askToConnect(value, files);
    post(value, files);
  }

  function post(value, files) {
    const content = value || "Have a look at this and tell me what's in it.";
    const names = files.map((f) => f.name);
    turns.push(names.length ? { role: "user", content, files: names } : { role: "user", content });
    if (files.length) {
      payloads.set(turns.length - 1, {
        files: files.filter((f) => f.text).map((f) => ({ name: f.name, text: f.text })),
        images: files.flatMap((f) => f.images || []),
      });
    }
    save();
    addYou(content, names);
    setTitle();
    input.value = "";
    pending = [];
    renderTray();
    grow();
    ask();
  }

  /** The answer's request: the visitor's own Cloudflare when connected,
   *  the shared preview otherwise. */
  async function request(signal) {
    const token = cloud && cloud.connected() ? await cloud.token() : null;
    if (token) {
      const start = Math.max(0, turns.length - CF_TURNS);
      const messages = turns.slice(start).map((m, k) => {
        const p = payloads.get(start + k);
        return p ? { role: m.role, content: m.content, files: p.files, images: p.images } : { role: m.role, content: m.content };
      });
      return fetch("/api/cf/chat", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + token },
        body: JSON.stringify({ account: cloud.account().id, messages }),
        signal,
      });
    }
    return fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: turns.slice(-MAX_TURNS).map((m) => ({ role: m.role, content: m.content })) }),
      signal,
    });
  }

  // ── connecting the visitor's Cloudflare, when there are files to read ──
  const CONNECT_ERRORS = {
    closed: "The Cloudflare window was closed before it finished.",
    declined: "Cloudflare wasn't allowed to connect.",
    no_account: "That Cloudflare sign-in didn't come with an account. Try again and pick your account.",
  };

  function askToConnect(value, files, again) {
    waiting = again ? { resend: true } : { value, files };
    if (!again) {
      pending = [];
      renderTray();
      input.value = "";
      grow();
    }
    const li = el("li", "msg msg--mike msg--connect");
    const box = el("div", "connect");
    const head = el("div", "connect__head");
    head.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10.5a3.5 3.5 0 0 0 .4-7A5.5 5.5 0 0 0 7.3 9.6 4.2 4.2 0 0 0 7 18Z"/></svg>';
    head.appendChild(el("b", "", again ? "Connect your Cloudflare again" : "Read your files on your own Cloudflare"));
    box.appendChild(head);
    box.appendChild(el("p", "", again
      ? "Cloudflare asked to sign in again. Once you do, I'll carry on."
      : "Reading PDFs and photos runs on your own free Cloudflare account — the way Fast mode works in the desktop Mike. It takes a minute to set up, and it's free."));
    if (!again && files.length) {
      const row = el("div", "sent-files");
      files.forEach((f) => row.appendChild(el("span", "sent-file", f.name)));
      box.appendChild(row);
    }
    const actions = el("div", "connect__actions");
    const go = el("button", "btn btn--try btn--sm", "Connect Cloudflare");
    go.type = "button";
    const later = el("button", "btn btn--ghost btn--sm", "Not now");
    later.type = "button";
    actions.append(go, later);
    box.appendChild(actions);
    box.appendChild(el("p", "connect__fine", "Your files go to your own account and aren't kept by Huddle Labs. Disconnect any time from the “Your Cloudflare” button."));
    const err = el("p", "connect__err");
    err.hidden = true;
    box.appendChild(err);
    li.appendChild(box);
    thread.appendChild(li);
    app.classList.add("has-thread");
    follow(true);

    go.addEventListener("click", async () => {
      go.disabled = true;
      go.textContent = "Waiting for Cloudflare…";
      err.hidden = true;
      try {
        await cloud.connect();
      } catch (e) {
        go.disabled = false;
        go.textContent = "Try again";
        err.textContent = CONNECT_ERRORS[e && e.kind] || "Couldn't connect just now. Try again in a moment.";
        err.hidden = false;
        return;
      }
      li.remove();
      syncPill();
      const w = waiting;
      waiting = null;
      if (w && w.resend) ask();
      else if (w) post(w.value, w.files);
    });
    later.addEventListener("click", () => {
      li.remove();
      const w = waiting;
      waiting = null;
      if (w && !w.resend) {
        pending = w.files;
        input.value = w.value;
        renderTray();
        grow();
      }
      setTitle();
    });
  }

  // ── attaching ──
  function renderTray() {
    if (!tray) return;
    tray.replaceChildren();
    tray.hidden = !pending.length;
    for (const f of pending) {
      const chip = el("div", "chip chip--" + f.status);
      if (f.thumb) {
        const img = document.createElement("img");
        img.className = "chip__thumb";
        img.src = f.thumb;
        img.alt = "";
        chip.appendChild(img);
      } else {
        chip.appendChild(el("span", "chip__kind", f.kind === "pdf" ? "PDF" : f.kind === "image" ? "IMG" : f.kind === "text" ? "TXT" : "…"));
      }
      const meta = el("span", "chip__meta");
      meta.appendChild(el("span", "chip__name", f.name));
      meta.appendChild(el("span", "chip__note", f.status === "reading" ? "Reading…" : f.status === "error" ? f.error : f.note || ""));
      chip.appendChild(meta);
      const x = el("button", "chip__x", "×");
      x.type = "button";
      x.setAttribute("aria-label", "Remove " + f.name);
      x.addEventListener("click", () => { pending = pending.filter((p) => p !== f); renderTray(); });
      chip.appendChild(x);
      tray.appendChild(chip);
    }
    syncSend();
  }

  function addFiles(list) {
    if (!cloud) return;
    for (const file of Array.from(list || [])) {
      if (pending.length >= cloud.LIMITS.files) break;
      const f = { name: file.name || "pasted image.png", kind: "", status: "reading", note: "" };
      pending.push(f);
      cloud.read(file).then((r) => {
        Object.assign(f, r, { status: "ready" });
        if (r.kind === "image" && r.images && r.images[0]) f.thumb = r.images[0];
        renderTray();
      }, (e) => {
        f.status = "error";
        f.error = e && e.message ? e.message : "Couldn't read this file.";
        renderTray();
      });
    }
    renderTray();
  }

  if (attachBtn && fileInput) {
    attachBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; input.focus(); });
  }
  app.addEventListener("dragover", (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) { e.preventDefault(); app.classList.add("is-dropping"); }
  });
  app.addEventListener("dragleave", (e) => { if (!e.relatedTarget || !app.contains(e.relatedTarget)) app.classList.remove("is-dropping"); });
  app.addEventListener("drop", (e) => {
    app.classList.remove("is-dropping");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); }
  });
  input.addEventListener("paste", (e) => {
    const files = e.clipboardData ? Array.from(e.clipboardData.files || []) : [];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  // ── the “Your Cloudflare” button: who's connected, and disconnecting ──
  let asking = 0;
  function syncPill() {
    if (!pill) return;
    const on = Boolean(cloud && cloud.connected());
    pill.hidden = !on;
    if (on) {
      const a = cloud.account();
      $("cfpill-text").textContent = "Your Cloudflare";
      pill.title = "Mike reads your files on " + (a && a.name ? a.name : "your Cloudflare account") + ". Click to disconnect.";
    }
  }
  if (pill) {
    pill.addEventListener("click", async () => {
      if (!asking) {
        $("cfpill-text").textContent = "Disconnect?";
        pill.classList.add("is-asking");
        asking = setTimeout(() => { asking = 0; pill.classList.remove("is-asking"); syncPill(); }, 3000);
        return;
      }
      clearTimeout(asking);
      asking = 0;
      pill.classList.remove("is-asking");
      await cloud.disconnect();
      syncPill();
    });
  }

  function newChat() {
    if (busy) busy.abort();
    turns = [];
    save();
    thread.replaceChildren();
    payloads.clear();
    pending = [];
    waiting = null;
    renderTray();
    setTitle();
    input.focus();
  }

  // ── the composer ──
  function grow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
    syncSend();
  }
  input.addEventListener("input", grow);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!busy) submit(input.value);
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) busy.abort();
    else submit(input.value);
  });
  document.querySelectorAll("[data-new-chat]").forEach((b) => b.addEventListener("click", newChat));
  document.querySelectorAll(".starter").forEach((b) => b.addEventListener("click", () => submit(b.dataset.q)));
  document.querySelectorAll("[data-download]").forEach((a) => {
    if (a.classList.contains("bar__get")) return;
    a.textContent = GET_LABEL;
  });

  // a placeholder that fits on one line on a phone
  const narrow = window.matchMedia("(max-width: 560px)");
  const placeholder = () => { input.placeholder = narrow.matches ? "Message Mike" : "Ask Mike anything, or tell him what to do"; };
  placeholder();
  narrow.addEventListener && narrow.addEventListener("change", placeholder);

  // ── start: restore the conversation, or take ?q= from the home page ──
  turns = load();
  turns.forEach((m) => {
    if (m.role === "user") addYou(m.content, m.files);
    else {
      const { li, body } = addMike();
      body.innerHTML = markdown(m.content);
      if (m.actions && m.actions.length) steps(li, m.actions);
      tools(li, m.content);
    }
  });
  setTitle();
  if (turns.length) follow(true);
  syncPill();
  if (cloud) {
    cloud.resume().then((c) => {
      if (!c) return;
      syncPill();
      const { body } = addMike();
      body.textContent = "Your Cloudflare is connected. Attach your file again and send it — I'll read it on your account.";
      app.classList.add("has-thread");
    }).catch(() => { /* a stale or refused sign-in: nothing to finish */ });
  }
  syncSend();

  const q = new URLSearchParams(location.search).get("q");
  if (q) {
    window.history.replaceState(null, "", location.pathname);
    submit(q);
  } else if (window.matchMedia("(min-width: 900px)").matches) {
    input.focus();
  }
})();
