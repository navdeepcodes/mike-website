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

  // ── where "Get Mike" goes, by platform ──
  function platform() {
    const p = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "").toLowerCase();
    const ua = navigator.userAgent || "";
    if (/android|iphone|ipad|ipod/i.test(ua)) return "mobile";
    if (p.includes("win") || /Windows/.test(ua)) return "win";
    if (p.includes("mac") || /Mac OS X/.test(ua)) return "mac";
    return "other";
  }
  const PLATFORM = platform();
  const GET_LABEL = PLATFORM === "win" ? "Get Mike for Windows" : PLATFORM === "mac" ? "Get Mike for Mac" : "Get Mike for your computer";

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

  function addYou(text) {
    const li = el("li", "msg msg--you");
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

  function thinking(body) {
    const t = el("span", "thinking");
    t.appendChild(nib());
    t.appendChild(el("span", "", "Thinking"));
    body.replaceChildren(t);
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

  // ── reveal the answer word by word: quick, but alive ──
  function reveal(body, text, done) {
    if (reduceMotion || text.length > 1400) {
      body.innerHTML = markdown(text);
      done();
      return;
    }
    const words = text.split(/(\s+)/);
    let i = 0;
    const step = () => {
      i = Math.min(words.length, i + 3);
      body.innerHTML = markdown(words.slice(0, i).join(""));
      follow();
      if (i < words.length) setTimeout(step, 16);
      else done();
    };
    step();
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
    send.disabled = !busy && !input.value.trim();
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

  // ── asking ──
  async function ask() {
    const { li, body } = addMike();
    thinking(body);
    follow(true);
    const controller = new AbortController();
    setBusy(controller);
    let data = null;
    let kind = null;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: turns.slice(-MAX_TURNS) }),
        signal: controller.signal,
      });
      try { data = await res.json(); } catch (_) { data = null; }
      if (!res.ok || !data || typeof data.reply !== "string") {
        kind = res.status === 429 ? "busy" : res.status === 503 ? "resting" : "failed";
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        li.remove();
        setBusy(null);
        return;
      }
      kind = navigator.onLine === false ? "offline" : "failed";
    }
    if (kind) {
      notice(li, kind, kind === "busy" || kind === "resting" ? null : ask);
      setBusy(null);
      follow();
      return;
    }
    const actions = Array.isArray(data.actions) ? data.actions : [];
    turns.push({ role: "assistant", content: data.reply, actions });
    save();
    reveal(body, data.reply, () => {
      if (actions.length) steps(li, actions);
      tools(li, data.reply);
      setBusy(null);
      follow();
    });
  }

  function submit(text) {
    const value = (text || "").trim().slice(0, 500);
    if (!value || busy) return;
    turns.push({ role: "user", content: value });
    save();
    addYou(value);
    setTitle();
    input.value = "";
    grow();
    ask();
  }

  function newChat() {
    if (busy) busy.abort();
    turns = [];
    save();
    thread.replaceChildren();
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
    a.textContent = PLATFORM === "win" || PLATFORM === "mac" ? GET_LABEL + " — free" : "Get Mike — free";
  });

  // a placeholder that fits on one line on a phone
  const narrow = window.matchMedia("(max-width: 560px)");
  const placeholder = () => { input.placeholder = narrow.matches ? "Message Mike" : "Ask Mike anything, or tell him what to do"; };
  placeholder();
  narrow.addEventListener && narrow.addEventListener("change", placeholder);

  // ── start: restore the conversation, or take ?q= from the home page ──
  turns = load();
  turns.forEach((m) => {
    if (m.role === "user") addYou(m.content);
    else {
      const { li, body } = addMike();
      body.innerHTML = markdown(m.content);
      if (m.actions && m.actions.length) steps(li, m.actions);
      tools(li, m.content);
    }
  });
  setTitle();
  if (turns.length) follow(true);
  syncSend();

  const q = new URLSearchParams(location.search).get("q");
  if (q) {
    window.history.replaceState(null, "", location.pathname);
    submit(q);
  } else if (window.matchMedia("(min-width: 900px)").matches) {
    input.focus();
  }
})();
