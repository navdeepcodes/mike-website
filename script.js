// Mike — marketing site interactions
// One orchestrated hero sequence (copy + a live device demo), a scroll-driven
// product walkthrough, cursor parallax on the hero device, and a real
// interactive "try it" widget. Nothing animates without a reason.

(function () {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Platform detection ----------
  // Picks the right download for the visitor's OS, defaulting to macOS
  // when detection is inconclusive (e.g. Linux, iPad).
  function detectPlatform() {
    const uaData = navigator.userAgentData;
    if (uaData && uaData.platform) {
      const p = uaData.platform.toLowerCase();
      if (p.includes("mac")) return "mac";
      if (p.includes("win")) return "win";
    }
    const ua = navigator.userAgent || "";
    if (/Windows/i.test(ua)) return "win";
    if (/Mac OS X|Macintosh/i.test(ua)) return "mac";
    return "mac";
  }

  const platform = detectPlatform();
  const other = platform === "mac" ? "win" : "mac";

  function applyPlatform(btn) {
    if (!btn) return;
    btn.href = btn.dataset[platform + "Href"];
    btn.textContent = btn.dataset[platform + "Label"];
  }
  applyPlatform(document.getElementById("dl-primary"));
  applyPlatform(document.getElementById("dl-primary-2"));

  const dlMeta = document.getElementById("dl-meta");
  if (dlMeta) {
    dlMeta.textContent = platform === "mac" ? "87 MB, macOS 12+." : "Windows 10+.";
  }
  const dlMeta2 = document.getElementById("dl-meta-2");
  if (dlMeta2) {
    dlMeta2.textContent =
      platform === "mac" ? "Early testing build for macOS, v1.0.0, 87 MB." : "Early testing build for Windows, v1.0.0.";
  }

  const altHref = document.getElementById("dl-primary")?.dataset[other + "Href"];
  const altLabel = other === "mac" ? "Not on Windows? Get Mike for macOS" : "Not on macOS? Get Mike for Windows";
  const dlAltLink = document.getElementById("dl-alt-link");
  if (dlAltLink && altHref) {
    dlAltLink.href = altHref;
    dlAltLink.textContent = altLabel;
  }
  const dlAltLink2 = document.getElementById("dl-alt-link-2");
  if (dlAltLink2 && altHref) {
    dlAltLink2.href = altHref;
    dlAltLink2.textContent = altLabel;
  }

  const noteMac = document.getElementById("download-note-mac");
  const noteWin = document.getElementById("download-note-win");
  if (noteMac && noteWin) {
    noteMac.hidden = platform !== "mac";
    noteWin.hidden = platform === "mac";
  }

  function buildMiniWave(el, count) {
    if (!el || el.dataset.built) return;
    el.dataset.built = "1";
    for (let i = 0; i < count; i++) {
      const bar = document.createElement("span");
      const h = 20 + Math.round(Math.sin(i * 0.6) * 12 + Math.random() * 22);
      bar.style.height = h + "%";
      bar.style.animationDelay = (i * 0.07).toFixed(2) + "s";
      el.appendChild(bar);
    }
  }

  document.querySelectorAll(".mini-wave").forEach((el) => buildMiniWave(el, 22));

  function typeInto(el, text, done) {
    el.textContent = "";
    if (reduceMotion) {
      el.textContent = text;
      if (done) done();
      return;
    }
    const cursor = document.createElement("span");
    cursor.className = "cursor";
    let i = 0;
    function step() {
      if (i <= text.length) {
        el.textContent = text.slice(0, i);
        el.appendChild(cursor);
        i++;
        setTimeout(step, 14 + Math.random() * 18);
      } else {
        cursor.remove();
        if (done) done();
      }
    }
    step();
  }

  // ---------- Hero load sequence ----------
  const heroSeq = [
    document.getElementById("hero-kicker"),
    document.getElementById("hero-h1"),
    document.getElementById("hero-h2"),
    document.getElementById("hero-p"),
    document.getElementById("hero-actions"),
    document.getElementById("hero-hint"),
    document.getElementById("dl-alt"),
  ].filter(Boolean);
  const heroDevice = document.getElementById("hero-device");

  function runDeviceDemo() {
    const desktop = document.getElementById("device-desktop");
    const youEl = document.getElementById("device-you");
    const responseEl = document.getElementById("device-response");
    const replay = document.getElementById("device-replay");
    if (!desktop || !youEl || !responseEl) return;

    desktop.classList.remove("is-sorted");
    youEl.textContent = "";
    responseEl.textContent = "";
    if (replay) replay.classList.remove("is-visible");

    typeInto(youEl, "Clean up my downloads folder.", () => {
      setTimeout(() => {
        desktop.classList.add("is-sorted");
        typeInto(responseEl, "Sorted 340 files into 12 folders. Removed 18 duplicates.", () => {
          if (replay) setTimeout(() => replay.classList.add("is-visible"), 400);
        });
      }, 450);
    });
  }

  if (reduceMotion) {
    heroSeq.forEach((el) => {
      el.style.opacity = 1;
      el.style.transform = "none";
    });
    if (heroDevice) {
      heroDevice.style.opacity = 1;
      heroDevice.style.transform = "none";
    }
    runDeviceDemo();
  } else {
    heroSeq.forEach((el, i) => {
      el.style.transition = "opacity 0.7s ease, transform 0.7s ease";
      setTimeout(() => {
        el.style.opacity = 1;
        el.style.transform = "none";
      }, 150 + i * 130);
    });
    if (heroDevice) {
      setTimeout(() => {
        heroDevice.style.opacity = 1;
        heroDevice.style.transform = "translateY(0)";
        setTimeout(runDeviceDemo, 500);
      }, 150 + heroSeq.length * 130);
    }
  }

  const replayBtn = document.getElementById("device-replay");
  if (replayBtn) {
    replayBtn.addEventListener("click", () => {
      runDeviceDemo();
    });
  }

  // ---------- Cursor parallax on the hero device ----------
  if (heroDevice && !reduceMotion && window.matchMedia("(hover: hover)").matches) {
    const stage = heroDevice.closest(".hero__stage");
    let raf = null;
    let mx = 0.5, my = 0.5;

    function apply() {
      raf = null;
      const rx = (my - 0.5) * -8;
      const ry = (mx - 0.5) * 10;
      heroDevice.style.transform = `translateY(0) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    }

    stage.addEventListener(
      "mousemove",
      (e) => {
        const rect = stage.getBoundingClientRect();
        mx = (e.clientX - rect.left) / rect.width;
        my = (e.clientY - rect.top) / rect.height;
        if (!raf) raf = requestAnimationFrame(apply);
      },
      { passive: true }
    );

    stage.addEventListener("mouseleave", () => {
      heroDevice.style.transform = "translateY(0) rotateX(0deg) rotateY(0deg)";
    });
  }

  // ---------- Nav border + scroll progress ----------
  const nav = document.getElementById("nav");
  const progressBar = document.getElementById("progress-bar");
  const onScroll = () => {
    if (window.scrollY > 8) nav.classList.add("scrolled");
    else nav.classList.remove("scrolled");
    if (progressBar) {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? (window.scrollY / docHeight) * 100 : 0;
      progressBar.style.width = pct + "%";
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---------- Scroll reveals ----------
  const revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && revealEls.length) {
    const revealIo = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          const siblings = el.parentElement
            ? Array.from(el.parentElement.children).filter((c) => c.classList.contains("reveal"))
            : [];
          const idx = siblings.indexOf(el);
          if (idx > 0) el.style.setProperty("--reveal-delay", idx * 0.08 + "s");
          el.classList.add("is-visible");
          revealIo.unobserve(el);
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );
    revealEls.forEach((el) => revealIo.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  }

  // ---------- How it works: scroll-driven product stage ----------
  const howItems = document.querySelectorAll(".how__item");
  const stageScenes = document.querySelectorAll(".stage-scene");
  if ("IntersectionObserver" in window && howItems.length && stageScenes.length) {
    const ratios = new Map();
    const setActive = (scene) => {
      howItems.forEach((it) => it.classList.toggle("is-active", it.dataset.scene === scene));
      stageScenes.forEach((s) => s.classList.toggle("is-active", s.dataset.scene === scene));
    };
    const howIo = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          ratios.set(entry.target.dataset.scene, entry.isIntersecting ? entry.intersectionRatio : 0);
        });
        let best = null;
        let bestRatio = 0;
        ratios.forEach((ratio, scene) => {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = scene;
          }
        });
        if (best) setActive(best);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: "-35% 0px -35% 0px" }
    );
    howItems.forEach((it) => howIo.observe(it));
    setActive(howItems[0].dataset.scene);
  }

  // ---------- Under-the-hood loop diagram ----------
  const loopDiagram = document.getElementById("loop-diagram");
  const loopIndicator = document.getElementById("loop-indicator");
  const loopNodes = document.querySelectorAll(".loop__node");
  if (loopDiagram && loopIndicator && loopNodes.length && !reduceMotion) {
    let loopStep = 0;
    let loopTimer = null;

    function setLoopStep(step) {
      loopStep = step;
      loopIndicator.style.transform = `translateX(${step * 100}%)`;
      loopNodes.forEach((node) => {
        node.classList.toggle("is-active", Number(node.dataset.step) === step);
      });
    }

    function startLoop() {
      if (loopTimer) return;
      loopTimer = setInterval(() => setLoopStep((loopStep + 1) % loopNodes.length), 2400);
    }

    function stopLoop() {
      if (!loopTimer) return;
      clearInterval(loopTimer);
      loopTimer = null;
    }

    if ("IntersectionObserver" in window) {
      const loopIo = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => (entry.isIntersecting ? startLoop() : stopLoop()));
        },
        { threshold: 0.4 }
      );
      loopIo.observe(loopDiagram);
    } else {
      startLoop();
    }

    loopDiagram.addEventListener("mouseenter", stopLoop);
    loopDiagram.addEventListener("mouseleave", startLoop);
  }

  // ---------- Try Mike widget ----------
  const tryForm = document.getElementById("try-form");
  const tryInput = document.getElementById("try-input");
  const tryReplyLine = document.getElementById("try-reply-line");
  const tryResponse = document.getElementById("try-response");

  const CANNED = [
    { match: /email|inbox|reply|replies/i, text: "Drafted three replies and flagged one that needs your input." },
    { match: /file|folder|download|clean|organi/i, text: "Sorted 340 files into 12 folders. Removed 18 duplicates." },
    { match: /bug|fix|code|pr\b|pull request/i, text: "Found the issue in auth.js:42, wrote a fix, and opened a PR." },
    { match: /meeting|calendar|schedule|invite/i, text: "Moved your 3pm and let the other attendees know." },
    { match: /summar/i, text: "Summarized the doc into five bullet points, saved as notes.md." },
  ];
  const DEFAULT_REPLY = "Got it — working on that now.";

  const trySuggestions = document.getElementById("try-suggestions");
  if (trySuggestions && tryForm && tryInput) {
    trySuggestions.addEventListener("click", (e) => {
      const chip = e.target.closest(".try__chip");
      if (!chip || tryInput.disabled) return;
      tryInput.value = chip.dataset.fill || chip.textContent;
      tryForm.requestSubmit ? tryForm.requestSubmit() : tryForm.dispatchEvent(new Event("submit", { cancelable: true }));
    });
  }

  if (tryForm) {
    tryForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const value = tryInput.value.trim();
      if (!value) return;
      const submitBtn = tryForm.querySelector(".try__submit");
      const reply = (CANNED.find((c) => c.match.test(value)) || { text: DEFAULT_REPLY }).text;

      tryInput.disabled = true;
      if (submitBtn) submitBtn.disabled = true;
      tryReplyLine.hidden = false;
      requestAnimationFrame(() => tryReplyLine.classList.add("is-visible"));

      typeInto(tryResponse, reply, () => {
        setTimeout(() => {
          tryInput.disabled = false;
          if (submitBtn) submitBtn.disabled = false;
          tryInput.value = "";
          tryInput.focus();
        }, 300);
      });
    });
  }
})();
