// Mike — small, shared behaviour: the nav's hairline once you scroll, gentle
// reveals, and download buttons that point at the visitor's platform.
(function () {
  "use strict";

  const nav = document.querySelector(".nav");
  if (nav) {
    const onScroll = () => nav.classList.toggle("is-stuck", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  const reveals = document.querySelectorAll(".reveal");
  if (reveals.length) {
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
      reveals.forEach((el) => io.observe(el));
    } else {
      reveals.forEach((el) => el.classList.add("is-in"));
    }
  }

  // Download buttons: data-win / data-mac hold the real files; the label
  // follows the platform. Phones get pointed at the computer versions.
  const ua = navigator.userAgent || "";
  const p = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "").toLowerCase();
  const platform = /android|iphone|ipad|ipod/i.test(ua) ? "mobile"
    : p.includes("win") || /Windows/.test(ua) ? "win"
    : p.includes("mac") || /Mac OS X/.test(ua) ? "mac" : "other";
  document.documentElement.dataset.platform = platform;
  document.querySelectorAll("[data-dl]").forEach((a) => {
    const target = platform === "mac" ? "mac" : "win";
    if (a.dataset[target]) a.href = a.dataset[target];
    const label = a.querySelector("[data-dl-label]") || a;
    if (platform === "mac") label.textContent = a.dataset.macLabel || "Download for Mac";
    else if (platform === "win") label.textContent = a.dataset.winLabel || "Download for Windows";
  });
})();
