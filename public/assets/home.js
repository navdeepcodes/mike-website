// The home page: the nib writes the greeting, types what you could ask,
// and the demos run. Everything degrades to still, readable content without
// JavaScript or with reduced motion.
(function () {
  "use strict";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── the underline under "Mike." and "hello.": drawn once, when seen ──
  const swashes = document.querySelectorAll(".swash-word");
  if ("IntersectionObserver" in window && !reduce) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("is-drawn"); io.unobserve(e.target); }
    }), { threshold: 0.6 });
    swashes.forEach((w) => io.observe(w));
  } else {
    swashes.forEach((w) => w.classList.add("is-drawn"));
  }

  // ── the Ask box: the nib types what you could ask ──
  const input = document.getElementById("ask-q");
  const ghost = document.querySelector(".ask__ghost");
  const typed = document.querySelector(".ask__typed");
  const form = document.getElementById("ask");
  const IDEAS = [
    "Summarise chapter 3 of my physics notes",
    "Why is my Python script crashing?",
    "Clean up my Downloads folder",
    "Explain integration by parts, step by step",
    "Write an email asking for an extension",
    "Rename these screenshots by date",
  ];
  if (input && ghost && typed) {
    let idea = 0, stop = false;
    const idle = () => !input.value && document.activeElement !== input;
    const sync = () => ghost.classList.toggle("is-hidden", !idle());
    ["focus", "blur", "input"].forEach((ev) => input.addEventListener(ev, sync));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function loop() {
      if (reduce) { typed.textContent = IDEAS[0]; return; }
      await sleep(1600);
      while (!stop) {
        const text = IDEAS[idea++ % IDEAS.length];
        for (let i = 1; i <= text.length; i++) {
          typed.textContent = text.slice(0, i);
          await sleep(text[i - 1] === " " ? 70 : 28 + Math.random() * 38);
        }
        ghost.classList.add("is-resting");
        await sleep(2100);
        ghost.classList.remove("is-resting");
        for (let i = text.length; i >= 0; i -= 2) {
          typed.textContent = text.slice(0, i);
          await sleep(12);
        }
        await sleep(350);
      }
    }
    loop();
    // Clicking the ghost fills in the idea it was showing.
    ghost.addEventListener("click", () => { input.focus(); });
    form.addEventListener("submit", (e) => {
      if (!input.value.trim()) {
        e.preventDefault();
        input.value = typed.textContent || IDEAS[0];
        form.submit();
      }
    });
  }

  // ── the stream of things to ask: duplicate each track for a seamless loop ──
  document.querySelectorAll("[data-marquee] .marquee__track").forEach((track) => {
    const copy = track.cloneNode(true);
    copy.setAttribute("aria-hidden", "true");
    copy.querySelectorAll("a").forEach((a) => a.setAttribute("tabindex", "-1"));
    track.parentElement.appendChild(copy);
  });

  // ── the steps demo: a real task, played through ──
  const demo = document.getElementById("demo-steps");
  if (demo) {
    const you = demo.querySelector(".demo-steps__you");
    const list = demo.querySelector(".demo-steps__list");
    const head = demo.querySelector(".demo-steps__head b");
    const timer = demo.querySelector(".demo-steps__timer");
    const spin = demo.querySelector(".spin");
    const TASKS = [
      { ask: "Summarise lecture 3 into my Physics folder", steps: ["Finding lecture-3.pdf", "Reading lecture-3.pdf", "Writing lecture-3-summary.md in Physics"] },
      { ask: "Why won't my site start?", steps: ["Running npm run dev", "Reading the error", "Fixing the port in vite.config.js", "Checking localhost:5173"] },
      { ask: "Add a totals row to budget.xlsx", steps: ["Reading budget.xlsx", "Adding =SUM(B2:B13) to row 14", "Saving budget.xlsx"] },
    ];
    let n = 0;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const row = (text) => {
      const li = document.createElement("li");
      li.innerHTML = '<span class="dot"></span><span></span>';
      li.lastChild.textContent = text;
      list.appendChild(li);
      requestAnimationFrame(() => li.classList.add("is-in"));
      return li;
    };
    async function play() {
      while (demo.isConnected) {
        const task = TASKS[n++ % TASKS.length];
        list.replaceChildren();
        you.textContent = task.ask;
        head.textContent = "Working on it";
        spin.classList.remove("is-done");
        const t0 = Date.now();
        const tick = setInterval(() => (timer.textContent = Math.max(1, Math.round((Date.now() - t0) / 1000)) + "s"), 500);
        await sleep(700);
        for (const s of task.steps) {
          const li = row(s);
          await sleep(reduce ? 0 : 900 + Math.random() * 500);
          li.classList.add("is-done");
        }
        clearInterval(tick);
        head.textContent = "Done";
        spin.classList.add("is-done");
        await sleep(reduce ? 60000 : 2600);
      }
    }
    if (reduce) {
      const task = TASKS[0];
      you.textContent = task.ask;
      task.steps.forEach((s) => row(s).classList.add("is-done", "is-in"));
      head.textContent = "Done";
      spin.classList.add("is-done");
    } else if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); play(); } }, { threshold: 0.3 });
      io.observe(demo);
    } else play();
  }
})();
