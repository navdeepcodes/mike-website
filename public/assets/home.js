// The home page: the Ask box types what you could ask, and the capabilities
// showcase plays each one as a short scene. Scenes are described in the
// markup — data-t (ms) turns an element "on", data-sel / data-gone add those
// states, data-type types text, data-path moves the pointer — so this file is
// only the clock. Everything is still and readable without JavaScript or with
// reduced motion.
(function () {
  "use strict";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── the Ask box: typing what you could ask ──
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
    "Add a totals row to budget.xlsx",
  ];
  if (input && ghost && typed) {
    let idea = 0;
    const idle = () => !input.value && document.activeElement !== input;
    const sync = () => ghost.classList.toggle("is-hidden", !idle());
    ["focus", "blur", "input"].forEach((ev) => input.addEventListener(ev, sync));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    (async function loop() {
      if (reduce) { typed.textContent = IDEAS[0]; return; }
      await sleep(1200);
      for (;;) {
        const text = IDEAS[idea++ % IDEAS.length];
        for (let i = 1; i <= text.length; i++) {
          typed.textContent = text.slice(0, i);
          await sleep(text[i - 1] === " " ? 70 : 28 + Math.random() * 38);
        }
        ghost.classList.add("is-resting");
        await sleep(2200);
        ghost.classList.remove("is-resting");
        for (let i = text.length; i >= 0; i -= 2) {
          typed.textContent = text.slice(0, i);
          await sleep(12);
        }
        await sleep(350);
      }
    })();
    ghost.addEventListener("click", () => input.focus());
    form.addEventListener("submit", (e) => {
      if (!input.value.trim()) {
        e.preventDefault();
        input.value = typed.textContent || IDEAS[0];
        form.submit();
      }
    });
  }

  // ── the showcase ──
  const showcase = document.getElementById("showcase");
  if (!showcase) return;
  const tabs = Array.from(showcase.querySelectorAll(".cap"));
  const stage = showcase.querySelector(".stage");
  const caption = showcase.querySelector(".stage__caption");
  const sceneFor = (tab) => stage.querySelector('.scene[data-scene="' + tab.dataset.for + '"]');
  let current = -1;
  let timers = [];
  let seen = false;

  tabs.forEach((tab) => {
    const scene = sceneFor(tab);
    const id = "scene-" + tab.dataset.for;
    scene.id = id;
    tab.id = "tab-" + tab.dataset.for;
    tab.setAttribute("aria-controls", id);
    scene.setAttribute("aria-labelledby", tab.id);
    scene.removeAttribute("aria-label");
  });

  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));

  function reset(scene) {
    scene.querySelectorAll("[data-t], [data-sel], [data-gone]").forEach((el) =>
      el.classList.remove("on", "sel", "gone", "done", "is-latest"));
    scene.querySelectorAll("[data-type]").forEach((el) => { el.textContent = ""; });
  }

  // The pointer goes to "x%,y%" of the scene, or to the middle of an element.
  function aim(cursor, scene, target) {
    let x, y;
    if (target.indexOf("%") > -1) {
      const [px, py] = target.split(",").map((v) => parseFloat(v) / 100);
      x = px * scene.clientWidth; y = py * scene.clientHeight;
    } else {
      const el = scene.querySelector(target);
      if (!el) return;
      const r = el.getBoundingClientRect(), s = scene.getBoundingClientRect();
      x = r.left - s.left + Math.min(r.width * 0.5, 40);
      y = r.top - s.top + r.height * 0.55;
    }
    cursor.style.setProperty("--x", Math.round(x - 5) + "px");
    cursor.style.setProperty("--y", Math.round(y - 3) + "px");
  }
  const path = (cursor) => cursor.dataset.path.split("|").map((p) => {
    const [target, ms] = p.trim().split("@");
    return { target: target.trim(), ms: +ms };
  });

  function trailStep(li) {
    const lis = Array.from(li.parentElement.children);
    lis.forEach((o) => {
      if (o !== li && o.classList.contains("on")) o.classList.add("done");
      o.classList.toggle("is-latest", o === li);
    });
  }

  function finish(scene) {
    scene.querySelectorAll("[data-t]").forEach((el) => el.classList.add("on"));
    scene.querySelectorAll("[data-sel]").forEach((el) => el.classList.add("sel"));
    scene.querySelectorAll("[data-gone]").forEach((el) => el.classList.add("gone"));
    scene.querySelectorAll("[data-type]").forEach((el) => { el.textContent = el.dataset.type; });
    const lis = scene.querySelectorAll(".trail li");
    lis.forEach((li, i) => { li.classList.add("done"); li.classList.toggle("is-latest", i === lis.length - 1); });
    scene.querySelectorAll(".cursor").forEach((c) => {
      const steps = path(c);
      aim(c, scene, steps[steps.length - 1].target);
    });
  }

  function run(scene) {
    scene.querySelectorAll("[data-t]").forEach((el) => {
      const ms = +el.dataset.t;
      if (el.hasAttribute("data-type")) {
        const text = el.dataset.type, speed = +el.dataset.speed || 28;
        at(ms, () => {
          let i = 0;
          (function step() {
            el.textContent = text.slice(0, ++i);
            if (i < text.length) timers.push(setTimeout(step, text[i - 1] === " " ? speed * 1.6 : speed));
          })();
        });
      }
      at(ms, () => {
        el.classList.add("on");
        if (el.parentElement.classList.contains("trail")) trailStep(el);
      });
    });
    scene.querySelectorAll("[data-sel]").forEach((el) => at(+el.dataset.sel, () => el.classList.add("sel")));
    scene.querySelectorAll("[data-gone]").forEach((el) => at(+el.dataset.gone, () => el.classList.add("gone")));
    scene.querySelectorAll(".cursor").forEach((c) => {
      const steps = path(c);
      c.style.transition = "none";
      aim(c, scene, steps[0].target);
      void c.offsetWidth;
      c.style.transition = "";
      steps.slice(1).forEach((s) => at(s.ms, () => aim(c, scene, s.target)));
      (c.dataset.click || "").split(",").filter(Boolean).forEach((ms) => at(+ms, () => {
        c.classList.remove("is-click"); void c.offsetWidth; c.classList.add("is-click");
      }));
    });
    // the last step finishes a little before the scene moves on
    at(Math.max(0, +scene.dataset.dur - 700), () =>
      scene.querySelectorAll(".trail li.on").forEach((li) => li.classList.add("done")));
  }

  function show(i, focus) {
    clear();
    current = (i + tabs.length) % tabs.length;
    const tab = tabs[current];
    const scene = sceneFor(tab);
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
    // restart the progress line even when the same tab is chosen again
    const bar = tab.querySelector(".cap__bar");
    bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = "";
    stage.querySelectorAll(".scene").forEach((s) => s.classList.toggle("is-active", s === scene));
    showcase.style.setProperty("--dur", scene.dataset.dur + "ms");
    if (caption) caption.textContent = tab.querySelector(".cap__d").textContent;
    reset(scene);
    if (reduce) finish(scene); else run(scene);
    // keep the chosen chip in view on narrow screens, without moving the page
    const list = tab.parentElement;
    if (list.scrollWidth > list.clientWidth) {
      const left = tab.offsetLeft - list.offsetLeft - 16;
      list.scrollTo({ left, behavior: reduce ? "auto" : "smooth" });
    }
    if (focus) tab.focus();
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => show(i));
    tab.querySelector(".cap__bar").addEventListener("animationend", () => {
      if (i === current && !reduce) show(current + 1);
    });
  });
  showcase.querySelector(".caps").addEventListener("keydown", (e) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (step) { e.preventDefault(); show(current + step, true); }
    else if (e.key === "Home") { e.preventDefault(); show(0, true); }
    else if (e.key === "End") { e.preventDefault(); show(tabs.length - 1, true); }
  });

  // pause while you're looking closely, when it's off screen, or the tab is hidden
  let hovered = false, onScreen = false;
  const sync = () => showcase.classList.toggle("is-paused", hovered || !onScreen || document.hidden);
  stage.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { hovered = true; sync(); } });
  stage.addEventListener("pointerleave", () => { hovered = false; sync(); });
  document.addEventListener("visibilitychange", sync);

  if (reduce) showcase.classList.add("is-manual");
  show(0);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => {
      onScreen = es[0].isIntersecting;
      if (onScreen && !seen) { seen = true; show(0); }
      sync();
    }, { threshold: 0.35 }).observe(showcase);
  } else { onScreen = true; sync(); }
})();
