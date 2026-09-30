// The home page: Mike's window works through real tasks (pick one, or let it
// move on by itself), the feature demos play while they're on screen, and the
// Ask box suggests what you could ask. With reduced motion, or without
// JavaScript, everything is still and readable.
(function () {
  "use strict";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const CHECK = '<span class="tick"><svg aria-hidden="true"><use href="#i-check"/></svg></span>';

  // Run `fn` only while `el` is on screen.
  function whileVisible(el, fn) {
    if (!el) return;
    let on = false;
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting && !on) { on = true; fn(() => on); }
      else if (!e.isIntersecting) on = false;
    }), { threshold: 0.35 });
    io.observe(el);
  }

  // ── Mike's window ──────────────────────────────────────
  const SCENES = {
    study: {
      recent: "Summarise lecture 3",
      ask: "Summarise lecture 3 and save it in my Physics folder",
      steps: ["Finding lecture-3.pdf", "Reading lecture-3.pdf · 14 pages", "Writing lecture-3-summary.md in Physics"],
      reply: "Done — <b>lecture-3-summary.md</b> is in your Physics folder. The big idea is the first law: ΔU = Q − W. Want me to turn it into flashcards?",
    },
    docs: {
      recent: "History essay, MLA",
      ask: "Turn my notes into an MLA essay, as Word and PDF",
      steps: ["Reading history-notes.docx", "Writing essay.docx in MLA format", "Saving essay.pdf"],
      reply: "Your essay is ready — <b>essay.docx</b> and <b>essay.pdf</b>, double-spaced with a Works Cited page. I kept your three sources.",
    },
    code: {
      recent: "Fix the save button",
      ask: "My app crashes when I click Save — can you fix it?",
      steps: ["Reading app.py in VS Code", "Running python app.py — IndexError on line 42", "Fixing line 42 in app.py", "Running it again — no errors"],
      reply: "Fixed. The loop read one row past the end of the list on line 42. It runs cleanly now — try Save again.",
    },
    files: {
      recent: "Tidy my Downloads",
      ask: "Clean up my Downloads — put the PDFs in Documents",
      steps: ["Looking in Downloads · 48 files", "Moving 17 PDFs to Documents\\PDFs"],
      confirm: { what: "Delete 6 duplicate files?", pick: "Don't" },
      reply: "Moved 17 PDFs to <b>Documents\\PDFs</b>. I left the 6 duplicates where they were — say the word and I'll delete them.",
    },
  };
  const ORDER = ["study", "docs", "code", "files"];
  const chat = document.getElementById("app-chat");
  const tabs = [...document.querySelectorAll(".scene")];
  const recent = document.querySelector("[data-recent]");
  let run = 0, current = "study";

  function add(html, cls) {
    const el = document.createElement("div");
    el.className = "msg " + cls;
    el.innerHTML = html;
    chat.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("is-in")));
    return el;
  }

  function select(name) {
    current = name;
    tabs.forEach((t) => {
      t.setAttribute("aria-selected", String(t.dataset.scene === name));
      t.style.setProperty("--p", "0");
    });
    if (recent) recent.textContent = SCENES[name].recent;
  }

  function stillScene(name) {
    const s = SCENES[name];
    chat.innerHTML = "";
    add(esc(s.ask), "msg--you is-in");
    add(`<div class="work"><div class="work__head">${CHECK}Done</div><ol>${s.steps.map((t) => `<li class="is-in">${CHECK}${esc(t)}</li>`).join("")}</ol></div>`, "is-in");
    add(s.reply, "msg--mike is-in");
  }

  async function play(name, alive) {
    const me = ++run;
    const live = () => me === run && alive();
    const s = SCENES[name];
    select(name);
    if (reduce) { stillScene(name); return; }
    chat.innerHTML = "";
    await sleep(350); if (!live()) return;
    add(esc(s.ask), "msg--you");
    await sleep(700); if (!live()) return;

    const card = add(`<div class="work"><div class="work__head"><span class="spin"></span>Working on it <em>0s</em></div><ol></ol></div>`, "");
    const head = card.querySelector(".work__head");
    const list = card.querySelector("ol");
    const timer = head.querySelector("em");
    const started = Date.now();
    const tick = setInterval(() => { timer.textContent = Math.round((Date.now() - started) / 1000) + "s"; }, 500);
    const stop = () => { clearInterval(tick); };
    for (const step of s.steps) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="spin"></span>${esc(step)}`;
      list.appendChild(li);
      requestAnimationFrame(() => li.classList.add("is-in"));
      await sleep(900); if (!live()) return stop();
      li.firstElementChild.outerHTML = CHECK;
    }
    if (s.confirm) {
      const ask = add(`<div class="ask-card"><p><b>Mike needs your OK</b>${esc(s.confirm.what)}</p><span>Don't</span><span>Delete</span></div>`, "");
      await sleep(1500); if (!live()) return stop();
      [...ask.querySelectorAll("span")].find((b) => b.textContent === s.confirm.pick).classList.add("is-picked");
      await sleep(700); if (!live()) return stop();
    }
    stop();
    head.innerHTML = `${CHECK}Done <em>${timer.textContent}</em>`;
    await sleep(400); if (!live()) return;

    // the reply, written word by word
    const reply = add("", "msg--mike");
    let shown = "";
    for (const w of s.reply.split(/(\s+)/)) {
      shown += w;
      reply.innerHTML = shown;
      if (w.trim()) { await sleep(34); if (!live()) return; }
    }

    // hold, showing progress on the tab, then move on
    const tab = tabs.find((t) => t.dataset.scene === name);
    const hold = 4200, t0 = Date.now();
    while (Date.now() - t0 < hold) {
      if (!live()) return;
      tab.style.setProperty("--p", String((Date.now() - t0) / hold));
      await sleep(50);
    }
    if (live()) play(ORDER[(ORDER.indexOf(name) + 1) % ORDER.length], alive);
  }

  if (chat) {
    let alive = () => false;
    stillScene("study");
    whileVisible(document.getElementById("app"), (a) => { alive = a; play(current, a); });
    tabs.forEach((t) => t.addEventListener("click", () => play(t.dataset.scene, alive)));
  }

  // ── feature demos ──────────────────────────────────────
  // voice: the bars follow the words as they're said
  const voice = document.querySelector('[data-demo="voice"]');
  const voiceText = document.querySelector("[data-voice-text]");
  const bars = voice ? [...voice.querySelectorAll(".voice__bars i")] : [];
  // at rest the bars keep a soft wave shape rather than a row of dots
  const rest = () => bars.forEach((b, i) => { b.style.height = (6 + 7 * Math.sin((i / (bars.length - 1)) * Math.PI)).toFixed(0) + "px"; });
  rest();
  const SAID = ["Hey Mike, what's due this week?", "Open my lab report and fix the graphs", "Read me the summary out loud"];
  if (reduce && voiceText) voiceText.textContent = SAID[0];
  else whileVisible(voice, async (alive) => {
    let i = 0;
    while (alive()) {
      const line = SAID[i++ % SAID.length];
      voiceText.textContent = "";
      for (const ch of line) {
        if (!alive()) return;
        voiceText.textContent += ch;
        bars.forEach((b) => { b.style.height = (4 + Math.random() * 22).toFixed(0) + "px"; });
        await sleep(45);
      }
      rest();
      await sleep(1800);
    }
  });

  // merge: two PDFs become one
  const merge = document.querySelector('[data-demo="merge"]');
  if (reduce && merge) merge.classList.add("is-merged");
  else whileVisible(merge, async (alive) => {
    while (alive()) {
      merge.classList.remove("is-merged"); await sleep(1600);
      if (!alive()) return;
      merge.classList.add("is-merged"); await sleep(3200);
    }
  });

  // code: the broken line is fixed, then it runs
  const code = document.querySelector('[data-demo="code"]');
  if (reduce && code) code.classList.add("is-fixed");
  else whileVisible(code, async (alive) => {
    while (alive()) {
      code.classList.remove("is-fixed"); await sleep(1700);
      if (!alive()) return;
      code.classList.add("is-fixed"); await sleep(3600);
    }
  });

  // guide: the nib goes where Mike is typing, then to Save
  const guide = document.querySelector('[data-demo="guide"]');
  const desk = guide && guide.querySelector(".desk");
  const nib = guide && guide.querySelector(".desk__nib");
  const text = guide && guide.querySelector("[data-guide-text]");
  const save = guide && guide.querySelector(".desk__save");
  function point(el, dx, dy) {
    const d = desk.getBoundingClientRect(), r = el.getBoundingClientRect();
    // the nib's tip sits about a quarter in and a fifth down its 34px box
    nib.style.setProperty("--x", (r.left - d.left + (dx ?? r.width / 2) - 8.5) + "px");
    nib.style.setProperty("--y", (r.top - d.top + (dy ?? r.height / 2) - 6) + "px");
  }
  const NOTE = "Lab 4: the pendulum's period barely changes with amplitude.";
  if (reduce && text) text.textContent = NOTE;
  else whileVisible(guide, async (alive) => {
    while (alive()) {
      text.textContent = ""; save.classList.remove("is-pressed");
      nib.style.setProperty("--x", (desk.clientWidth - 60) + "px");
      nib.style.setProperty("--y", (desk.clientHeight - 50) + "px");
      await sleep(700); if (!alive()) return;
      const caret = text.nextElementSibling;
      point(caret, 1, caret.offsetHeight);
      await sleep(1200);
      nib.classList.add("is-following");
      for (const ch of NOTE) {
        if (!alive()) { nib.classList.remove("is-following"); return; }
        text.textContent += ch;
        point(caret, 1, caret.offsetHeight);
        await sleep(40);
      }
      nib.classList.remove("is-following");
      await sleep(400); if (!alive()) return;
      point(save);
      await sleep(1250); if (!alive()) return;
      save.classList.add("is-pressed");
      await sleep(2400);
    }
  });

  // ── the Ask box: what you could ask, typed out ─────────
  const input = document.getElementById("ask-q");
  const ghost = document.querySelector(".ask__ghost");
  const typed = document.querySelector(".ask__typed");
  const IDEAS = [
    "Summarise chapter 3 of my physics notes",
    "Why is my Python script crashing?",
    "Explain integration by parts, step by step",
    "Write an email asking for an extension",
    "Make a study plan for my exams",
  ];
  if (input && ghost && typed) {
    const idle = () => !input.value && document.activeElement !== input;
    const sync = () => ghost.classList.toggle("is-hidden", !idle());
    ["focus", "blur", "input"].forEach((ev) => input.addEventListener(ev, sync));
    if (reduce) typed.textContent = IDEAS[0];
    else whileVisible(input, async (alive) => {
      let i = 0;
      while (alive()) {
        const idea = IDEAS[i++ % IDEAS.length];
        for (let n = 1; n <= idea.length; n++) { typed.textContent = idea.slice(0, n); await sleep(40); if (!alive()) return; }
        await sleep(2000);
        for (let n = idea.length; n >= 0; n--) { typed.textContent = idea.slice(0, n); await sleep(14); if (!alive()) return; }
        await sleep(300);
      }
    });
  }
})();
