// Where Cloudflare's sign-in comes back to: hand the one-time code to the
// chat tab that asked for it (a BroadcastChannel, plus localStorage for
// browsers without one), then close — or, when the whole tab went to
// Cloudflare because popups were blocked, go back to the chat.
(function () {
  "use strict";
  const p = new URLSearchParams(location.search);
  const msg = {
    code: p.get("code"),
    state: p.get("state"),
    error: p.get("error"),
    error_description: p.get("error_description"),
    at: Date.now(),
  };
  // The code is single-use and bound to the tab's PKCE verifier; drop it
  // from the address bar and history straight away.
  history.replaceState(null, "", location.pathname);
  try { localStorage.setItem("mike-cf-return", JSON.stringify(msg)); } catch (_) { /* storage off */ }
  try { const ch = new BroadcastChannel("mike-cloudflare"); ch.postMessage(msg); ch.close(); } catch (_) { /* old browser */ }

  let flow = null;
  try { flow = JSON.parse(localStorage.getItem("mike-cf-flow") || "null"); } catch (_) { flow = null; }
  const status = document.getElementById("status");
  if (flow && flow.mode === "redirect") {
    location.replace("/chat/");
    return;
  }
  if (status) status.textContent = msg.code ? "Connected. You can close this window." : "Cloudflare didn't connect. You can close this window and try again.";
  setTimeout(() => { try { window.close(); } catch (_) { /* not ours to close */ } }, 400);
})();
