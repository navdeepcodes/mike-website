// Mike — small, shared behaviour: the nav's hairline once you scroll, gentle
// reveals, and download buttons (Windows-only for now).
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

  // Mike is Windows-only for now: every download button points at the
  // Windows build, whatever the visitor is using.
  document.querySelectorAll("[data-dl]").forEach((a) => {
    if (a.dataset.win) a.href = a.dataset.win;
    const label = a.querySelector("[data-dl-label]") || a;
    if (a.dataset.winLabel) label.textContent = a.dataset.winLabel;
  });
})();
